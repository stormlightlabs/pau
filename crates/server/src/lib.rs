use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    env,
    ffi::OsString,
    fmt, fs, io,
    net::SocketAddr,
    path::{Path, PathBuf},
    pin::Pin,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime},
};

use axum::{
    Json, Router,
    extract::{
        DefaultBodyLimit, Path as AxumPath, Query, Request, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use pau_core::{
    HealthResponse, ServerEvent, ServerEventKind, ServerSnapshot, ServerStreamMessage,
    VersionResponse,
    audit::{AUDIT_CLOSE_LIMIT, AuditLog, AuditOperation},
    diagnostics::{
        DiagnosticBundle, DiagnosticLevel, DiagnosticRecordInput, Diagnostics, TransportDiagnostic,
    },
    persistence::{
        ApplicationSetting, ApplicationSettingsRepository, Database, SandboxSelectionRepository,
        Workspace,
    },
    preferences::{UiPreferences, UiPreferencesStore},
    sandbox::{
        EffectiveSandbox, PlaceholderUsers, SandboxExecutables, SandboxLaunchInput,
        SandboxPreviewRequest, SandboxSelection, SandboxSettings, WorkspaceSandbox,
        resolve_sandbox, validate_selection,
    },
    workspace::{
        FileContent, FileEntry, GitDiff, GitStatus, SearchOptions, TraversalOptions,
        WorkspaceError, WorkspaceService,
    },
};
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::{
    net::TcpListener,
    sync::{broadcast, oneshot},
    task::JoinHandle,
};
use tower_http::cors::CorsLayer;
use tracing::instrument::WithSubscriber;

mod audit;
mod build_info;
mod process_usage;
mod sessions;
mod starts;
mod terminals;
mod watches;

use audit::PendingAudit;
use build_info::Channel;
use sessions::{SandboxExtension, SessionApi};
use starts::StartGate;
use watches::{WatchLease, WorkspaceWatches};

/// Version returned by every Pau backend implementation: the workspace version
/// for tagged releases, `<version>-dev+<commit>` otherwise.
pub const VERSION: &str = env!("PAU_BUILD_VERSION");

/// Channel selected by `build.rs`.
fn build_channel() -> Channel {
    Channel::parse(env!("PAU_BUILD_CHANNEL")).expect("build.rs emits a valid channel")
}

const TOKEN_BYTES: usize = 32;
const MIN_CONFIGURED_TOKEN_BYTES: usize = 32;
const DEFAULT_REPLAY_CAPACITY: usize = 1_024;
const LIVE_EVENT_CAPACITY: usize = 256;
const DIAGNOSTICS_SETTING_KEY: &str = "diagnostics.enabled";

/// Bearer token that grants access to one local server launch.
///
/// Debug and display formatting are redacted so structured diagnostics cannot
/// expose a token by formatting it.
#[derive(Clone)]
pub struct ApiToken(String);

impl ApiToken {
    /// Generates an unguessable token from the operating system random source.
    pub fn generate() -> io::Result<Self> {
        let mut bytes = [0_u8; TOKEN_BYTES];
        getrandom::fill(&mut bytes).map_err(io::Error::other)?;
        let mut token = String::with_capacity(TOKEN_BYTES * 2);
        for byte in bytes {
            use fmt::Write as _;
            write!(token, "{byte:02x}").expect("writing to a string cannot fail");
        }
        Ok(Self(token))
    }

    /// Uses a configured token after enforcing the minimum local-token length.
    pub fn configured(value: impl Into<String>) -> io::Result<Self> {
        let value = value.into();
        if value.len() < MIN_CONFIGURED_TOKEN_BYTES
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "PAU_API_TOKEN must contain at least 32 URL-safe ASCII characters",
            ));
        }
        Ok(Self(value))
    }

    /// Exposes the token for delivery to an authenticated client.
    pub fn expose(&self) -> &str {
        &self.0
    }

    fn matches(&self, candidate: &str) -> bool {
        candidate.len() == self.0.len() && bool::from(candidate.as_bytes().ct_eq(self.0.as_bytes()))
    }
}

impl fmt::Debug for ApiToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ApiToken([REDACTED])")
    }
}

impl fmt::Display for ApiToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("[REDACTED]")
    }
}

#[derive(Clone)]
struct ApiState {
    events: EventHub,
    workspaces: Option<WorkspaceService>,
    diagnostics: Diagnostics,
    settings: Option<ApplicationSettingsRepository>,
    sandbox: Option<SandboxApi>,
    sessions: Option<SessionApi>,
    audit: AuditLog,
    terminals: terminals::TerminalRegistry,
    watches: WorkspaceWatches,
    starts: StartGate,
}

/// The backends a router serves. A route whose backend is absent answers
/// `503`, and the default audit log keeps nothing.
#[derive(Default)]
struct ApiServices {
    workspaces: Option<WorkspaceService>,
    settings: Option<ApplicationSettingsRepository>,
    sandbox: Option<SandboxApi>,
    sessions: Option<SessionApi>,
    audit: AuditLog,
    terminals: terminals::TerminalRegistry,
    /// Refuses process starts once shutdown begins.
    starts: StartGate,
}

/// Sandbox selections and the host facts needed to describe a profile.
#[derive(Clone)]
struct SandboxApi {
    selections: SandboxSelectionRepository,
    /// Executables pinned at startup, or why none could be resolved.
    executables: Result<SandboxExecutables, String>,
    /// The `PATH` a sandboxed tool receives.
    tool_path: String,
    home: PathBuf,
    /// Parent of per-session sandbox directories.
    sessions: PathBuf,
    /// Executable that runs the sandboxed terminal relay, from
    /// [`ServerOptions::terminal_relay`].
    terminal_relay: Option<PathBuf>,
    /// Sandboxes running in each workspace, shared by terminals and Pi
    /// sessions.
    placeholders: PlaceholderUsers,
    /// Where sandboxed Pi sessions load the sandbox extension from.
    extension: SandboxExtension,
}

impl SandboxApi {
    /// Pins the containment executables found on `path`.
    fn new(selections: SandboxSelectionRepository, sessions: PathBuf, path: OsString) -> Self {
        Self {
            selections,
            executables: SandboxExecutables::resolve(&path).map_err(|error| error.to_string()),
            tool_path: path.to_string_lossy().into_owned(),
            home: dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")),
            sessions,
            terminal_relay: None,
            placeholders: PlaceholderUsers::default(),
            extension: SandboxExtension::checkout(),
        }
    }

    fn with_terminal_relay(mut self, relay: Option<PathBuf>) -> Self {
        self.terminal_relay = relay;
        self
    }

    fn with_extension(mut self, extension: SandboxExtension) -> Self {
        self.extension = extension;
        self
    }

    /// Why a sandboxed terminal cannot start, when that is the case.
    fn terminal_unavailable(&self) -> Option<String> {
        let executables = match &self.executables {
            Ok(executables) => executables,
            Err(error) => return Some(error.clone()),
        };
        if let Err(error) = executables.srt() {
            return Some(error.to_string());
        }
        match &self.terminal_relay {
            Some(relay) if relay.is_file() => None,
            _ => Some("This build of Pau cannot start the terminal relay".to_owned()),
        }
    }
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct SnapshotKey {
    workspace_id: Option<String>,
    session_id: Option<String>,
    kind: ServerEventKind,
}

#[derive(Debug)]
struct EventHubState {
    next_sequence: u64,
    replay: VecDeque<ServerEvent>,
    snapshot: HashMap<SnapshotKey, ServerEvent>,
    reconnects: u64,
    replay_gaps: u64,
}

/// Bounded event log and current-state projection shared by API connections.
#[derive(Clone, Debug)]
pub struct EventHub {
    replay_capacity: usize,
    state: Arc<Mutex<EventHubState>>,
    live: broadcast::Sender<ServerEvent>,
    diagnostics: Option<Diagnostics>,
}

impl Default for EventHub {
    fn default() -> Self {
        Self::new(DEFAULT_REPLAY_CAPACITY)
    }
}

impl EventHub {
    /// Creates an event hub retaining at most `replay_capacity` recent events.
    pub fn new(replay_capacity: usize) -> Self {
        assert!(
            replay_capacity > 0,
            "event replay capacity must be positive"
        );
        let (live, _) = broadcast::channel(LIVE_EVENT_CAPACITY);
        Self {
            replay_capacity,
            state: Arc::new(Mutex::new(EventHubState {
                next_sequence: 1,
                replay: VecDeque::with_capacity(replay_capacity),
                snapshot: HashMap::new(),
                reconnects: 0,
                replay_gaps: 0,
            })),
            live,
            diagnostics: None,
        }
    }

    /// Attaches a release-safe diagnostic collector to event transport state.
    pub fn with_diagnostics(mut self, diagnostics: Diagnostics) -> Self {
        self.diagnostics = Some(diagnostics);
        self
    }

    /// Records and broadcasts one state-bearing event.
    pub fn publish(
        &self,
        timestamp: impl Into<String>,
        workspace_id: Option<String>,
        session_id: Option<String>,
        kind: ServerEventKind,
        payload: impl Into<String>,
    ) -> ServerEvent {
        let mut state = self.state.lock().expect("event hub lock poisoned");
        let event = ServerEvent {
            sequence: state.next_sequence,
            timestamp: timestamp.into(),
            workspace_id,
            session_id,
            kind,
            payload: payload.into(),
        };
        state.next_sequence = state.next_sequence.saturating_add(1);
        if kind.is_state() {
            state.snapshot.insert(
                SnapshotKey {
                    workspace_id: event.workspace_id.clone(),
                    session_id: event.session_id.clone(),
                    kind,
                },
                event.clone(),
            );
        }
        if kind.is_replayed() {
            state.replay.push_back(event.clone());
            if state.replay.len() > self.replay_capacity {
                state.replay.pop_front();
            }
        }
        let receiver_count = self.live.receiver_count();
        let _ = self.live.send(event.clone());
        if let Some(diagnostics) = &self.diagnostics {
            let mut metadata = BTreeMap::from([
                ("sequence".to_owned(), event.sequence.to_string()),
                ("count".to_owned(), receiver_count.to_string()),
            ]);
            if event.session_id.is_some() {
                metadata.insert("state".to_owned(), "session_changed".to_owned());
            }
            diagnostics.record(DiagnosticRecordInput {
                timestamp: event.timestamp.clone(),
                component: "pau-server".to_owned(),
                level: DiagnosticLevel::Debug,
                operation: "event.published".to_owned(),
                process_id: None,
                session_id: event.session_id.clone(),
                metadata,
            });
            diagnostics.update_transport(TransportDiagnostic {
                name: "event_hub".to_owned(),
                state: "ready".to_owned(),
                reconnects: 0,
                last_sequence: Some(event.sequence),
                replay_gaps: 0,
                queue_depth: 0,
                dropped_updates: 0,
            });
        }
        event
    }

    /// Whether any client is connected to the event stream.
    pub fn has_subscribers(&self) -> bool {
        self.live.receiver_count() > 0
    }

    /// The sequence of the last published event, or 0 before the first.
    pub fn last_sequence(&self) -> u64 {
        self.state
            .lock()
            .expect("event hub lock poisoned")
            .next_sequence
            .saturating_sub(1)
    }

