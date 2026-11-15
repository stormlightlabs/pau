use crate::{PiProcessOutput, PiSession, PiSessionError, StartPiProcessOptions};
use pau_core::persistence::{ProcessMetadata, ProcessMetadataRepository};
use pau_core::sandbox::{PlaceholderLease, PlaceholderUsers, remove_placeholders};
use std::collections::{HashMap, HashSet};
use std::error::Error;
use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{Mutex, broadcast};

const PI_PROCESS_KIND: &str = "pi";
const OUTPUT_CAPACITY: usize = 256;

/// Parameters that identify and start one registered Pi session.
#[derive(Clone, Debug)]
pub struct StartRegisteredPiSession {
    /// Stable Pau session identifier.
    pub id: String,
    /// Workspace registration that owns the session.
    pub workspace_id: String,
    /// RFC 3339 process start timestamp.
    pub started_at: String,
    /// Native Pi process options for this workspace.
    pub process: StartPiProcessOptions,
    /// Placeholders the session's sandbox creates, from
    /// [`crate::PiSandboxLaunch`]. Empty for an unsandboxed session.
    pub sandbox_placeholders: Vec<PathBuf>,
}

/// Persisted Pi session metadata available after Pau restarts.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DiscoveredPiSession {
    /// Stable Pau session identifier.
    pub id: String,
    /// Workspace registration that owns the session.
    pub workspace_id: Option<String>,
    /// Pi's native session identifier.
    pub native_session_id: String,
    /// RFC 3339 timestamp at which Pau started the process.
    pub started_at: String,
    /// RFC 3339 process end timestamp, when Pau recorded one.
    pub ended_at: Option<String>,
    /// Process exit code, when the platform supplied one.
    pub exit_code: Option<i32>,
}

/// One process output tagged with its stable Pau session and workspace.
#[derive(Clone, Debug, PartialEq)]
pub struct PiSessionOutput {
    /// Stable Pau session identifier.
    pub session_id: String,
    /// Workspace registration that owns the session.
    pub workspace_id: String,
    /// Native output from this session's Pi process.
    pub output: PiProcessOutput,
}

/// A concurrent Pi session registry failure.
#[derive(Debug)]
pub enum PiSessionRegistryError {
    /// The supplied stable identifier is empty.
    InvalidId,
    /// A live session or start operation already uses this identifier.
    AlreadyExists(String),
    /// No live session uses this identifier.
    NotFound(String),
    /// The Pi session failed to start or handle an operation.
    Session(PiSessionError),
    /// Session recovery metadata could not be read or written.
    Persistence(String),
}

impl fmt::Display for PiSessionRegistryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidId => formatter.write_str("the Pau session ID must not be empty"),
            Self::AlreadyExists(id) => write!(formatter, "Pi session {id} is already active"),
            Self::NotFound(id) => write!(formatter, "Pi session {id} is not active"),
            Self::Session(error) => error.fmt(formatter),
            Self::Persistence(message) => {
                write!(
                    formatter,
                    "could not persist Pi session metadata: {message}"
                )
            }
        }
    }
}

impl Error for PiSessionRegistryError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Session(error) => Some(error),
            _ => None,
        }
    }
}

impl From<PiSessionError> for PiSessionRegistryError {
    fn from(error: PiSessionError) -> Self {
        Self::Session(error)
    }
}

#[derive(Default)]
struct RegistryState {
    sessions: HashMap<String, Arc<PiSession>>,
    starting: HashSet<String>,
    /// One lease per live sandboxed session, dropped when the session leaves
    /// `sessions`.
    sandboxes: HashMap<String, PlaceholderLease>,
}

impl RegistryState {
    /// Forgets `session` if it is still the one registered under `id`.
    fn remove(&mut self, id: &str, session: &Arc<PiSession>) {
        if self
            .sessions
            .get(id)
            .is_some_and(|registered| Arc::ptr_eq(registered, session))
        {
            self.sessions.remove(id);
            self.sandboxes.remove(id);
        }
    }
}

