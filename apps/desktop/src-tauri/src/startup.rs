//! Startup work that runs after the main window opens.
//!
//! The window appears first and shows progress while the shell opens the
//! database, starts the backend, and checks agent readiness. Each change
//! replaces the whole [`StartupProgress`] snapshot and is published to the
//! window, and the `startup_progress` command returns the current snapshot, so
//! a page that loads late still sees every step.
//!
//! The backend connection reaches the page only through that snapshot, once
//! the backend serves requests. The token never appears in a URL.

use std::{
    error::Error,
    future::Future,
    io,
    net::Ipv4Addr,
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use pau_core::{
    persistence::OpenError,
    readiness::AgentReadinessReport,
    startup::{
        DesktopConnection, StartupAction, StartupPhase, StartupProgress, StartupStepId,
        StartupStepState,
    },
};
use pau_server::{ApiToken, ServerDatabase, ServerHandle, ServerOptions};

/// The event that carries each new snapshot to the main window.
pub const PROGRESS_EVENT: &str = "pau://startup-progress";

/// How long a fatal failure waits for the page to show it before the shell
/// falls back to a native dialog.
pub const PAGE_TIMEOUT: Duration = Duration::from_secs(10);

/// Why a step failed and what the person can do about it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StepFailure {
    /// The reason, written as a sentence for the person using Pau.
    pub reason: String,
    /// The action Pau can offer, when one helps.
    pub action: Option<StartupAction>,
}

impl StepFailure {
    /// Describes an error without an action.
    fn from_error(error: &dyn Error) -> Self {
        Self {
            reason: sentence(error),
            action: None,
        }
    }
}

/// The work behind the database, backend, and agent readiness steps.
///
/// [`PauLauncher`] runs the real backend. Tests substitute their own steps.
pub trait Launcher: Sync {
    /// The opened database that the backend step takes over.
    type Database: Send;

    /// Opens and migrates the database.
    fn open_database(&self) -> impl Future<Output = Result<Self::Database, StepFailure>> + Send;

    /// Starts the backend on the opened database and returns its connection.
    fn start_backend(
        &self,
        database: Self::Database,
    ) -> impl Future<Output = Result<DesktopConnection, StepFailure>> + Send;

    /// Checks every supported agent. Called only after the backend started.
    fn check_agents(&self) -> impl Future<Output = AgentReadinessReport> + Send;
}

/// Startup progress shared by the startup task and the `startup_progress`
/// command.
pub struct StartupState {
    progress: Mutex<StartupProgress>,
    page_attached: AtomicBool,
}

impl StartupState {
    /// Starts with every step pending and the login shell step resolved.
    ///
    /// The login shell `PATH` is read before the window opens, so its result
    /// is known when progress is first shown.
    pub fn new(login_path: Result<(), StepFailure>) -> Self {
        let mut progress = StartupProgress::new();
        let step = progress.step_mut(StartupStepId::LoginShellPath);
        match login_path {
            Ok(()) => step.state = StartupStepState::Done,
            Err(failure) => {
                step.state = StartupStepState::Failed;
                step.reason = Some(failure.reason);
                step.action = failure.action;
            }
        }
        Self {
            progress: Mutex::new(progress),
            page_attached: AtomicBool::new(false),
        }
    }