    fn subscribe(&self, after: Option<u64>) -> EventSubscription {
        // Subscribe before capturing the boundary. A publish racing with this
        // method is then present in either the initial batch or the live queue.
        let receiver = self.live.subscribe();
        let mut state = self.state.lock().expect("event hub lock poisoned");
        let boundary = state.next_sequence.saturating_sub(1);
        let replay_available = after.is_some_and(|sequence| {
            sequence <= boundary
                && state
                    .replay
                    .front()
                    .is_none_or(|oldest| sequence >= oldest.sequence.saturating_sub(1))
        });

        let initial = if replay_available {
            state
                .replay
                .iter()
                .filter(|event| event.sequence > after.expect("checked above"))
                .cloned()
                .map(|event| ServerStreamMessage::Event { event })
                .collect()
        } else {
            let mut events: Vec<_> = state.snapshot.values().cloned().collect();
            events.sort_by_key(|event| event.sequence);
            vec![ServerStreamMessage::Snapshot {
                snapshot: ServerSnapshot {
                    sequence: boundary,
                    events,
                },
            }]
        };
        if after.is_some() {
            state.reconnects = state.reconnects.saturating_add(1);
        }
        let replay_gap = u64::from(after.is_some() && !replay_available);
        state.replay_gaps = state.replay_gaps.saturating_add(replay_gap);
        if let Some(diagnostics) = &self.diagnostics {
            diagnostics.update_transport(TransportDiagnostic {
                name: "websocket".to_owned(),
                state: "subscribing".to_owned(),
                reconnects: state.reconnects,
                last_sequence: Some(boundary),
                replay_gaps: state.replay_gaps,
                queue_depth: initial.len() as u64,
                dropped_updates: 0,
            });
            if replay_gap > 0 {
                diagnostics.record(DiagnosticRecordInput {
                    timestamp: diagnostic_timestamp(),
                    component: "pau-server".to_owned(),
                    level: DiagnosticLevel::Warn,
                    operation: "event.replay_gap".to_owned(),
                    process_id: None,
                    session_id: None,
                    metadata: BTreeMap::from([
                        ("sequence".to_owned(), boundary.to_string()),
                        ("replay_gap".to_owned(), "1".to_owned()),
                    ]),
                });
            }
        }

        EventSubscription {
            boundary,
            initial,
            receiver,
            diagnostics: self.diagnostics.clone(),
            reconnects: state.reconnects,
            replay_gaps: state.replay_gaps,
        }
    }
}

struct EventSubscription {
    boundary: u64,
    initial: Vec<ServerStreamMessage>,
    receiver: broadcast::Receiver<ServerEvent>,
    diagnostics: Option<Diagnostics>,
    reconnects: u64,
    replay_gaps: u64,
}

/// Builds the authenticated API used by desktop and browser clients.
pub fn router(token: ApiToken) -> Router {
    router_with_services(
        token,
        EventHub::default(),
        default_diagnostics(),
        ApiServices::default(),
    )
}

/// Builds the API around an event hub supplied by the application owner.
pub fn router_with_events(token: ApiToken, events: EventHub) -> Router {
    router_with_services(token, events, default_diagnostics(), ApiServices::default())
}

/// Builds the API with an explicit diagnostics collector.
pub fn router_with_diagnostics(token: ApiToken, diagnostics: Diagnostics) -> Router {
    let events = EventHub::default().with_diagnostics(diagnostics.clone());
    router_with_services(token, events, diagnostics, ApiServices::default())
}

fn router_with_services(
    token: ApiToken,
    events: EventHub,
    diagnostics: Diagnostics,
    services: ApiServices,
) -> Router {
    diagnostics.register_sensitive_value(token.expose());
    Router::new()
        .route("/api/health", get(health))
        .route("/api/version", get(version))
        .route("/api/events", get(websocket))
        .route(
            "/api/preferences",
            get(get_preferences).put(put_preferences),
        )
        .route("/api/diagnostics", get(get_diagnostics))
        .route("/api/diagnostics/settings", put(update_diagnostic_settings))
        .route(
            "/api/diagnostics/payload-tracing",
            post(start_payload_tracing),
        )
        .route("/api/diagnostics/export", post(export_diagnostics))
        .route("/api/audit", get(audit::list_audit))
        .route("/api/audit/export", post(audit::export_audit))
        .route("/api/workspaces", get(list_workspaces).post(open_workspace))
        .route("/api/workspaces/{workspace_id}/files", get(list_files))
        .route(
            "/api/workspaces/{workspace_id}/file",
            get(read_file).put(write_file),
        )
        .route("/api/workspaces/{workspace_id}/search", get(search_files))
        .route("/api/workspaces/{workspace_id}/git/status", get(git_status))
        .route("/api/workspaces/{workspace_id}/git/diff", get(git_diff))
        .route(
            "/api/workspaces/{workspace_id}/pi-sessions",
            get(sessions::list_native_sessions),
        )
        .route(
            "/api/workspaces/{workspace_id}/resources",
            get(sessions::resources::get_workspace_resources),
        )
        .route(
            "/api/workspaces/{workspace_id}/sandbox",
            get(get_workspace_sandbox).put(update_workspace_sandbox),
        )
        .route(
            "/api/workspaces/{workspace_id}/sandbox/preview",
            post(preview_sandbox),
        )
        .route("/api/pi/keybindings", get(sessions::get_pi_keybindings))
        .route(
            "/api/agents/readiness",
            get(sessions::readiness::get_agent_readiness),
        )
        .route(
            "/api/sessions",
            get(sessions::list_sessions).post(sessions::start_session),
        )
        .route(
            "/api/sessions/{session_id}",
            get(sessions::get_session).delete(sessions::stop_session),
        )
        .route(
            "/api/sessions/{session_id}/prompt",
            post(sessions::prompt_session).layer(DefaultBodyLimit::max(sessions::IMAGE_BODY_LIMIT)),
        )
        .route(
            "/api/sessions/{session_id}/steer",
            post(sessions::steer_session).layer(DefaultBodyLimit::max(sessions::IMAGE_BODY_LIMIT)),
        )
        .route(
            "/api/sessions/{session_id}/follow-up",
            post(sessions::follow_up_session)
                .layer(DefaultBodyLimit::max(sessions::IMAGE_BODY_LIMIT)),
        )
        .route(
            "/api/sessions/{session_id}/interrupt",
            post(sessions::interrupt_session),
        )
        .route(
            "/api/sessions/{session_id}/model",
            put(sessions::select_session_model),
        )
        .route(
            "/api/sessions/{session_id}/thinking-level",
            put(sessions::set_session_thinking_level),
        )
        .route(
            "/api/sessions/{session_id}/compact",
            post(sessions::compact_session),
        )
        .route(
            "/api/sessions/{session_id}/auto-compaction",
            put(sessions::set_session_auto_compaction),
        )
        .route(
            "/api/sessions/{session_id}/name",
            put(sessions::rename_session),
        )
        .route(
            "/api/sessions/{session_id}/clone",
            post(sessions::clone_session),
        )
        .route(
            "/api/sessions/{session_id}/export",
            post(sessions::export_session),
        )
        .route(
            "/api/sessions/{session_id}/retry",
            post(sessions::retry_session).delete(sessions::abort_session_retry),
        )
        .route(
            "/api/sessions/{session_id}/shell",
            post(sessions::run_session_shell_command)
                .delete(sessions::abort_session_shell_commands),
        )
        .route(
            "/api/sessions/{session_id}/auto-retry",
            put(sessions::set_session_auto_retry),
        )
        .route(
            "/api/sessions/{session_id}/queue",
            get(sessions::get_session_queue).delete(sessions::clear_session_queue),
        )
        .route(
            "/api/sessions/{session_id}/messages",
            get(sessions::get_session_messages),
        )
        .route(
            "/api/sessions/{session_id}/history",
            get(sessions::get_session_history),
        )
        .route(
            "/api/sessions/{session_id}/usage",
            get(sessions::get_session_usage),
        )
        .route(
            "/api/sessions/{session_id}/models",
            get(sessions::list_session_models),
        )
        .route(
            "/api/sessions/{session_id}/tree",
            get(sessions::get_session_tree),
        )
        .route(
            "/api/sessions/{session_id}/search",
            get(sessions::search_session),
        )
        .route(
            "/api/sessions/{session_id}/branch",
            post(sessions::branch_session),
        )
        .route(
            "/api/sessions/{session_id}/commands",
            get(sessions::list_session_commands),
        )
        .route(
            "/api/sessions/{session_id}/extension-ui",
            get(sessions::get_session_extension_ui),
        )
        .route(
            "/api/sessions/{session_id}/extension-ui/{request_id}",
            post(sessions::respond_to_extension_ui),
        )
        .route(
            "/api/terminals",
            get(terminals::list_terminals).post(terminals::create_terminal),
        )
        .route(
            "/api/terminals/{terminal_id}",
            get(terminals::get_terminal).delete(terminals::close_terminal),
        )
        .route(
            "/api/terminals/{terminal_id}/size",
            put(terminals::resize_terminal),
        )
        .route(
            "/api/terminals/{terminal_id}/signal",
            post(terminals::signal_terminal),
        )
        .route(
            "/api/terminals/{terminal_id}/stream",
            get(terminals::stream_terminal),
        )
        .layer(middleware::from_fn_with_state(token, authenticate))
        .layer(CorsLayer::permissive())
        .with_state(ApiState {
            events,
            workspaces: services.workspaces,
            diagnostics,
            settings: services.settings,
            sandbox: services.sandbox,
            sessions: services.sessions,
            audit: services.audit,
            terminals: services.terminals,
            watches: WorkspaceWatches::default(),
            starts: services.starts,
        })
}

async fn authenticate(
    State(token): State<ApiToken>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let bearer = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    let path = request.uri().path();
    let websocket_token = (path == "/api/events" || terminals::is_stream_path(path))
        .then(|| request.headers().get(header::SEC_WEBSOCKET_PROTOCOL))
        .flatten()
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .split(',')
                .map(str::trim)
                .find_map(|protocol| protocol.strip_prefix("pau.bearer."))
        });
    let authenticated = bearer
        .into_iter()
        .chain(websocket_token)
        .any(|candidate| token.matches(candidate));

    if !authenticated {
        let path = request.uri().path();
        let transport = if path == "/api/events" || terminals::is_stream_path(path) {
            "websocket"
        } else {
            "http"
        };
        tracing::warn!(
            event = "api.authentication_failed",
            transport,
            "local API authentication failed"
        );
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(next.run(request).await)
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { healthy: true })
}

async fn version() -> Json<VersionResponse> {
    Json(VersionResponse {
        version: VERSION.to_owned(),
    })
}

fn default_diagnostics() -> Diagnostics {
    Diagnostics::new(
        VERSION,
        VERSION,
        BTreeMap::from([
            ("axum".to_owned(), "0.8.9".to_owned()),
            ("tokio".to_owned(), "1.53.1".to_owned()),
            ("tracing".to_owned(), "0.1.44".to_owned()),
        ]),
    )
}

fn diagnostic_timestamp() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

async fn get_diagnostics(State(state): State<ApiState>) -> Json<DiagnosticBundle> {
    Json(state.diagnostics.snapshot(SystemTime::now()))
}

#[derive(Debug, Deserialize)]
struct DiagnosticSettingsRequest {
    enabled: bool,
    min_level: DiagnosticLevel,
}

async fn update_diagnostic_settings(
    State(state): State<ApiState>,
    Json(request): Json<DiagnosticSettingsRequest>,
) -> Result<Json<DiagnosticBundle>, ApiError> {
    state.diagnostics.set_min_level(request.min_level);
    state.diagnostics.set_enabled(request.enabled);
    if let Some(settings) = state.settings {
        settings
            .set(ApplicationSetting {
                key: DIAGNOSTICS_SETTING_KEY.to_owned(),
                value: request.enabled.to_string(),
                updated_at: diagnostic_timestamp(),
            })
            .await
            .map_err(|error| ApiError::Diagnostics(error.to_string()))?;
    }
    Ok(Json(state.diagnostics.snapshot(SystemTime::now())))
}

fn preferences_store(state: &ApiState) -> Result<UiPreferencesStore, ApiError> {
    state
        .settings
        .clone()
        .map(UiPreferencesStore::new)
        .ok_or(ApiError::ServiceUnavailable)
}

async fn get_preferences(State(state): State<ApiState>) -> Result<Json<UiPreferences>, ApiError> {
    let preferences = preferences_store(&state)?
        .load()
        .await
        .map_err(|error| ApiError::Preferences(error.to_string()))?;
    Ok(Json(preferences))
}

/// Replaces the preferences and tells every connected window.
async fn put_preferences(
    State(state): State<ApiState>,
    Json(preferences): Json<UiPreferences>,
) -> Result<Json<UiPreferences>, ApiError> {
    preferences
        .validate()
        .map_err(ApiError::InvalidPreferences)?;
    let timestamp = diagnostic_timestamp();
    preferences_store(&state)?
        .save(&preferences, timestamp.clone())
        .await
        .map_err(|error| ApiError::Preferences(error.to_string()))?;
    state.events.publish(
        timestamp,
        None,
        None,
        ServerEventKind::PreferencesChanged,
        serde_json::to_string(&preferences).expect("preferences are serializable"),
    );
    Ok(Json(preferences))
}

#[derive(Debug, Deserialize)]
struct PayloadTracingRequest {
    duration_seconds: u64,
}

async fn start_payload_tracing(
    State(state): State<ApiState>,
    Json(request): Json<PayloadTracingRequest>,
) -> Result<Json<DiagnosticBundle>, ApiError> {
    state
        .diagnostics
        .enable_payload_tracing(
            Duration::from_secs(request.duration_seconds),
            SystemTime::now(),
        )
        .map_err(|error| ApiError::Diagnostics(error.to_string()))?;
    Ok(Json(state.diagnostics.snapshot(SystemTime::now())))
}

#[derive(Debug, Deserialize)]
struct DiagnosticExportRequest {
    destination: PathBuf,
    reviewed_revision: u64,
}

#[derive(Debug, Serialize)]
struct DiagnosticExportResponse {
    written: bool,
}

async fn export_diagnostics(
    State(state): State<ApiState>,
    Json(request): Json<DiagnosticExportRequest>,
) -> Result<Json<DiagnosticExportResponse>, ApiError> {
    let audit = PendingAudit::operator(
        &state.audit,
        AuditOperation::FileExport,
        None,
        audit::export_target(&request.destination),
    );
    let result = export_reviewed_diagnostics(&state, request);
    audit.finish(&result);
    result
}