/// Owns independent Pi processes and multiplexes their tagged output.
///
/// The registry never holds its state lock while it waits for Pi or SQLite, so
/// work in one session cannot block controls or output from another session.
pub struct PiSessionRegistry {
    processes: ProcessMetadataRepository,
    state: Arc<Mutex<RegistryState>>,
    output: broadcast::Sender<PiSessionOutput>,
    placeholders: PlaceholderUsers,
}

impl PiSessionRegistry {
    /// Creates a registry backed by persisted process metadata.
    pub fn new(processes: ProcessMetadataRepository) -> Self {
        let (output, _) = broadcast::channel(OUTPUT_CAPACITY);
        Self {
            processes,
            state: Arc::new(Mutex::new(RegistryState::default())),
            output,
            placeholders: PlaceholderUsers::default(),
        }
    }

    /// Counts sandboxed sessions in `users`, which the other sandboxed
    /// processes of the same workspaces share, so a session's exit removes
    /// placeholders only when no other sandbox there still needs them.
    pub fn with_placeholder_users(mut self, users: PlaceholderUsers) -> Self {
        self.placeholders = users;
        self
    }

    /// Subscribes to tagged output from every live session.
    pub fn subscribe(&self) -> broadcast::Receiver<PiSessionOutput> {
        self.output.subscribe()
    }

    /// Starts and records one independent Pi RPC session.
    pub async fn start(
        &self,
        request: StartRegisteredPiSession,
    ) -> Result<Arc<PiSession>, PiSessionRegistryError> {
        if request.id.is_empty() {
            return Err(PiSessionRegistryError::InvalidId);
        }
        {
            let mut state = self.state.lock().await;
            if state.sessions.contains_key(&request.id)
                || !state.starting.insert(request.id.clone())
            {
                return Err(PiSessionRegistryError::AlreadyExists(request.id));
            }
        }

        let result = self.start_reserved(&request).await;
        self.state.lock().await.starting.remove(&request.id);
        result
    }

    async fn start_reserved(
        &self,
        request: &StartRegisteredPiSession,
    ) -> Result<Arc<PiSession>, PiSessionRegistryError> {
        if !request.sandbox_placeholders.is_empty() {
            self.remove_leftover_placeholders().await?;
        }
        let lease = (!request.sandbox_placeholders.is_empty()).then(|| {
            self.placeholders
                .enter(&request.workspace_id, &request.sandbox_placeholders)
        });
        let session = Arc::new(
            PiSession::start(request.process.clone())
                .map_err(PiSessionError::from)
                .map_err(PiSessionRegistryError::from)?,
        );
        let native_output = session.subscribe();
        let native = match session.native_session().await {
            Ok(native) => native,
            Err(error) => {
                let _ = session.stop().await;
                return Err(error.into());
            }
        };
        let metadata = ProcessMetadata {
            id: request.id.clone(),
            workspace_id: Some(request.workspace_id.clone()),
            process_kind: PI_PROCESS_KIND.to_owned(),
            native_session_id: Some(native.id),
            started_at: request.started_at.clone(),
            ended_at: None,
            exit_code: None,
            sandbox_placeholders: request
                .sandbox_placeholders
                .iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect(),
        };
        if let Err(error) = self.processes.upsert(metadata).await {
            let _ = session.stop().await;
            return Err(PiSessionRegistryError::Persistence(error.to_string()));
        }

        {
            let mut state = self.state.lock().await;
            state
                .sessions
                .insert(request.id.clone(), Arc::clone(&session));
            if let Some(lease) = lease {
                state.sandboxes.insert(request.id.clone(), lease);
            }
        }
        forward_output(
            native_output,
            self.output.clone(),
            Arc::clone(&self.state),
            Arc::clone(&session),
            request.id.clone(),
            request.workspace_id.clone(),
        );
        Ok(session)
    }

    /// Returns a live session without changing its lifecycle.
    pub async fn get(&self, id: &str) -> Option<Arc<PiSession>> {
        self.state.lock().await.sessions.get(id).cloned()
    }

    /// Returns stable identifiers for all live sessions.
    pub async fn active_ids(&self) -> Vec<String> {
        let mut ids: Vec<_> = self.state.lock().await.sessions.keys().cloned().collect();
        ids.sort();
        ids
    }