    /// Returns the current snapshot.
    pub fn snapshot(&self) -> StartupProgress {
        self.progress
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// Records that a page subscribed to progress and asked for a snapshot,
    /// so it will show a later failure itself.
    pub fn attach_page(&self) {
        self.page_attached.store(true, Ordering::SeqCst);
    }

    /// Waits up to `timeout` for a page to attach and reports whether one did.
    pub async fn wait_for_page(&self, timeout: Duration) -> bool {
        let poll = Duration::from_millis(50);
        let mut waited = Duration::ZERO;
        while !self.page_attached.load(Ordering::SeqCst) {
            if waited >= timeout {
                return false;
            }
            tokio::time::sleep(poll).await;
            waited += poll;
        }
        true
    }

    /// Applies `change` and publishes the resulting snapshot.
    fn update(
        &self,
        publish: &impl Fn(&StartupProgress),
        change: impl FnOnce(&mut StartupProgress),
    ) {
        let snapshot = {
            let mut progress = self
                .progress
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            change(&mut progress);
            progress.clone()
        };
        publish(&snapshot);
    }

    fn set_step(
        &self,
        publish: &impl Fn(&StartupProgress),
        id: StartupStepId,
        state: StartupStepState,
        failure: Option<StepFailure>,
    ) {
        self.update(publish, |progress| {
            let step = progress.step_mut(id);
            step.state = state;
            step.reason = failure.as_ref().map(|failure| failure.reason.clone());
            step.action = failure.and_then(|failure| failure.action);
        });
    }
}

/// Runs the database, backend, and agent readiness steps in order.
///
/// A database or backend failure stops startup, marks the phase failed, and
/// returns the reason. Agent readiness never stops startup: a missing or
/// unusable agent fails its step, and the phase still becomes ready.
pub async fn run<L: Launcher>(
    launcher: &L,
    state: &StartupState,
    publish: impl Fn(&StartupProgress),
) -> Result<(), String> {
    let fail = |id, failure: StepFailure| {
        let reason = failure.reason.clone();
        state.set_step(&publish, id, StartupStepState::Failed, Some(failure));
        state.update(&publish, |progress| progress.phase = StartupPhase::Failed);
        reason
    };

    state.set_step(
        &publish,
        StartupStepId::Database,
        StartupStepState::Running,
        None,
    );
    let database = launcher
        .open_database()
        .await
        .map_err(|failure| fail(StartupStepId::Database, failure))?;
    state.set_step(
        &publish,
        StartupStepId::Database,
        StartupStepState::Done,
        None,
    );

    state.set_step(
        &publish,
        StartupStepId::Backend,
        StartupStepState::Running,
        None,
    );
    let connection = launcher
        .start_backend(database)
        .await
        .map_err(|failure| fail(StartupStepId::Backend, failure))?;
    state.update(&publish, |progress| {
        let step = progress.step_mut(StartupStepId::Backend);
        step.state = StartupStepState::Done;
        progress.connection = Some(connection);
    });

    state.set_step(
        &publish,
        StartupStepId::AgentReadiness,
        StartupStepState::Running,
        None,
    );
    let report = launcher.check_agents().await;
    let failure = readiness_failure(&report);
    state.update(&publish, |progress| {
        let step = progress.step_mut(StartupStepId::AgentReadiness);
        match failure {
            None => step.state = StartupStepState::Done,
            Some(failure) => {
                step.state = StartupStepState::Failed;
                step.reason = Some(failure.reason);
                step.action = failure.action;
            }
        }
        progress.readiness = Some(report);
        progress.phase = StartupPhase::Ready;
    });
    Ok(())
}

/// Describes the first agent that cannot start a session, if any.
fn readiness_failure(report: &AgentReadinessReport) -> Option<StepFailure> {
    let agent = report.agents.iter().find(|agent| !agent.ready)?;
    let action = (agent.agent == "pi").then_some(if !agent.found {
        StartupAction::InstallPi
    } else if !agent.version_supported {
        StartupAction::UpdatePi
    } else {
        StartupAction::RunPi
    });
    Some(StepFailure {
        reason: agent
            .reason
            .clone()
            .unwrap_or_else(|| format!("{} cannot start a session.", agent.agent)),
        action,
    })
}

/// Describes the login shell `PATH` result as a step outcome.
///
/// A failure only means Pau keeps the `PATH` it was opened with, so it never
/// stops startup.
#[cfg(target_os = "macos")]
pub fn login_path_outcome(
    result: Result<(), crate::login_path::LoginPathError>,
) -> Result<(), StepFailure> {
    use crate::login_path::{LoginPathError, TIMEOUT};

    let reason = match result {
        Ok(()) => return Ok(()),
        Err(LoginPathError::TimedOut) => format!(
            "Your login shell took longer than {} seconds to report its PATH, so Pau kept \
             the PATH it was opened with. Pi and other tools may not be found.",
            TIMEOUT.as_secs()
        ),
        Err(LoginPathError::Unavailable) => "Pau could not read your login shell's PATH, \
             so it kept the PATH it was opened with. Pi and other tools may not be found."
            .to_owned(),
    };
    Err(StepFailure {
        reason,
        action: None,
    })
}

/// Turns an error into text that starts with a capital letter.
///
/// Backend errors begin in lowercase so they read well inside logs and wrapped
/// errors. Progress and the dialog show the message on its own.
pub fn sentence(error: &dyn Error) -> String {
    let text = error.to_string();
    let mut characters = text.chars();
    match characters.next() {
        Some(first) => first.to_uppercase().chain(characters).collect(),
        None => "Pau stopped during startup without reporting a reason.".to_owned(),
    }
}

/// Runs the real database, backend, and agent check, and owns the backend for
/// as long as the app runs.
pub struct PauLauncher {
    /// The database file, or `None` for the backend's default location.
    database_path: Option<PathBuf>,
    options: ServerOptions,
    server: Mutex<Option<ServerHandle>>,
}

impl PauLauncher {
    /// Creates a launcher for the database at `database_path`, or at the
    /// default location when `None`.
    pub fn new(database_path: Option<PathBuf>, options: ServerOptions) -> Self {
        Self {
            database_path,
            options,
            server: Mutex::new(None),
        }
    }

    /// Asks a started backend to shut down. Does nothing before it starts.
    pub fn stop(&self) {
        if let Some(server) = self
            .server
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_mut()
        {
            server.request_shutdown();
        }
    }
}

impl Launcher for PauLauncher {
    type Database = ServerDatabase;

    async fn open_database(&self) -> Result<ServerDatabase, StepFailure> {
        let opened = match &self.database_path {
            Some(path) => pau_server::open_database_at(path).await,
            None => pau_server::open_database().await,
        };
        opened.map_err(|error| database_failure(&error))
    }

    async fn start_backend(
        &self,
        database: ServerDatabase,
    ) -> Result<DesktopConnection, StepFailure> {
        let token = ApiToken::generate().map_err(|error| StepFailure::from_error(&error))?;
        let server = pau_server::start_with_database(
            (Ipv4Addr::LOCALHOST, 0).into(),
            token,
            self.options,
            database,
        )
        .await
        .map_err(|error| StepFailure::from_error(&error))?;
        let connection = DesktopConnection {
            api_origin: format!("http://127.0.0.1:{}", server.local_addr().port()),
            token: server.token().expose().to_owned(),
        };
        *self
            .server
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(server);
        Ok(connection)
    }

    async fn check_agents(&self) -> AgentReadinessReport {
        let check = self
            .server
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .map(ServerHandle::agent_readiness);
        match check {
            Some(check) => check.await,
            None => AgentReadinessReport { agents: Vec::new() },
        }
    }
}

/// Offers an update when the database belongs to a newer Pau.
fn database_failure(error: &io::Error) -> StepFailure {
    let newer = matches!(
        error
            .get_ref()
            .and_then(|inner| inner.downcast_ref::<OpenError>()),
        Some(OpenError::NewerSchema { .. })
    );
    StepFailure {
        reason: sentence(error),
        action: newer.then_some(StartupAction::UpdatePau),
    }
}

#[cfg(test)]
mod tests;