fn export_reviewed_diagnostics(
    state: &ApiState,
    request: DiagnosticExportRequest,
) -> Result<Json<DiagnosticExportResponse>, ApiError> {
    if let Err(error) = state.diagnostics.export_reviewed(
        request.destination,
        request.reviewed_revision,
        SystemTime::now(),
    ) {
        state.diagnostics.record(DiagnosticRecordInput {
            timestamp: diagnostic_timestamp(),
            component: "pau-server".to_owned(),
            level: DiagnosticLevel::Error,
            operation: "diagnostic.export_failed".to_owned(),
            process_id: Some("pau-server".to_owned()),
            session_id: None,
            metadata: BTreeMap::from([("error_class".to_owned(), format!("{:?}", error.kind()))]),
        });
        return Err(ApiError::Diagnostics(error.to_string()));
    }
    Ok(Json(DiagnosticExportResponse { written: true }))
}

#[derive(Debug, Serialize)]
struct ApiErrorBody {
    code: &'static str,
    message: String,
}

enum ApiError {
    Workspace(Box<WorkspaceError>),
    Diagnostics(String),
    /// The audit log could not be read or exported, with the status to send.
    Audit(StatusCode, String),
    ServiceUnavailable,
    /// Shutdown has begun, so nothing new may start. See [`StartGate`].
    ShuttingDown,
    /// The selection names an invalid grant, root, or tool.
    InvalidSandbox(String),
    /// No sandbox can start on this host, or a session's sandbox failed to
    /// start, with the reason.
    SandboxUnavailable(String),
    /// Pi is missing or unusable, with discovery's corrective message.
    PiUnavailable(String),
    /// The workspace selects a sandbox, which Claude session launches cannot
    /// apply yet.
    SandboxedSessionUnsupported,
    /// A session request named an unknown agent, or a session of an agent
    /// other than Pi failed, with its status, code, and message.
    Agent(StatusCode, &'static str, String),
    /// A session control or lifecycle operation failed.
    Session(Box<pau_pi::PiSessionRegistryError>),
    /// The requested native session cannot be resumed.
    NativeSession(pau_pi::PiSessionFileError),
    /// An extension UI answer was refused, with its status, code, and message.
    ExtensionRequest(StatusCode, &'static str, String),
    /// A prompt image was refused, with its code and message.
    InvalidImage(&'static str, String),
    /// A preferences document failed validation.
    InvalidPreferences(String),
    /// The preferences database could not be read or written.
    Preferences(String),
}

impl ApiError {
    /// The response status, stable error code, and message.
    fn parts(&self) -> (StatusCode, &'static str, String) {
        match self {
            Self::Diagnostics(message) => (
                StatusCode::BAD_REQUEST,
                "diagnostics_error",
                message.clone(),
            ),
            Self::Audit(status, message) => (*status, "audit_error", message.clone()),
            Self::InvalidSandbox(message) => {
                (StatusCode::BAD_REQUEST, "invalid_sandbox", message.clone())
            }
            Self::SandboxUnavailable(message) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "sandbox_unavailable",
                message.clone(),
            ),
            Self::PiUnavailable(message) => {
                (StatusCode::SERVICE_UNAVAILABLE, "pi_unavailable", message.clone())
            }
            Self::SandboxedSessionUnsupported => (
                StatusCode::NOT_IMPLEMENTED,
                "sandboxed_session_unsupported",
                "Sandboxed Claude Code sessions cannot start from the desktop yet. Start a Pi session, or turn off the sandbox for this workspace.".to_owned(),
            ),
            Self::NativeSession(error) => {
                let (status, code) = match error {
                    pau_pi::PiSessionFileError::NotFound(_) => {
                        (StatusCode::NOT_FOUND, "native_session_not_found")
                    }
                    pau_pi::PiSessionFileError::Malformed(_) => {
                        (StatusCode::UNPROCESSABLE_ENTITY, "invalid_native_session")
                    }
                };
                (status, code, error.to_string())
            }
            Self::ExtensionRequest(status, code, message) | Self::Agent(status, code, message) => {
                (*status, code, message.clone())
            }
            Self::InvalidPreferences(message) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_preferences",
                message.clone(),
            ),
            Self::Preferences(message) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "preferences_error", message.clone())
            }
            Self::InvalidImage(code, message) => {
                (StatusCode::UNPROCESSABLE_ENTITY, code, message.clone())
            }
            Self::Session(error) => sessions::error_response(error),
            Self::ShuttingDown => (
                StatusCode::SERVICE_UNAVAILABLE,
                "shutting_down",
                "Pau is shutting down, so it cannot start anything new.".to_owned(),
            ),
            Self::ServiceUnavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                "workspace_service_unavailable",
                "workspace service is unavailable".to_owned(),
            ),
            Self::Workspace(error) => {
                let (status, code) = match error.as_ref() {
                    WorkspaceError::NotFound => (StatusCode::NOT_FOUND, "not_found"),
                    WorkspaceError::InvalidPath => (StatusCode::BAD_REQUEST, "invalid_path"),
                    WorkspaceError::Conflict => (StatusCode::CONFLICT, "file_changed"),
                    WorkspaceError::SensitivePath => (StatusCode::FORBIDDEN, "sensitive_path"),
                    WorkspaceError::BinaryFile => (StatusCode::UNPROCESSABLE_ENTITY, "binary_file"),
                    WorkspaceError::FileTooLarge => {
                        (StatusCode::PAYLOAD_TOO_LARGE, "file_too_large")
                    }
                    WorkspaceError::InvalidEncoding => {
                        (StatusCode::UNPROCESSABLE_ENTITY, "invalid_encoding")
                    }
                    WorkspaceError::ReadOnly => (StatusCode::FORBIDDEN, "read_only"),
                    WorkspaceError::WrongFileType => {
                        (StatusCode::UNPROCESSABLE_ENTITY, "wrong_file_type")
                    }
                    WorkspaceError::Io(error)
                        if error.kind() == io::ErrorKind::PermissionDenied =>
                    {
                        (StatusCode::FORBIDDEN, "permission_denied")
                    }
                    // Opening a folder that does not exist is an operator
                    // mistake, not a backend failure.
                    WorkspaceError::Io(error) if error.kind() == io::ErrorKind::NotFound => {
                        (StatusCode::NOT_FOUND, "not_found")
                    }
                    WorkspaceError::Persistence(_)
                    | WorkspaceError::Io(_)
                    | WorkspaceError::Git(_) => {
                        (StatusCode::INTERNAL_SERVER_ERROR, "internal_error")
                    }
                };
                (status, code, error.to_string())
            }
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, message) = self.parts();
        (status, Json(ApiErrorBody { code, message })).into_response()
    }
}

impl From<WorkspaceError> for ApiError {
    fn from(error: WorkspaceError) -> Self {
        Self::Workspace(Box::new(error))
    }
}

impl From<pau_pi::PiSessionRegistryError> for ApiError {
    fn from(error: pau_pi::PiSessionRegistryError) -> Self {
        Self::Session(Box::new(error))
    }
}

impl From<pau_pi::PiSessionError> for ApiError {
    fn from(error: pau_pi::PiSessionError) -> Self {
        pau_pi::PiSessionRegistryError::Session(error).into()
    }
}

fn workspace_service(state: &ApiState) -> Result<&WorkspaceService, ApiError> {
    state
        .workspaces
        .as_ref()
        .ok_or(ApiError::ServiceUnavailable)
}

#[derive(Deserialize)]
struct OpenWorkspaceRequest {
    path: String,
    name: Option<String>,
}

async fn open_workspace(
    State(state): State<ApiState>,
    Json(request): Json<OpenWorkspaceRequest>,
) -> Result<(StatusCode, Json<Workspace>), ApiError> {
    let service = workspace_service(&state)?;
    let workspace = service.open(request.path, request.name).await?;
    state.events.publish(
        workspace.updated_at.clone(),
        Some(workspace.id.clone()),
        None,
        ServerEventKind::WorkspaceChanged,
        serde_json::to_string(&workspace).expect("workspace is serializable"),
    );
    Ok((StatusCode::CREATED, Json(workspace)))
}

async fn list_workspaces(State(state): State<ApiState>) -> Result<Json<Vec<Workspace>>, ApiError> {
    let service = workspace_service(&state)?;
    service.registered().await.map(Json).map_err(ApiError::from)
}

#[derive(Default, Deserialize)]
struct ListFilesQuery {
    #[serde(default)]
    path: String,
    #[serde(default)]
    include_hidden: bool,
    #[serde(default)]
    include_ignored: bool,
}

async fn list_files(
    State(state): State<ApiState>,
    AxumPath(workspace_id): AxumPath<String>,
    Query(query): Query<ListFilesQuery>,
) -> Result<Json<Vec<FileEntry>>, ApiError> {
    let service = workspace_service(&state)?;
    let traversal = TraversalOptions {
        include_hidden: query.include_hidden,
        include_ignored: query.include_ignored,
    };
    service
        .list(&workspace_id, &query.path, traversal)
        .await
        .map(Json)
        .map_err(ApiError::from)
}

#[derive(Deserialize)]
struct FileQuery {
    path: String,
}

async fn read_file(
    State(state): State<ApiState>,
    AxumPath(workspace_id): AxumPath<String>,
    Query(query): Query<FileQuery>,
) -> Result<Json<FileContent>, ApiError> {
    let service = workspace_service(&state)?;
    service
        .read(&workspace_id, &query.path)
        .await
        .map(Json)
        .map_err(ApiError::from)
}

#[derive(Deserialize)]
struct WriteFileRequest {
    path: String,
    content: String,
    expected_revision: Option<String>,
}

async fn write_file(
    State(state): State<ApiState>,
    AxumPath(workspace_id): AxumPath<String>,
    Json(request): Json<WriteFileRequest>,
) -> Result<Json<FileContent>, ApiError> {
    let audit = PendingAudit::operator(
        &state.audit,
        AuditOperation::FileWrite,
        Some(workspace_id.clone()),
        Some(request.path.clone()),
    );
    let result = async {
        let written = workspace_service(&state)?
            .write(
                &workspace_id,
                &request.path,
                &request.content,
                request.expected_revision.as_deref(),
            )
            .await?;
        Ok(Json(written))
    }
    .await;
    audit.finish(&result);
    result
}

#[derive(Deserialize)]
struct SearchFilesQuery {
    query: String,
    limit: Option<usize>,
    #[serde(default)]
    include_hidden: bool,
    #[serde(default)]
    include_ignored: bool,
    #[serde(default, rename = "match")]
    match_kind: SearchMatch,
}

/// What `/api/workspaces/{id}/search` matches the query against.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
enum SearchMatch {
    /// File content, answered with a list of matching lines.
    #[default]
    Content,
    /// File and folder names, answered with a `NameSearchResult`.
    Names,
}

async fn search_files(
    State(state): State<ApiState>,
    AxumPath(workspace_id): AxumPath<String>,
    Query(query): Query<SearchFilesQuery>,
) -> Result<Response, ApiError> {
    let service = workspace_service(&state)?;
    let options = SearchOptions {
        query: query.query,
        traversal: TraversalOptions {
            include_hidden: query.include_hidden,
            include_ignored: query.include_ignored,
        },
        limit: query.limit,
    };
    Ok(match query.match_kind {
        SearchMatch::Content => Json(service.search(&workspace_id, options).await?).into_response(),
        SearchMatch::Names => {
            Json(service.search_names(&workspace_id, options).await?).into_response()
        }
    })
}

async fn git_status(
    State(state): State<ApiState>,
    AxumPath(workspace_id): AxumPath<String>,
) -> Result<Json<GitStatus>, ApiError> {
    let service = workspace_service(&state)?;
    service
        .git_status(&workspace_id)
        .await
        .map(Json)
        .map_err(ApiError::from)
}

async fn git_diff(
    State(state): State<ApiState>,
    AxumPath(workspace_id): AxumPath<String>,
    Query(query): Query<FileQuery>,
) -> Result<Json<GitDiff>, ApiError> {
    let service = workspace_service(&state)?;
    service
        .git_diff(&workspace_id, &query.path)
        .await
        .map(Json)
        .map_err(ApiError::from)
}

fn sandbox_api(state: &ApiState) -> Result<&SandboxApi, ApiError> {
    state.sandbox.as_ref().ok_or(ApiError::ServiceUnavailable)
}

async fn workspace_sandbox(
    state: &ApiState,
    workspace_id: &str,
) -> Result<WorkspaceSandbox, ApiError> {
    let sandbox = sandbox_api(state)?;
    // Confirms the workspace exists before reading its selection.
    workspace_service(state)?.root(workspace_id).await?;
    let selection = sandbox
        .selections
        .get(workspace_id, None)
        .await
        .map_err(|error| ApiError::from(WorkspaceError::from(error)))?
        .workspace_default;
    Ok(WorkspaceSandbox {
        selection,
        unavailable: sandbox.executables.as_ref().err().cloned(),
        terminal_unavailable: sandbox.terminal_unavailable(),
    })
}