    /// Stops one session and records its exit without affecting other sessions.
    pub async fn stop(
        &self,
        id: &str,
        ended_at: impl Into<String>,
    ) -> Result<(), PiSessionRegistryError> {
        let session = self
            .get(id)
            .await
            .ok_or_else(|| PiSessionRegistryError::NotFound(id.to_owned()))?;
        let exit = session.stop().await?;

        let mut metadata = self
            .processes
            .get(id)
            .await
            .map_err(|error| PiSessionRegistryError::Persistence(error.to_string()))?
            .ok_or_else(|| {
                PiSessionRegistryError::Persistence(format!(
                    "metadata for stopped session {id} is missing"
                ))
            })?;
        metadata.ended_at = Some(ended_at.into());
        metadata.exit_code = exit.code;
        // sandbox-runtime removes its placeholders when the extension shuts
        // down. A killed Pi leaves them, and the session's lease removes any
        // that no other sandbox in the workspace still needs.
        metadata.sandbox_placeholders.clear();
        self.processes
            .upsert(metadata)
            .await
            .map_err(|error| PiSessionRegistryError::Persistence(error.to_string()))?;

        self.state.lock().await.remove(id, &session);
        Ok(())
    }

    /// Removes placeholders recorded by sessions that are no longer live,
    /// such as those of a Pau process that crashed, before a new sandbox
    /// starts. Placeholders in a workspace where any sandbox runs stay:
    /// removing one would detach that sandbox's mount and lift its deny rule.
    async fn remove_leftover_placeholders(&self) -> Result<(), PiSessionRegistryError> {
        let persistence = |error: pau_core::persistence::Result<()>| {
            error.map_err(|error| PiSessionRegistryError::Persistence(error.to_string()))
        };
        let live = self.live_ids().await;
        for record in self.records().await? {
            let in_use = record
                .workspace_id
                .as_deref()
                .is_some_and(|workspace| self.placeholders.in_use(workspace));
            if live.contains(&record.id) || record.sandbox_placeholders.is_empty() || in_use {
                continue;
            }
            remove_placeholders(
                &record
                    .sandbox_placeholders
                    .iter()
                    .map(PathBuf::from)
                    .collect::<Vec<_>>(),
            );
            persistence(
                self.processes
                    .set_sandbox_placeholders(&record.id, Vec::new())
                    .await,
            )?;
        }
        Ok(())
    }

    async fn live_ids(&self) -> HashSet<String> {
        let state = self.state.lock().await;
        state
            .sessions
            .keys()
            .chain(state.starting.iter())
            .cloned()
            .collect()
    }

    async fn records(&self) -> Result<Vec<ProcessMetadata>, PiSessionRegistryError> {
        self.processes
            .list()
            .await
            .map_err(|error| PiSessionRegistryError::Persistence(error.to_string()))
    }

    /// Lists Pi native session records persisted by earlier and current runs.
    pub async fn discover(&self) -> Result<Vec<DiscoveredPiSession>, PiSessionRegistryError> {
        let records = self
            .processes
            .list()
            .await
            .map_err(|error| PiSessionRegistryError::Persistence(error.to_string()))?;
        Ok(records
            .into_iter()
            .filter(|record| record.process_kind == PI_PROCESS_KIND)
            .filter_map(|record| {
                Some(DiscoveredPiSession {
                    id: record.id,
                    workspace_id: record.workspace_id,
                    native_session_id: record.native_session_id?,
                    started_at: record.started_at,
                    ended_at: record.ended_at,
                    exit_code: record.exit_code,
                })
            })
            .collect())
    }
}

fn forward_output(
    mut native: broadcast::Receiver<PiProcessOutput>,
    output: broadcast::Sender<PiSessionOutput>,
    state: Arc<Mutex<RegistryState>>,
    session: Arc<PiSession>,
    session_id: String,
    workspace_id: String,
) {
    tokio::spawn(async move {
        loop {
            match native.recv().await {
                Ok(event) => {
                    let exited = matches!(event, PiProcessOutput::Exit(_));
                    let _ = output.send(PiSessionOutput {
                        session_id: session_id.clone(),
                        workspace_id: workspace_id.clone(),
                        output: event,
                    });
                    if exited {
                        state.lock().await.remove(&session_id, &session);
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}