async fn get_workspace_sandbox(
    State(state): State<ApiState>,
    AxumPath(workspace_id): AxumPath<String>,
) -> Result<Json<WorkspaceSandbox>, ApiError> {
    workspace_sandbox(&state, &workspace_id).await.map(Json)
}

/// Stores the workspace default for new sessions. Validation runs first, so
/// an invalid grant never reaches a launch.
async fn update_workspace_sandbox(
    State(state): State<ApiState>,
    AxumPath(workspace_id): AxumPath<String>,
    Json(selection): Json<SandboxSelection>,
) -> Result<Json<WorkspaceSandbox>, ApiError> {
    let profile = match selection.settings() {
        None => "unsandboxed".to_owned(),
        Some(settings) => serde_json::to_value(settings.profile)
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .unwrap_or_default(),
    };
    let audit = PendingAudit::operator(
        &state.audit,
        AuditOperation::SandboxUpdate,
        Some(workspace_id.clone()),
        Some(profile),
    );
    let result = store_workspace_sandbox(&state, &workspace_id, selection).await;
    audit.finish(&result);
    result
}

async fn store_workspace_sandbox(
    state: &ApiState,
    workspace_id: &str,
    selection: SandboxSelection,
) -> Result<Json<WorkspaceSandbox>, ApiError> {
    validate_selection(&selection).map_err(|error| ApiError::InvalidSandbox(error.to_string()))?;
    let root = workspace_service(state)?.root(workspace_id).await?;
    let sandbox = sandbox_api(state)?;
    if selection.settings().is_some() {
        describe(
            sandbox,
            &root,
            workspace_id,
            &SandboxPreviewRequest {
                adapter: pau_core::sandbox::SandboxAdapter::Pi,
                selection: selection.clone(),
            },
        )?;
    }
    let timestamp = diagnostic_timestamp();
    sandbox
        .selections
        .set_workspace_default(workspace_id, &selection, &timestamp)
        .await
        .map_err(|error| ApiError::from(WorkspaceError::from(error)))?;
    let stored = workspace_sandbox(state, workspace_id).await?;
    // Lets an open terminal panel offer or withdraw sandboxed terminals.
    state.events.publish(
        timestamp,
        Some(workspace_id.to_owned()),
        None,
        ServerEventKind::SandboxChanged,
        serde_json::to_string(&stored.selection).expect("selection is serializable"),
    );
    Ok(Json(stored))
}

/// Describes the profile a selection would enforce, before anything runs.
async fn preview_sandbox(
    State(state): State<ApiState>,
    AxumPath(workspace_id): AxumPath<String>,
    Json(request): Json<SandboxPreviewRequest>,
) -> Result<Json<Option<EffectiveSandbox>>, ApiError> {
    let root = workspace_service(&state)?.root(&workspace_id).await?;
    describe(sandbox_api(&state)?, &root, &workspace_id, &request).map(Json)
}

fn describe(
    sandbox: &SandboxApi,
    workspace: &std::path::Path,
    workspace_id: &str,
    request: &SandboxPreviewRequest,
) -> Result<Option<EffectiveSandbox>, ApiError> {
    let Some(settings) = request.selection.settings() else {
        return Ok(None);
    };
    let executables = sandbox
        .executables
        .as_ref()
        .map_err(|error| ApiError::SandboxUnavailable(error.clone()))?;
    let credential_environment = credential_environment(settings);
    resolve_sandbox(&SandboxLaunchInput {
        adapter: request.adapter,
        settings,
        workspace,
        home: &sandbox.home,
        session_directory: &sandbox.sessions.join(format!("preview-{workspace_id}")),
        executables,
        runtime_roots: &[],
        tool_path: &sandbox.tool_path,
        credential_environment: &credential_environment,
    })
    .map(|resolved| Some(resolved.effective))
    .map_err(|error| ApiError::InvalidSandbox(error.to_string()))
}

/// The host values of the variables a profile's credential references name.
/// An unset variable is left out, and the resolver reports it.
fn credential_environment(settings: &SandboxSettings) -> BTreeMap<String, String> {
    settings
        .credential_references
        .iter()
        .filter_map(|reference| {
            env::var(&reference.source)
                .ok()
                .map(|value| (reference.source.clone(), value))
        })
        .collect()
}

#[derive(Deserialize)]
struct EventQuery {
    after: Option<u64>,
    /// Workspace whose files the client shows. The server watches it for
    /// changes while this connection stays open.
    watch: Option<String>,
}

async fn websocket(
    State(state): State<ApiState>,
    Query(query): Query<EventQuery>,
    upgrade: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    let lease = match &query.watch {
        Some(workspace_id) => {
            let root = workspace_service(&state)?.root(workspace_id).await?;
            Some(state.watches.acquire(workspace_id, &root, &state.events)?)
        }
        None => None,
    };
    let subscription = state.events.subscribe(query.after);
    Ok(upgrade
        .protocols(["pau"])
        .on_upgrade(move |socket| stream_events(socket, subscription, lease)))
}

/// Sends events until the client disconnects. A watch lease lives exactly as
/// long as this task, so the stream also reads the socket to notice a client
/// that closed while no events were flowing.
async fn stream_events(
    mut socket: WebSocket,
    mut subscription: EventSubscription,
    _lease: Option<WatchLease>,
) {
    for message in subscription.initial.drain(..) {
        if send_stream_message(&mut socket, &message).await.is_err() {
            return;
        }
    }

    loop {
        let received = tokio::select! {
            received = subscription.receiver.recv() => received,
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_)) | Err(_)) | None => return,
                Some(Ok(_)) => continue,
            },
        };
        match received {
            Ok(event) if event.sequence > subscription.boundary => {
                subscription.boundary = event.sequence;
                if send_stream_message(&mut socket, &ServerStreamMessage::Event { event })
                    .await
                    .is_err()
                {
                    return;
                }
            }
            Ok(_) => {}
            Err(broadcast::error::RecvError::Lagged(count)) => {
                record_slow_consumer(&subscription, count);
                return;
            }
            Err(broadcast::error::RecvError::Closed) => return,
        }
    }
}

fn record_slow_consumer(subscription: &EventSubscription, count: u64) {
    if let Some(diagnostics) = &subscription.diagnostics {
        diagnostics.update_transport(TransportDiagnostic {
            name: "websocket".to_owned(),
            state: "slow_consumer".to_owned(),
            reconnects: subscription.reconnects,
            last_sequence: Some(subscription.boundary),
            replay_gaps: subscription.replay_gaps,
            queue_depth: LIVE_EVENT_CAPACITY as u64,
            dropped_updates: count,
        });
        diagnostics.record(DiagnosticRecordInput {
            timestamp: diagnostic_timestamp(),
            component: "pau-server".to_owned(),
            level: DiagnosticLevel::Warn,
            operation: "event.slow_consumer".to_owned(),
            process_id: None,
            session_id: None,
            metadata: BTreeMap::from([
                ("queue_capacity".to_owned(), LIVE_EVENT_CAPACITY.to_string()),
                ("dropped_count".to_owned(), count.to_string()),
            ]),
        });
    }
}

async fn send_stream_message(
    socket: &mut WebSocket,
    message: &ServerStreamMessage,
) -> Result<(), axum::Error> {
    let json = serde_json::to_string(message).expect("server stream messages are serializable");
    socket.send(Message::Text(json.into())).await
}

/// A running local server and its graceful-shutdown signal.
#[derive(Debug)]
pub struct ServerHandle {
    address: SocketAddr,
    token: ApiToken,
    events: EventHub,
    diagnostics: Diagnostics,
    sessions: SessionApi,
    terminals: terminals::TerminalRegistry,
    audit: AuditLog,
    starts: StartGate,
    shutdown: Option<oneshot::Sender<()>>,
    task: Option<JoinHandle<io::Result<()>>>,
    /// Samples resource use until shutdown. See `process_usage`.
    process_usage: JoinHandle<()>,
}

impl ServerHandle {
    /// Returns the loopback address selected by the operating system.
    pub fn local_addr(&self) -> SocketAddr {
        self.address
    }

    /// Returns the bearer token generated for this server launch.
    pub fn token(&self) -> &ApiToken {
        &self.token
    }

    /// Reports whether each supported agent can start a session.
    ///
    /// Shares the cached report behind `GET /api/agents/readiness`, so a
    /// startup check spares the first view from launching Pi again. The
    /// returned future does not borrow the handle, so the caller can keep the
    /// handle available for shutdown while the check runs.
    pub fn agent_readiness(
        &self,
    ) -> impl Future<Output = pau_core::readiness::AgentReadinessReport> + Send + 'static {
        let sessions = self.sessions.clone();
        async move { sessions.readiness(false).await }
    }

    /// Returns the event hub used by this server.
    pub fn events(&self) -> &EventHub {
        &self.events
    }

    /// Starts graceful shutdown without waiting for the listener task.
    ///
    /// From this call on, session and terminal starts are refused. See
    /// [`StartGate`].
    pub fn request_shutdown(&mut self) {
        self.starts.close();
        self.process_usage.abort();
        if let Some(shutdown) = self.shutdown.take() {
            self.diagnostics.record(DiagnosticRecordInput {
                timestamp: diagnostic_timestamp(),
                component: "pau-server".to_owned(),
                level: DiagnosticLevel::Info,
                operation: "process.stopping".to_owned(),
                process_id: Some("pau-server".to_owned()),
                session_id: None,
                metadata: BTreeMap::from([("state".to_owned(), "stopping".to_owned())]),
            });
            let _ = shutdown.send(());
        }
    }

    /// Stops the server, its sessions and its terminals, and stores the final
    /// audit records, all within [`SHUTDOWN_LIMIT`].
    ///
    /// Callers must await this before the Tokio runtime ends, so the final
    /// audit records reach the database. Starts are refused from the first
    /// step. The listener gets [`LISTENER_STOP_LIMIT`] to finish open
    /// requests and is then aborted, which returns a
    /// [`io::ErrorKind::TimedOut`] error. Aborting it does not end the
    /// requests already running, so the stops wait for the starts still in
    /// flight, as [`StartGate`] describes. Sessions and terminals then stop
    /// at the same time. Any still running
    /// [`KILL_GRACE`] before the drain's share begins are killed with their
    /// process groups, so nothing Pau started outlives it.
    pub async fn shutdown(mut self) -> io::Result<()> {
        let started = tokio::time::Instant::now();
        self.request_shutdown();
        let mut task = self
            .task
            .take()
            .expect("server task is present until shutdown");
        let result = match tokio::time::timeout(LISTENER_STOP_LIMIT, &mut task).await {
            Ok(joined) => joined.map_err(io::Error::other).and_then(|result| result),
            Err(_) => {
                task.abort();
                tracing::warn!(
                    event = "server.listener_aborted",
                    limit_ms = LISTENER_STOP_LIMIT.as_millis(),
                    "open requests kept the listener running, so shutdown aborted it"
                );
                Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "open requests kept the listener running past its limit",
                ))
            }
        };
        let kill_at = started + SHUTDOWN_LIMIT - AUDIT_CLOSE_LIMIT - KILL_GRACE;
        stop_within_limit(
            vec![
                ShutdownStep {
                    name: "sessions",
                    work: Box::pin(async {
                        self.starts.settled(kill_at).await;
                        self.sessions.stop_all(kill_at).await;
                    }),
                },
                ShutdownStep {
                    name: "terminals",
                    work: Box::pin(async {
                        self.starts.settled(kill_at).await;
                        self.terminals.stop_all(&self.audit, kill_at).await;
                    }),
                },
            ],
            started,
            &self.audit,
        )
        .await;
        self.diagnostics.record(DiagnosticRecordInput {
            timestamp: diagnostic_timestamp(),
            component: "pau-server".to_owned(),
            level: if result.is_ok() {
                DiagnosticLevel::Info
            } else {
                DiagnosticLevel::Error
            },
            operation: "process.exited".to_owned(),
            process_id: Some("pau-server".to_owned()),
            session_id: None,
            metadata: BTreeMap::from([(
                "exit_code".to_owned(),
                if result.is_ok() { "0" } else { "1" }.to_owned(),
            )]),
        });
        result
    }
}

/// Longest time [`ServerHandle::shutdown`] takes, from the shutdown request
/// to the last stored audit record.
///
/// Quitting the app waits for shutdown, so a session or terminal that will
/// not stop must not hold the app open. The audit drain keeps
/// [`AUDIT_CLOSE_LIMIT`] of this for itself, and the steps before it share
/// the rest.
pub const SHUTDOWN_LIMIT: Duration = Duration::from_secs(10);

/// Longest time shutdown waits for open requests before it aborts the
/// listener, so a client that stalls mid-request cannot use up the time the
/// session and terminal stops need.
const LISTENER_STOP_LIMIT: Duration = Duration::from_secs(1);

/// Time shutdown leaves between killing the sessions and terminals still
/// running and the start of the audit drain, for the killed processes to be
/// reaped and their stops recorded.
const KILL_GRACE: Duration = Duration::from_secs(1);

/// One shutdown step that runs before the audit drain.
struct ShutdownStep<'a> {
    /// Names the step in the log when it does not finish.
    name: &'static str,
    work: Pin<Box<dyn Future<Output = ()> + Send + 'a>>,
}

/// Runs `steps` at the same time, then writes the records queued on `audit`,
/// and returns within [`SHUTDOWN_LIMIT`] of `started`.
///
/// The steps must finish before the limit minus [`AUDIT_CLOSE_LIMIT`], so the
/// drain keeps its share however slow they are. A step still running at
/// that point is dropped. Returns the names of the steps that did not
/// finish, which it also logs.
async fn stop_within_limit(
    steps: Vec<ShutdownStep<'_>>,
    started: tokio::time::Instant,
    audit: &AuditLog,
) -> Vec<&'static str> {
    let mut running = steps;
    let all = std::future::poll_fn(|context| {
        running.retain_mut(|step| step.work.as_mut().poll(context).is_pending());
        if running.is_empty() {
            std::task::Poll::Ready(())
        } else {
            std::task::Poll::Pending
        }
    });
    let _ = tokio::time::timeout_at(started + (SHUTDOWN_LIMIT - AUDIT_CLOSE_LIMIT), all).await;
    let mut unfinished: Vec<_> = running.iter().map(|step| step.name).collect();
    if !audit.close().await {
        unfinished.push("audit");
    }
    if !unfinished.is_empty() {
        tracing::warn!(
            event = "server.shutdown_incomplete",
            limit_ms = SHUTDOWN_LIMIT.as_millis(),
            unfinished = %unfinished.join(", "),
            "Pau quit before every shutdown step finished"
        );
    }
    unfinished
}

/// Runs `stop` and, when it is still running at `kill_at`, calls `kill` and
/// keeps waiting, so the stop ends with the killed process's exit and its
/// caller still records it.
pub(crate) async fn stop_or_kill<T>(
    stop: impl Future<Output = T>,
    kill_at: tokio::time::Instant,
    kill: impl FnOnce(),
) -> T {
    let mut stop = std::pin::pin!(stop);
    tokio::select! {
        output = &mut stop => output,
        () = tokio::time::sleep_until(kill_at) => {
            kill();
            stop.await
        }
    }
}

impl Drop for ServerHandle {
    fn drop(&mut self) {
        self.request_shutdown();
    }
}

/// Options selected at process startup.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ServerOptions {
    /// Enables release diagnostics before the settings UI is available.
    pub diagnostics: bool,
    /// The `PATH` used to find agents and sandbox tools and given to every
    /// child process: agents, terminals, Git, and discovery probes. `None`
    /// uses the server's own.
    ///
    /// The desktop app passes its login shell `PATH` here instead of
    /// changing its own environment, which its other threads may be reading.
    pub path: Option<OsString>,
    /// Executable that runs the sandboxed terminal relay when its first
    /// argument is [`pau_term::relay::RELAY_ARGUMENT`], usually the running
    /// executable after it called [`pau_term::relay::run_if_requested`].
    /// `None` makes sandboxed terminals unavailable.
    pub terminal_relay: Option<PathBuf>,
    /// The desktop app's resource directory. A release build loads the
    /// sandbox extension bundled there. Development builds, and a release
    /// build given `None`, load it from the checkout the server was built
    /// from.
    pub resource_directory: Option<PathBuf>,
}

/// Starts the shared API with a new per-launch token.
///
/// Pass port `0` to let the operating system choose an unused port.
pub async fn start(address: SocketAddr) -> io::Result<ServerHandle> {
    start_with_options(address, ServerOptions::default()).await
}

/// Starts the shared API with process options and a new per-launch token.
pub async fn start_with_options(
    address: SocketAddr,
    options: ServerOptions,
) -> io::Result<ServerHandle> {
    start_with_token_and_options(address, ApiToken::generate()?, options).await
}

/// Starts the shared API with an explicitly configured token.
///
/// This entry point supports browser development, where Vite and the server
/// share a token from `.env` or one the server reads on standard input.
pub async fn start_with_token(address: SocketAddr, token: ApiToken) -> io::Result<ServerHandle> {
    start_with_token_and_options(address, token, ServerOptions::default()).await
}

/// Starts the shared API with a configured token and process options.
pub async fn start_with_token_and_options(
    address: SocketAddr,
    token: ApiToken,
    options: ServerOptions,
) -> io::Result<ServerHandle> {
    require_loopback(address)?;
    let database = open_database().await?;
    start_with_database(address, token, options, database).await
}

/// The Pau database, opened and migrated, waiting for
/// [`start_with_database`].
pub struct ServerDatabase(Database);

/// Opens and migrates the Pau database at its default location.
///
/// The location is `PAU_DATABASE_PATH` when set, or `pau.sqlite3` in the build
/// channel's local data directory.
///
/// # Errors
///
/// Fails when the data directory cannot be created or the database cannot be
/// opened. A database from a newer Pau fails with a wrapped
/// [`pau_core::persistence::OpenError::NewerSchema`] and is left unchanged.
pub async fn open_database() -> io::Result<ServerDatabase> {
    if cfg!(test) {
        return open_database_at(Path::new(":memory:")).await;
    }
    let path = database_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    open_database_at(&path).await
}

/// Opens and migrates the Pau database at `path`.
///
/// # Errors
///
/// Fails as [`open_database`] does, without creating parent directories.
pub async fn open_database_at(path: &Path) -> io::Result<ServerDatabase> {
    Database::open(path)
        .await
        .map(ServerDatabase)
        .map_err(io::Error::other)
}

fn require_loopback(address: SocketAddr) -> io::Result<()> {
    if address.ip().is_loopback() {
        return Ok(());
    }
    Err(io::Error::new(
        io::ErrorKind::InvalidInput,
        "the local Pau server must bind to a loopback address",
    ))
}

/// Starts the shared API on a database that is already open.
///
/// The desktop shell opens the database and starts the server as separate
/// steps so it can report each one.
pub async fn start_with_database(
    address: SocketAddr,
    token: ApiToken,
    options: ServerOptions,
    ServerDatabase(database): ServerDatabase,
) -> io::Result<ServerHandle> {
    require_loopback(address)?;
    let settings = database.settings();
    let persisted_diagnostics = settings
        .get(DIAGNOSTICS_SETTING_KEY)
        .await
        .map_err(io::Error::other)?
        .is_some_and(|setting| setting.value == "true");
    let path = options
        .path
        .unwrap_or_else(|| env::var_os("PATH").unwrap_or_default());
    let workspaces = WorkspaceService::new(database.workspaces())
        .with_processes(database.processes())
        .with_path(path.clone());
    let sandbox = SandboxApi::new(
        database.sandbox_selection(),
        state_directory()?.join("sandbox"),
        path.clone(),
    )
    .with_terminal_relay(options.terminal_relay)
    .with_extension(SandboxExtension::locate(
        build_channel(),
        options.resource_directory.as_deref(),
    ));
    let processes = database.processes();
    let diagnostics = default_diagnostics();
    diagnostics.register_sensitive_value(token.expose());
    diagnostics.set_enabled(options.diagnostics || persisted_diagnostics);
    let audit = AuditLog::new(database.audit(), diagnostics.redactor());

    let listener = TcpListener::bind(address).await?;
    let address = listener.local_addr()?;
    let (shutdown, shutdown_receiver) = oneshot::channel();
    let server_token = token.clone();
    let events = EventHub::default().with_diagnostics(diagnostics.clone());
    let sessions = SessionApi::new(
        pau_pi::PiSessionRegistry::new(processes)
            .with_placeholder_users(sandbox.placeholders.clone()),
        pau_pi::DiscoverPiOptions {
            path,
            ..pau_pi::DiscoverPiOptions::default()
        },
        events.clone(),
        audit.clone(),
    );
    let usage_sessions = sessions.clone();
    let process_usage = process_usage::spawn(process_usage::ProcessUsageSampling {
        events: events.clone(),
        sampler: pau_core::resource_monitor::SystemProcessSampler::default(),
        roots: move || {
            let sessions = usage_sessions.clone();
            async move { sessions.usage_roots().await }
        },
        interval: process_usage::SAMPLE_INTERVAL,
        pau_pid: std::process::id(),
    });
    let terminals = terminals::TerminalRegistry::default();
    let server_sessions = sessions.clone();
    let server_events = events.clone();
    let server_diagnostics = diagnostics.clone();
    let server_settings = settings.clone();
    let server_audit = audit.clone();
    let server_terminals = terminals.clone();
    let starts = StartGate::default();
    let server_starts = starts.clone();
    let dispatch = tracing::dispatcher::get_default(Clone::clone);
    let task = tokio::spawn(
        async move {
            axum::serve(
                listener,
                router_with_services(
                    server_token,
                    server_events,
                    server_diagnostics,
                    ApiServices {
                        workspaces: Some(workspaces),
                        settings: Some(server_settings),
                        sandbox: Some(sandbox),
                        sessions: Some(server_sessions),
                        audit: server_audit,
                        terminals: server_terminals,
                        starts: server_starts,
                    },
                ),
            )
            .with_graceful_shutdown(async move {
                let _ = shutdown_receiver.await;
            })
            .await
        }
        .with_subscriber(dispatch),
    );

    diagnostics.record(DiagnosticRecordInput {
        timestamp: diagnostic_timestamp(),
        component: "pau-server".to_owned(),
        level: DiagnosticLevel::Info,
        operation: "process.started".to_owned(),
        process_id: Some("pau-server".to_owned()),
        session_id: None,
        metadata: BTreeMap::from([("pid".to_owned(), std::process::id().to_string())]),
    });
    tracing::info!(
        event = "server.started",
        address = %address,
        "local API server started"
    );

    Ok(ServerHandle {
        address,
        token,
        events,
        diagnostics,
        sessions,
        terminals,
        audit,
        starts,
        shutdown: Some(shutdown),
        task: Some(task),
        process_usage,
    })
}

/// Directory that holds Pau's database and per-session sandbox state.
fn state_directory() -> io::Result<PathBuf> {
    database_path()?.parent().map(PathBuf::from).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "the database has no parent directory",
        )
    })
}

fn database_path() -> io::Result<PathBuf> {
    if let Some(path) = env::var_os("PAU_DATABASE_PATH") {
        return Ok(PathBuf::from(path));
    }
    dirs::data_local_dir()
        .map(|directory| {
            directory
                .join(build_channel().data_dir_name())
                .join("pau.sqlite3")
        })
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "local data directory is unavailable",
            )
        })
}

#[cfg(test)]
pub(crate) mod tests {
    use std::{
        fs,
        net::Ipv4Addr,
        sync::{Arc, Mutex},
        time::Duration,
    };

    use axum::body::{Body, to_bytes};
    use pau_core::{
        audit::{AuditActor, AuditEntry, AuditRecord, AuditResult},
        diagnostics::Redactor,
        workspace::{FileSearchMatch, NameSearchResult},
    };
    use tempfile::tempdir;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpStream,
        time::timeout,
    };
    use tower::ServiceExt;
    use tracing_subscriber::fmt::MakeWriter;

    use super::*;

    const TEST_TOKEN: &str = "0123456789abcdef0123456789abcdef";

    /// Collects formatted log output for assertions.
    #[derive(Clone, Default)]
    pub(crate) struct LogBuffer(Arc<Mutex<Vec<u8>>>);

    pub(crate) struct LogWriter(Arc<Mutex<Vec<u8>>>);

    impl io::Write for LogWriter {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    impl<'a> MakeWriter<'a> for LogBuffer {
        type Writer = LogWriter;

        fn make_writer(&'a self) -> Self::Writer {
            LogWriter(Arc::clone(&self.0))
        }
    }

    impl LogBuffer {
        pub(crate) fn contents(&self) -> String {
            String::from_utf8(self.0.lock().unwrap().clone()).unwrap()
        }
    }

    fn test_token() -> ApiToken {
        ApiToken::configured(TEST_TOKEN).unwrap()
    }

    async fn response(address: SocketAddr, request: &str, read_to_end: bool) -> String {
        let mut stream = TcpStream::connect(address).await.unwrap();
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut bytes = Vec::new();
        if read_to_end {
            stream.read_to_end(&mut bytes).await.unwrap();
        } else {
            loop {
                let mut chunk = [0_u8; 512];
                let count = timeout(Duration::from_secs(1), stream.read(&mut chunk))
                    .await
                    .unwrap()
                    .unwrap();
                bytes.extend_from_slice(&chunk[..count]);
                if count == 0 || bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
        }
        if !read_to_end
            && let Some(header_end) = bytes.windows(4).position(|window| window == b"\r\n\r\n")
        {
            bytes.truncate(header_end + 4);
        }
        String::from_utf8(bytes).unwrap()
    }

    fn get(path: &str, authorization: Option<&str>) -> String {
        let authorization = authorization
            .map(|value| format!("Authorization: Bearer {value}\r\n"))
            .unwrap_or_default();
        format!(
            "GET {path} HTTP/1.1\r\nHost: localhost\r\n{authorization}Connection: close\r\n\r\n"
        )
    }

    fn websocket_request(token: Option<&str>) -> String {
        let protocols = token
            .map(|value| format!("Sec-WebSocket-Protocol: pau, pau.bearer.{value}\r\n"))
            .unwrap_or_default();
        format!(
            "GET /api/events HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n{protocols}\r\n"
        )
    }

    #[tokio::test]
    async fn protects_health_and_version_endpoints() {
        let server = start_with_token((Ipv4Addr::LOCALHOST, 0).into(), test_token())
            .await
            .unwrap();

        for path in ["/api/health", "/api/version"] {
            let missing = response(server.local_addr(), &get(path, None), true).await;
            assert!(missing.starts_with("HTTP/1.1 401 Unauthorized"));

            let invalid = response(server.local_addr(), &get(path, Some("invalid")), true).await;
            assert!(invalid.starts_with("HTTP/1.1 401 Unauthorized"));
        }

        let health = response(
            server.local_addr(),
            &get("/api/health", Some(TEST_TOKEN)),
            true,
        )
        .await;
        assert!(health.starts_with("HTTP/1.1 200 OK"));
        assert!(health.ends_with("{\"healthy\":true}"));

        let version = response(
            server.local_addr(),
            &get("/api/version", Some(TEST_TOKEN)),
            true,
        )
        .await;
        assert!(version.starts_with("HTTP/1.1 200 OK"));
        assert!(version.ends_with(&format!("{{\"version\":\"{VERSION}\"}}")));

        server.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn protects_websocket_handshakes() {
        let server = start_with_token((Ipv4Addr::LOCALHOST, 0).into(), test_token())
            .await
            .unwrap();

        for authorization in [None, Some("invalid")] {
            let handshake = response(
                server.local_addr(),
                &websocket_request(authorization),
                false,
            )
            .await;
            assert!(handshake.starts_with("HTTP/1.1 401 Unauthorized"));
        }

        let handshake = response(
            server.local_addr(),
            &websocket_request(Some(TEST_TOKEN)),
            false,
        )
        .await;
        assert!(handshake.starts_with("HTTP/1.1 101 Switching Protocols"));
        assert!(
            handshake
                .to_ascii_lowercase()
                .contains("sec-websocket-protocol: pau")
        );

        server.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn diagnostics_do_not_contain_tokens_or_supplied_secrets() {
        let logs = LogBuffer::default();
        let subscriber = tracing_subscriber::fmt()
            .json()
            .with_ansi(false)
            .with_max_level(tracing::Level::TRACE)
            .with_writer(logs.clone())
            .finish();
        let subscriber = tracing::Dispatch::new(subscriber);
        // While only one subscriber is registered, tracing caches a new
        // callsite's interest from the default subscriber of whichever thread
        // reaches it first. A parallel test thread without a subscriber would
        // then disable `api.authentication_failed` for this test as well. A
        // second registered subscriber makes tracing check each event against
        // the current thread's subscriber instead.
        let _second_subscriber = tracing::Dispatch::new(tracing::subscriber::NoSubscriber::new());
        let configured_secret = "configured-secret-that-must-not-appear";

        async {
            let request = Request::builder()
                .uri("/api/version")
                .header(header::AUTHORIZATION, format!("Bearer {configured_secret}"))
                .body(axum::body::Body::empty())
                .unwrap();
            let response = router(test_token()).oneshot(request).await.unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        }
        .with_subscriber(subscriber)
        .await;

        let logs = logs.contents();
        assert!(logs.contains("api.authentication_failed"), "{logs}");
        assert!(!logs.contains(TEST_TOKEN));
        assert!(!logs.contains(configured_secret));
        assert_eq!(format!("{:?}", test_token()), "ApiToken([REDACTED])");
    }

    #[tokio::test]
    async fn exposes_release_diagnostics_without_fault_controls() {
        let diagnostics = default_diagnostics();
        let app = router_with_diagnostics(test_token(), diagnostics.clone());
        let authorization = format!("Bearer {TEST_TOKEN}");
        let update = Request::builder()
            .method("PUT")
            .uri("/api/diagnostics/settings")
            .header(header::AUTHORIZATION, &authorization)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"enabled":true,"min_level":"debug"}"#))
            .unwrap();
        let response = app.clone().oneshot(update).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        diagnostics.register_sensitive_value("private-token");
        diagnostics.record(DiagnosticRecordInput {
            timestamp: "2026-04-01T12:00:00Z".to_owned(),
            component: "pau-agent".to_owned(),
            level: DiagnosticLevel::Info,
            operation: "process.started".to_owned(),
            process_id: Some("process-7".to_owned()),
            session_id: Some("session-3".to_owned()),
            metadata: BTreeMap::from([
                ("pid".to_owned(), "7312".to_owned()),
                ("prompt".to_owned(), "private-token".to_owned()),
            ]),
        });
        let get = Request::builder()
            .uri("/api/diagnostics")
            .header(header::AUTHORIZATION, &authorization)
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(get).await.unwrap();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body = String::from_utf8(body.to_vec()).unwrap();
        assert!(body.contains("process.started"));
        assert!(!body.contains("private-token"));

        let fault = Request::builder()
            .method("POST")
            .uri("/api/diagnostics/faults")
            .header(header::AUTHORIZATION, &authorization)
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.clone().oneshot(fault).await.unwrap().status(),
            StatusCode::NOT_FOUND
        );

        let unauthenticated = Request::builder()
            .uri("/api/diagnostics")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(unauthenticated).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[test]
    fn diagnostics_report_reconnects_replay_gaps_and_process_correlation() {
        let diagnostics = default_diagnostics();
        diagnostics.set_enabled(true);
        diagnostics.set_min_level(DiagnosticLevel::Debug);
        let events = EventHub::new(2).with_diagnostics(diagnostics.clone());
        publish_session(&events, "first");
        publish_session(&events, "second");
        publish_session(&events, "third");
        let _subscription = events.subscribe(Some(0));

        let bundle = diagnostics.snapshot(SystemTime::now());
        let websocket = bundle
            .transports
            .iter()
            .find(|transport| transport.name == "websocket")
            .unwrap();
        assert_eq!(websocket.reconnects, 1);
        assert_eq!(websocket.replay_gaps, 1);
        assert!(bundle.records.iter().any(|record| {
            record.operation == "event.published"
                && record.session_id.as_deref() == Some("session-1")
        }));
    }

    #[tokio::test]
    async fn records_slow_consumers_queue_pressure_and_dropped_updates() {
        let diagnostics = default_diagnostics();
        diagnostics.set_enabled(true);
        let events = EventHub::new(512).with_diagnostics(diagnostics.clone());
        let mut subscription = events.subscribe(None);
        for index in 0..(LIVE_EVENT_CAPACITY + 8) {
            publish_session(&events, &format!("event-{index}"));
        }
        let dropped = match subscription.receiver.recv().await {
            Err(broadcast::error::RecvError::Lagged(count)) => count,
            result => panic!("expected a lagged receiver, got {result:?}"),
        };
        record_slow_consumer(&subscription, dropped);

        let bundle = diagnostics.snapshot(SystemTime::now());
        let websocket = bundle
            .transports
            .iter()
            .find(|transport| transport.name == "websocket")
            .unwrap();
        assert_eq!(websocket.state, "slow_consumer");
        assert_eq!(websocket.queue_depth, LIVE_EVENT_CAPACITY as u64);
        assert_eq!(websocket.dropped_updates, 8);
        assert!(
            bundle
                .records
                .iter()
                .any(|record| record.operation == "event.slow_consumer")
        );
    }

    #[tokio::test]
    async fn stores_preferences_and_publishes_changes() {
        let database = Database::open(":memory:").await.unwrap();
        let events = EventHub::default();
        let app = router_with_services(
            test_token(),
            events.clone(),
            default_diagnostics(),
            ApiServices {
                settings: Some(database.settings()),
                ..ApiServices::default()
            },
        );
        let call = |method: &str, body: Option<serde_json::Value>| {
            let request = Request::builder()
                .method(method)
                .uri("/api/preferences")
                .header(header::AUTHORIZATION, format!("Bearer {TEST_TOKEN}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(body.map_or_else(Body::empty, |body| Body::from(body.to_string())))
                .unwrap();
            let app = app.clone();
            async move {
                let response = app.oneshot(request).await.unwrap();
                let status = response.status();
                let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
                (
                    status,
                    serde_json::from_slice::<serde_json::Value>(&body).ok(),
                )
            }
        };

        let (status, body) = call("GET", None).await;
        assert_eq!(status, StatusCode::OK);
        let mut preferences = body.unwrap();
        assert_eq!(preferences["motion"], "system");
        assert_eq!(preferences["version"], 1);

        preferences["motion"] = "reduce".into();
        preferences["pane_widths"]["inspector"] = 360.into();
        let (status, _) = call("PUT", Some(preferences.clone())).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(call("GET", None).await.1.unwrap(), preferences);
        assert_eq!(events.last_sequence(), 1);

        let mut unknown = preferences.clone();
        unknown["zoom"] = 2.into();
        assert!(call("PUT", Some(unknown)).await.0.is_client_error());
        let mut newer = preferences.clone();
        newer["version"] = 2.into();
        assert_eq!(
            call("PUT", Some(newer)).await.0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        let mut narrow = preferences;
        narrow["pane_widths"]["inspector"] = 3.into();
        assert_eq!(
            call("PUT", Some(narrow)).await.0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn stores_and_describes_workspace_sandbox_selections() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("project");
        fs::create_dir(&root).unwrap();
        let database = Database::open(":memory:").await.unwrap();
        let workspaces = WorkspaceService::new(database.workspaces());
        let workspace = workspaces.open(&root, None).await.unwrap();
        let sandbox = SandboxApi::new(
            database.sandbox_selection(),
            directory.path().join("sandbox"),
            env::var_os("PATH").unwrap_or_default(),
        );
        let available = sandbox.executables.is_ok();
        let events = EventHub::default();
        let app = router_with_services(
            test_token(),
            events.clone(),
            default_diagnostics(),
            ApiServices {
                workspaces: Some(workspaces),
                sandbox: Some(sandbox),
                ..ApiServices::default()
            },
        );
        let call = |method: &str, path: &str, body: Option<serde_json::Value>| {
            let builder = Request::builder()
                .method(method)
                .uri(format!("/api/workspaces/{}/{path}", workspace.id))
                .header(header::AUTHORIZATION, format!("Bearer {TEST_TOKEN}"))
                .header(header::CONTENT_TYPE, "application/json");
            let request = builder
                .body(body.map_or_else(Body::empty, |body| Body::from(body.to_string())))
                .unwrap();
            let app = app.clone();
            async move {
                let response = app.oneshot(request).await.unwrap();
                let status = response.status();
                let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
                (
                    status,
                    serde_json::from_slice::<serde_json::Value>(&bytes).unwrap_or_default(),
                )
            }
        };

        let (status, initial) = call("GET", "sandbox", None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            initial["selection"],
            serde_json::json!({"mode": "unsandboxed"})
        );

        let sandboxed = serde_json::json!({"mode": "sandboxed", "settings": {
            "profile": "workspace-write",
            "grants": {"domains": ["registry.npmjs.org"], "writable_roots": [], "unix_sockets": false}
        }});
        let invalid = serde_json::json!({"mode": "sandboxed", "settings": {
            "profile": "workspace-write",
            "grants": {"domains": ["https://registry.npmjs.org/"], "writable_roots": [], "unix_sockets": false}
        }});
        let (status, error) = call("PUT", "sandbox", Some(invalid)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(error["code"], "invalid_sandbox");

        let (status, preview) = call(
            "POST",
            "sandbox/preview",
            Some(serde_json::json!({"adapter": "claude", "selection": sandboxed})),
        )
        .await;
        if !available {
            assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
            return;
        }
        assert_eq!(status, StatusCode::OK);
        assert_eq!(preview["adapter"], "claude");
        assert_eq!(
            preview["network"]["domains"],
            serde_json::json!(["registry.npmjs.org"])
        );
        assert!(
            preview["disabled_tools"]
                .as_array()
                .unwrap()
                .iter()
                .any(|tool| tool == "WebFetch")
        );

        let (status, stored) = call("PUT", "sandbox", Some(sandboxed.clone())).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            stored["selection"]["settings"]["grants"],
            sandboxed["settings"]["grants"]
        );
        assert_eq!(stored["selection"]["settings"]["home_read_deny"], false);
        assert_eq!(call("GET", "sandbox", None).await.1, stored);
        let initial = events.subscribe(None).initial;
        let [ServerStreamMessage::Snapshot { snapshot }] = initial.as_slice() else {
            panic!("expected a snapshot");
        };
        let changed = snapshot
            .events
            .iter()
            .find(|event| event.kind == ServerEventKind::SandboxChanged)
            .expect("a sandbox change event");
        assert_eq!(changed.workspace_id.as_deref(), Some(workspace.id.as_str()));
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&changed.payload).unwrap(),
            stored["selection"]
        );

        let (status, unsandboxed) = call(
            "POST",
            "sandbox/preview",
            Some(serde_json::json!({"adapter": "pi", "selection": {"mode": "unsandboxed"}})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(unsandboxed.is_null());
    }

    #[tokio::test]
    async fn serves_workspace_and_file_apis() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("café project");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("note.txt"), "find this line\n").unwrap();
        fs::write(root.join(".hidden.txt"), "hidden marker\n").unwrap();
        let database = Database::open(":memory:").await.unwrap();
        let app = router_with_services(
            test_token(),
            EventHub::default(),
            default_diagnostics(),
            ApiServices {
                workspaces: Some(WorkspaceService::new(database.workspaces())),
                ..ApiServices::default()
            },
        );
        let authorization = format!("Bearer {TEST_TOKEN}");
        let open = Request::builder()
            .method("POST")
            .uri("/api/workspaces")
            .header(header::AUTHORIZATION, &authorization)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::json!({"path": root, "name": "Café"}).to_string(),
            ))
            .unwrap();
        let response = app.clone().oneshot(open).await.unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let workspace: Workspace =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();

        for (path, status, code) in [
            (root.join("missing"), StatusCode::NOT_FOUND, "not_found"),
            (
                root.join("note.txt"),
                StatusCode::UNPROCESSABLE_ENTITY,
                "wrong_file_type",
            ),
        ] {
            let rejected = Request::builder()
                .method("POST")
                .uri("/api/workspaces")
                .header(header::AUTHORIZATION, &authorization)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(serde_json::json!({"path": path}).to_string()))
                .unwrap();
            let response = app.clone().oneshot(rejected).await.unwrap();
            assert_eq!(response.status(), status);
            let body: serde_json::Value =
                serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                    .unwrap();
            assert_eq!(body["code"], code);
        }

        let list = Request::builder()
            .uri(format!(
                "/api/workspaces/{}/files?include_hidden=true",
                workspace.id
            ))
            .header(header::AUTHORIZATION, &authorization)
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(list).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let entries: Vec<FileEntry> =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert!(entries.iter().any(|entry| entry.path == ".hidden.txt"));

        let read = Request::builder()
            .uri(format!(
                "/api/workspaces/{}/file?path=note.txt",
                workspace.id
            ))
            .header(header::AUTHORIZATION, &authorization)
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(read).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let file: FileContent =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        fs::write(root.join("note.txt"), "changed elsewhere\n").unwrap();

        let write = Request::builder()
            .method("PUT")
            .uri(format!("/api/workspaces/{}/file", workspace.id))
            .header(header::AUTHORIZATION, &authorization)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::json!({
                    "path": "note.txt",
                    "content": "replacement\n",
                    "expected_revision": file.revision,
                })
                .to_string(),
            ))
            .unwrap();
        let response = app.clone().oneshot(write).await.unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);

        let search = Request::builder()
            .uri(format!(
                "/api/workspaces/{}/search?query=changed",
                workspace.id
            ))
            .header(header::AUTHORIZATION, &authorization)
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(search).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let matches: Vec<FileSearchMatch> =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].path, "note.txt");

        let names = Request::builder()
            .uri(format!(
                "/api/workspaces/{}/search?query=not&match=names&limit=1",
                workspace.id
            ))
            .header(header::AUTHORIZATION, &authorization)
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(names).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let names: NameSearchResult =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(names.entries.len(), 1);
        assert_eq!(names.entries[0].path, "note.txt");
        assert!(!names.truncated);

        let git_status = Request::builder()
            .uri(format!("/api/workspaces/{}/git/status", workspace.id))
            .header(header::AUTHORIZATION, &authorization)
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(git_status).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let status: GitStatus =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert!(!status.repository);

        let git = |arguments: &[&str]| {
            let output = std::process::Command::new("git")
                .current_dir(&root)
                .args(arguments)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&["init", "--quiet"]);
        git(&["config", "user.name", "Pau Tests"]);
        git(&["config", "user.email", "pau@example.invalid"]);
        git(&["add", "note.txt"]);
        git(&["commit", "--quiet", "-m", "fixture"]);
        fs::write(root.join("note.txt"), "diff content\n").unwrap();
        let diff = Request::builder()
            .uri(format!(
                "/api/workspaces/{}/git/diff?path=note.txt",
                workspace.id
            ))
            .header(header::AUTHORIZATION, &authorization)
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(diff).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let diff: GitDiff =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(diff.old_content.as_deref(), Some("changed elsewhere\n"));
        assert_eq!(diff.new_content.as_deref(), Some("diff content\n"));

        let hidden_search = Request::builder()
            .uri(format!(
                "/api/workspaces/{}/search?query=hidden&limit=1000&include_hidden=true",
                workspace.id
            ))
            .header(header::AUTHORIZATION, authorization)
            .body(Body::empty())
            .unwrap();
        let response = app.oneshot(hidden_search).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let matches: Vec<FileSearchMatch> =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].path, ".hidden.txt");
    }

    fn publish_session(events: &EventHub, payload: &str) -> ServerEvent {
        events.publish(
            "2026-04-01T12:00:00Z",
            Some("workspace-1".to_owned()),
            Some("session-1".to_owned()),
            ServerEventKind::SessionChanged,
            payload,
        )
    }

    fn event_sequences(messages: &[ServerStreamMessage]) -> Vec<u64> {
        messages
            .iter()
            .filter_map(|message| match message {
                ServerStreamMessage::Event { event } => Some(event.sequence),
                ServerStreamMessage::Snapshot { .. } => None,
            })
            .collect()
    }

    #[tokio::test]
    async fn reconnects_from_the_last_applied_sequence() {
        let events = EventHub::new(4);
        publish_session(&events, r#"{"text":"one"}"#);
        let first = events.subscribe(None);
        assert!(matches!(
            &first.initial[..],
            [ServerStreamMessage::Snapshot { snapshot }] if snapshot.sequence == 1
        ));
        drop(first);

        publish_session(&events, r#"{"text":"one two"}"#);
        publish_session(&events, r#"{"text":"one two three"}"#);
        let reconnected = events.subscribe(Some(1));

        assert_eq!(event_sequences(&reconnected.initial), vec![2, 3]);
    }

    #[test]
    fn sends_a_snapshot_when_the_replay_window_expired() {
        let events = EventHub::new(2);
        publish_session(&events, "first");
        publish_session(&events, "second");
        publish_session(&events, "third");

        let subscription = events.subscribe(Some(0));
        assert!(matches!(
            &subscription.initial[..],
            [ServerStreamMessage::Snapshot { snapshot }]
                if snapshot.sequence == 3
                    && snapshot.events.len() == 1
                    && snapshot.events[0].payload == "third"
        ));
    }

    #[tokio::test]
    async fn preserves_events_published_at_the_snapshot_boundary() {
        let events = EventHub::new(4);
        publish_session(&events, "snapshot");
        let mut subscription = events.subscribe(None);
        let raced = publish_session(&events, "raced");

        let received = subscription.receiver.recv().await.unwrap();
        assert_eq!(subscription.boundary, 1);
        assert_eq!(received, raced);
        assert_eq!(received.sequence, 2);
    }

    #[tokio::test]
    async fn shutdown_closes_the_listener() {
        let server = start((Ipv4Addr::LOCALHOST, 0).into()).await.unwrap();
        let address = server.local_addr();

        server.shutdown().await.unwrap();

        // Once the port is free, the client can draw it as its own source
        // port and connect to itself, which says nothing about the listener.
        if let Ok(stream) = timeout(Duration::from_secs(1), TcpStream::connect(address))
            .await
            .unwrap()
        {
            let local = stream.local_addr().unwrap();
            let peer = stream.peer_addr().unwrap();
            assert_eq!(local, peer, "the listener still accepts connections");
        }
    }

    #[tokio::test]
    async fn shutdown_stops_the_resource_sampler() {
        let server = start((Ipv4Addr::LOCALHOST, 0).into()).await.unwrap();
        let sampler = server.process_usage.abort_handle();
        assert!(!sampler.is_finished());

        server.shutdown().await.unwrap();

        timeout(Duration::from_secs(1), async {
            while !sampler.is_finished() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("the sampler outlived shutdown");
    }

    /// A client that stops halfway through a request must not keep the
    /// listener open long enough to cost the stops that follow it.
    #[tokio::test]
    async fn shutdown_aborts_a_listener_held_by_a_stalled_request() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("project");
        fs::create_dir(&root).unwrap();
        let ServerDatabase(database) = open_database_at(Path::new(":memory:")).await.unwrap();
        let server = start_with_database(
            (Ipv4Addr::LOCALHOST, 0).into(),
            test_token(),
            ServerOptions::default(),
            ServerDatabase(database.clone()),
        )
        .await
        .unwrap();
        let address = server.local_addr();
        let workspace = json_body(
            &response(
                address,
                &post("/api/workspaces", &serde_json::json!({ "path": root })),
                true,
            )
            .await,
        );
        response(
            address,
            &post(
                "/api/terminals",
                &serde_json::json!({
                    "workspace_id": workspace["id"],
                    "command": ["/bin/sh", "-c", "sleep 30"],
                    "size": {"cols": 80, "rows": 24},
                }),
            ),
            true,
        )
        .await;
        // The client asks to continue, so the server's reply shows the
        // handler is waiting on the body, which never comes in full.
        let mut stalled = TcpStream::connect(address).await.unwrap();
        stalled
            .write_all(
                format!(
                    "POST /api/terminals HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {TEST_TOKEN}\r\nContent-Type: application/json\r\nContent-Length: 100\r\nExpect: 100-continue\r\n\r\n"
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        let mut reply = [0_u8; 25];
        stalled.read_exact(&mut reply).await.unwrap();
        assert!(reply.starts_with(b"HTTP/1.1 100 Continue"));
        stalled.write_all(b"{\"workspace_id\":").await.unwrap();

        let started = tokio::time::Instant::now();
        let error = server.shutdown().await.unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(started.elapsed() < SHUTDOWN_LIMIT - AUDIT_CLOSE_LIMIT);
        let operations: Vec<_> = database
            .audit()
            .list()
            .await
            .unwrap()
            .iter()
            .map(|record| record.entry.operation)
            .collect();
        assert_eq!(
            operations,
            [AuditOperation::TerminalStart, AuditOperation::TerminalStop]
        );
        drop(stalled);
    }

    /// A request for `path` with a JSON `body` and the test token.
    fn post(path: &str, body: &serde_json::Value) -> String {
        let body = body.to_string();
        format!(
            "POST {path} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {TEST_TOKEN}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    /// The JSON body of a response read to its end.
    fn json_body(response: &str) -> serde_json::Value {
        let (_, body) = response.split_once("\r\n\r\n").unwrap();
        serde_json::from_str(body).unwrap()
    }

    /// The server binary drops its runtime as soon as shutdown returns, which
    /// cancels every task still running, so shutdown must have stored its own
    /// records by then.
    #[test]
    fn shutdown_stores_its_stops_before_the_runtime_ends() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("project");
        fs::create_dir(&root).unwrap();
        let database_path = directory.path().join("pau.sqlite3");

        let runtime = tokio::runtime::Runtime::new().unwrap();
        let terminal_id = runtime.block_on(async {
            let database = open_database_at(&database_path).await.unwrap();
            let server = start_with_database(
                (Ipv4Addr::LOCALHOST, 0).into(),
                test_token(),
                ServerOptions::default(),
                database,
            )
            .await
            .unwrap();
            let address = server.local_addr();
            let workspace = json_body(
                &response(
                    address,
                    &post("/api/workspaces", &serde_json::json!({ "path": root })),
                    true,
                )
                .await,
            );
            let terminal = json_body(
                &response(
                    address,
                    &post(
                        "/api/terminals",
                        &serde_json::json!({
                            "workspace_id": workspace["id"],
                            "command": ["/bin/sh", "-c", "sleep 30"],
                            "size": {"cols": 80, "rows": 24},
                        }),
                    ),
                    true,
                )
                .await,
            );
            server.shutdown().await.unwrap();
            terminal["id"].as_str().unwrap().to_owned()
        });
        drop(runtime);

        let runtime = tokio::runtime::Runtime::new().unwrap();
        let records = runtime.block_on(async {
            let database = Database::open(&database_path).await.unwrap();
            database.audit().list().await.unwrap()
        });
        let summary: Vec<_> = records
            .iter()
            .map(|record| {
                (
                    record.entry.actor,
                    record.entry.operation,
                    record.entry.target.as_deref(),
                )
            })
            .collect();
        assert_eq!(
            summary,
            [
                (
                    pau_core::audit::AuditActor::Operator,
                    AuditOperation::TerminalStart,
                    Some(terminal_id.as_str())
                ),
                (
                    pau_core::audit::AuditActor::Pau,
                    AuditOperation::TerminalStop,
                    Some(terminal_id.as_str())
                ),
            ]
        );
    }

    /// A session that never stops must not hold up exit or cost the records
    /// queued before it.
    #[tokio::test(start_paused = true)]
    async fn shutdown_quits_at_the_limit_and_keeps_queued_records() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("pau.sqlite3");
        let database = Database::open(&path).await.unwrap();
        let audit = AuditLog::new(database.audit(), Redactor::default());
        for exit_code in 0..3 {
            audit.record(AuditEntry {
                exit_code: Some(exit_code),
                ..AuditEntry::new(
                    AuditActor::Pau,
                    AuditOperation::SessionStop,
                    AuditResult::Succeeded,
                )
            });
        }
        // The writer's SQLite thread runs on the real clock, which the paused
        // clock would skip past, so let it take the records first.
        assert_eq!(audit.list().await.unwrap().len(), 3);

        let started = tokio::time::Instant::now();
        let unfinished = stop_within_limit(
            vec![
                ShutdownStep {
                    name: "sessions",
                    work: Box::pin(std::future::pending()),
                },
                ShutdownStep {
                    name: "terminals",
                    work: Box::pin(async {}),
                },
            ],
            started,
            &audit,
        )
        .await;

        assert_eq!(started.elapsed(), SHUTDOWN_LIMIT - AUDIT_CLOSE_LIMIT);
        assert_eq!(unfinished, ["sessions"]);
        let exit_codes: Vec<_> = database
            .audit()
            .list()
            .await
            .unwrap()
            .iter()
            .map(|record| record.entry.exit_code.unwrap())
            .collect();
        assert_eq!(exit_codes, [0, 1, 2]);
    }

    /// Polls a request once, so its handler runs to its first wait, and drops
    /// it there, as the server does when a client disconnects.
    pub(crate) fn abandon(app: &Router, request: Request) {
        let mut response = std::pin::pin!(app.clone().oneshot(request));
        let mut context = std::task::Context::from_waker(std::task::Waker::noop());
        assert!(
            response.as_mut().poll(&mut context).is_pending(),
            "the request finished before it could be abandoned"
        );
    }

    fn api_request(method: &str, uri: &str, body: serde_json::Value) -> Request {
        Request::builder()
            .method(method)
            .uri(uri)
            .header(header::AUTHORIZATION, format!("Bearer {TEST_TOKEN}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    }

    async fn send(app: &Router, request: Request) -> (StatusCode, serde_json::Value) {
        let response = app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap_or_default())
    }

    /// Each record as `(operation, result, target, reason)`.
    fn summaries(records: &[AuditRecord]) -> Vec<(String, String, Option<String>, Option<String>)> {
        let label = |value: serde_json::Value| value.as_str().unwrap().to_owned();
        records
            .iter()
            .map(|record| {
                (
                    label(serde_json::to_value(record.entry.operation).unwrap()),
                    label(serde_json::to_value(record.entry.result).unwrap()),
                    record.entry.target.clone(),
                    record.entry.reason.clone(),
                )
            })
            .collect()
    }

    fn summary(
        operation: &str,
        result: &str,
        target: Option<&str>,
        reason: Option<&str>,
    ) -> (String, String, Option<String>, Option<String>) {
        (
            operation.to_owned(),
            result.to_owned(),
            target.map(str::to_owned),
            reason.map(str::to_owned),
        )
    }

    /// A workspace holding `a.txt` and a `folder`, served with an audit log.
    async fn audited_workspace(
        sandbox_path: &str,
    ) -> (tempfile::TempDir, String, AuditLog, Router) {
        let directory = tempdir().unwrap();
        let root = directory.path().join("project");
        fs::create_dir_all(root.join("folder")).unwrap();
        fs::write(root.join("a.txt"), "one").unwrap();
        let database = Database::open(":memory:").await.unwrap();
        let workspaces = WorkspaceService::new(database.workspaces());
        let workspace = workspaces.open(&root, None).await.unwrap();
        let diagnostics = default_diagnostics();
        let audit = AuditLog::new(database.audit(), diagnostics.redactor());
        let sandbox = SandboxApi::new(
            database.sandbox_selection(),
            directory.path().join("sandbox"),
            sandbox_path.into(),
        );
        let app = router_with_services(
            test_token(),
            EventHub::default(),
            diagnostics,
            ApiServices {
                workspaces: Some(workspaces),
                sandbox: Some(sandbox),
                audit: audit.clone(),
                ..ApiServices::default()
            },
        );
        (directory, workspace.id, audit, app)
    }

    /// Writes files the ways a client can, and returns each response's
    /// status and error code.
    async fn write_files(app: &Router, workspace_id: &str) -> Vec<(StatusCode, serde_json::Value)> {
        let uri = format!("/api/workspaces/{workspace_id}/file");
        let read = Request::builder()
            .uri(format!("{uri}?path=a.txt"))
            .header(header::AUTHORIZATION, format!("Bearer {TEST_TOKEN}"))
            .body(Body::empty())
            .unwrap();
        let one = send(app, read).await.1["revision"].clone();
        let writes = [
            serde_json::json!({"path": "a.txt", "content": "two", "expected_revision": one}),
            serde_json::json!({"path": ".env", "content": "KEY=value"}),
            serde_json::json!({"path": "../outside.txt", "content": "x"}),
            serde_json::json!({"path": "a.txt", "content": "three", "expected_revision": "stale"}),
            serde_json::json!({"path": "folder", "content": "x"}),
        ];
        let mut results = Vec::new();
        for write in writes {
            let (status, body) = send(app, api_request("PUT", &uri, write)).await;
            results.push((status, body["code"].clone()));
        }
        results
    }

    #[tokio::test]
    async fn records_file_writes_without_changing_their_results() {
        let (_directory, workspace_id, audit, app) = audited_workspace("").await;
        let results = write_files(&app, &workspace_id).await;

        let records = audit.list().await.unwrap();
        assert_eq!(
            summaries(&records),
            [
                summary("file_write", "succeeded", Some("a.txt"), None),
                summary(
                    "file_write",
                    "denied",
                    Some("[REDACTED]"),
                    Some("sensitive_path")
                ),
                summary(
                    "file_write",
                    "denied",
                    Some("../outside.txt"),
                    Some("invalid_path")
                ),
                summary("file_write", "denied", Some("a.txt"), Some("file_changed")),
                summary(
                    "file_write",
                    "failed",
                    Some("folder"),
                    Some("internal_error")
                ),
            ]
        );
        assert!(records.iter().all(|record| {
            record.entry.workspace_id.as_deref() == Some(workspace_id.as_str())
                && record.entry.actor == pau_core::audit::AuditActor::Operator
        }));

        // The same requests without an audit log get the same answers.
        let directory = tempdir().unwrap();
        let root = directory.path().join("project");
        fs::create_dir_all(root.join("folder")).unwrap();
        fs::write(root.join("a.txt"), "one").unwrap();
        let database = Database::open(":memory:").await.unwrap();
        let workspaces = WorkspaceService::new(database.workspaces());
        let workspace = workspaces.open(&root, None).await.unwrap();
        let unaudited = router_with_services(
            test_token(),
            EventHub::default(),
            default_diagnostics(),
            ApiServices {
                workspaces: Some(workspaces),
                ..ApiServices::default()
            },
        );
        assert_eq!(write_files(&unaudited, &workspace.id).await, results);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn records_concurrent_and_cancelled_file_writes() {
        let (directory, workspace_id, audit, app) = audited_workspace("").await;
        let uri = format!("/api/workspaces/{workspace_id}/file");
        abandon(
            &app,
            api_request(
                "PUT",
                &uri,
                serde_json::json!({"path": "cancelled.txt", "content": "x"}),
            ),
        );
        let writes: Vec<_> = (0..4)
            .map(|index| {
                let request = api_request(
                    "PUT",
                    &uri,
                    serde_json::json!({"path": format!("new-{index}.txt"), "content": "x"}),
                );
                let app = app.clone();
                tokio::spawn(async move { send(&app, request).await.0 })
            })
            .collect();
        for write in writes {
            assert_eq!(write.await.unwrap(), StatusCode::OK);
        }

        let records = audit.list().await.unwrap();
        assert_eq!(
            summaries(&records[..1]),
            [summary(
                "file_write",
                "cancelled",
                Some("cancelled.txt"),
                None
            )]
        );
        let mut written: Vec<_> = summaries(&records[1..]);
        written.sort();
        assert_eq!(
            written,
            (0..4)
                .map(|index| summary(
                    "file_write",
                    "succeeded",
                    Some(&format!("new-{index}.txt")),
                    None
                ))
                .collect::<Vec<_>>()
        );
        assert!(!directory.path().join("project/cancelled.txt").exists());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn records_sandbox_setting_changes() {
        let (_directory, workspace_id, audit, app) = audited_workspace("").await;
        let uri = format!("/api/workspaces/{workspace_id}/sandbox");
        let sandboxed = |domain: &str| {
            serde_json::json!({"mode": "sandboxed", "settings": {
                "profile": "workspace-write",
                "grants": {"domains": [domain], "writable_roots": [], "unix_sockets": false}
            }})
        };
        abandon(
            &app,
            api_request("PUT", &uri, serde_json::json!({"mode": "unsandboxed"})),
        );
        let (status, _) = send(&app, api_request("PUT", &uri, sandboxed("https://bad/"))).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        // The test server resolves no containment executables.
        let (status, _) = send(&app, api_request("PUT", &uri, sandboxed("example.com"))).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        let (status, _) = send(
            &app,
            api_request(
                "PUT",
                "/api/workspaces/missing/sandbox",
                serde_json::json!({"mode": "unsandboxed"}),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        let updates: Vec<_> = (0..4)
            .map(|_| {
                let request = api_request("PUT", &uri, serde_json::json!({"mode": "unsandboxed"}));
                let app = app.clone();
                tokio::spawn(async move { send(&app, request).await.0 })
            })
            .collect();
        for update in updates {
            assert_eq!(update.await.unwrap(), StatusCode::OK);
        }

        let records = audit.list().await.unwrap();
        let unsandboxed = summary("sandbox_update", "succeeded", Some("unsandboxed"), None);
        assert_eq!(
            summaries(&records),
            [
                summary("sandbox_update", "cancelled", Some("unsandboxed"), None),
                summary(
                    "sandbox_update",
                    "denied",
                    Some("workspace-write"),
                    Some("invalid_sandbox")
                ),
                summary(
                    "sandbox_update",
                    "failed",
                    Some("workspace-write"),
                    Some("sandbox_unavailable")
                ),
                summary(
                    "sandbox_update",
                    "denied",
                    Some("unsandboxed"),
                    Some("not_found")
                ),
                unsandboxed.clone(),
                unsandboxed.clone(),
                unsandboxed.clone(),
                unsandboxed,
            ]
        );
        assert_eq!(records[3].entry.workspace_id.as_deref(), Some("missing"));
        assert!(
            records
                .iter()
                .all(|record| record.entry.session_id.is_none())
        );
    }

    #[tokio::test]
    async fn exports_the_audit_log_to_a_new_file() {
        let (directory, workspace_id, audit, app) = audited_workspace("").await;
        let secret_path = format!("{TEST_TOKEN}.txt");
        let (status, _) = send(
            &app,
            api_request(
                "PUT",
                &format!("/api/workspaces/{workspace_id}/file"),
                serde_json::json!({"path": secret_path, "content": "content-secret"}),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let destination = directory.path().join("audit.json");
        let export = |destination: serde_json::Value| {
            api_request(
                "POST",
                "/api/audit/export",
                serde_json::json!({ "destination": destination }),
            )
        };

        assert_eq!(
            send(&app, export(destination.to_str().unwrap().into()))
                .await
                .0,
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            send(&app, export(destination.to_str().unwrap().into()))
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            send(&app, export("audit.json".into())).await.0,
            StatusCode::BAD_REQUEST
        );

        let exported = fs::read_to_string(&destination).unwrap();
        assert!(!exported.contains(TEST_TOKEN), "{exported}");
        assert!(!exported.contains("content-secret"), "{exported}");
        let exported: Vec<AuditRecord> = serde_json::from_str(&exported).unwrap();
        assert_eq!(
            summaries(&exported),
            [summary(
                "file_write",
                "succeeded",
                Some("[REDACTED].txt"),
                None
            )]
        );
        assert_eq!(
            summaries(&audit.list().await.unwrap()[1..]),
            [
                summary("file_export", "succeeded", Some("audit.json"), None),
                summary(
                    "file_export",
                    "denied",
                    Some("audit.json"),
                    Some("audit_error")
                ),
                summary(
                    "file_export",
                    "denied",
                    Some("audit.json"),
                    Some("audit_error")
                ),
            ]
        );
    }

    #[tokio::test]
    async fn rejects_non_loopback_addresses() {
        let error = start((Ipv4Addr::UNSPECIFIED, 0).into()).await.unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn rejects_short_configured_tokens() {
        assert_eq!(
            ApiToken::configured("too-short").unwrap_err().kind(),
            io::ErrorKind::InvalidInput
        );
    }
}
