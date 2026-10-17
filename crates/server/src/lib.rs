use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    env, fmt, fs, io,
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime},
};

use axum::{
    Json, Router,
    extract::{
        Path as AxumPath, Query, Request, State, WebSocketUpgrade,
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
    diagnostics::{
        DiagnosticBundle, DiagnosticLevel, DiagnosticRecordInput, Diagnostics, TransportDiagnostic,
    },
    persistence::{
        ApplicationSetting, ApplicationSettingsRepository, Database, SandboxSelectionRepository,
        Workspace,
    },
    sandbox::{
        EffectiveSandbox, SandboxExecutables, SandboxLaunchInput, SandboxPreviewRequest,
        SandboxSelection, WorkspaceSandbox, resolve_sandbox, validate_selection,
    },
    workspace::{
        FileContent, FileEntry, FileSearchMatch, GitDiff, GitStatus, TraversalOptions,
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

mod build_info;
mod sessions;
mod terminals;

use build_info::Channel;
use sessions::SessionApi;

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
    terminals: terminals::TerminalRegistry,
}

/// Sandbox selections and the host facts needed to describe a profile.
#[derive(Clone)]
struct SandboxApi {
    selections: SandboxSelectionRepository,
    /// Executables pinned at startup, or why none could be resolved.
    executables: Result<SandboxExecutables, String>,
    home: PathBuf,
    /// Parent of per-session sandbox directories.
    sessions: PathBuf,
}

impl SandboxApi {
    /// Pins the containment executables from the startup `PATH`.
    fn new(selections: SandboxSelectionRepository, sessions: PathBuf) -> Self {
        let search_path = env::var_os("PATH").unwrap_or_default();
        Self {
            selections,
            executables: SandboxExecutables::resolve(&search_path)
                .map_err(|error| error.to_string()),
            home: dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")),
            sessions,
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
        state.replay.push_back(event.clone());
        if state.replay.len() > self.replay_capacity {
            state.replay.pop_front();
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
    let diagnostics = default_diagnostics();
    router_with_services(
        token,
        EventHub::default(),
        None,
        diagnostics,
        None,
        None,
        None,
    )
}

/// Builds the API around an event hub supplied by the application owner.
pub fn router_with_events(token: ApiToken, events: EventHub) -> Router {
    let diagnostics = default_diagnostics();
    router_with_services(token, events, None, diagnostics, None, None, None)
}

/// Builds the API with an explicit diagnostics collector.
pub fn router_with_diagnostics(token: ApiToken, diagnostics: Diagnostics) -> Router {
    let events = EventHub::default().with_diagnostics(diagnostics.clone());
    router_with_services(token, events, None, diagnostics, None, None, None)
}

fn router_with_services(
    token: ApiToken,
    events: EventHub,
    workspaces: Option<WorkspaceService>,
    diagnostics: Diagnostics,
    settings: Option<ApplicationSettingsRepository>,
    sandbox: Option<SandboxApi>,
    sessions: Option<SessionApi>,
) -> Router {
    diagnostics.register_sensitive_value(token.expose());
    Router::new()
        .route("/api/health", get(health))
        .route("/api/version", get(version))
        .route("/api/events", get(websocket))
        .route("/api/diagnostics", get(get_diagnostics))
        .route("/api/diagnostics/settings", put(update_diagnostic_settings))
        .route(
            "/api/diagnostics/payload-tracing",
            post(start_payload_tracing),
        )
        .route("/api/diagnostics/export", post(export_diagnostics))
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
            "/api/workspaces/{workspace_id}/sandbox",
            get(get_workspace_sandbox).put(update_workspace_sandbox),
        )
        .route(
            "/api/workspaces/{workspace_id}/sandbox/preview",
            post(preview_sandbox),
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
            post(sessions::prompt_session),
        )
        .route(
            "/api/sessions/{session_id}/steer",
            post(sessions::steer_session),
        )
        .route(
            "/api/sessions/{session_id}/follow-up",
            post(sessions::follow_up_session),
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
            "/api/sessions/{session_id}/queue",
            get(sessions::get_session_queue).delete(sessions::clear_session_queue),
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
            workspaces,
            diagnostics,
            settings,
            sandbox,
            sessions,
            terminals: terminals::TerminalRegistry::default(),
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
    ServiceUnavailable,
    /// The selection names an invalid grant, root, or tool.
    InvalidSandbox(String),
    /// No sandbox can start on this host.
    SandboxUnavailable(String),
    /// Pi is missing or unusable, with discovery's corrective message.
    PiUnavailable(String),
    /// The workspace selects a sandbox, which session launches cannot apply.
    SandboxedSessionUnsupported,
    /// A session control or lifecycle operation failed.
    Session(Box<pau_pi::PiSessionRegistryError>),
    /// The requested native session cannot be resumed.
    NativeSession(pau_pi::PiSessionFileError),
    /// An extension UI answer was refused, with its status, code, and message.
    ExtensionRequest(StatusCode, &'static str, String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            Self::Diagnostics(message) => (StatusCode::BAD_REQUEST, "diagnostics_error", message),
            Self::InvalidSandbox(message) => (StatusCode::BAD_REQUEST, "invalid_sandbox", message),
            Self::SandboxUnavailable(message) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "sandbox_unavailable",
                message,
            ),
            Self::PiUnavailable(message) => {
                (StatusCode::SERVICE_UNAVAILABLE, "pi_unavailable", message)
            }
            Self::SandboxedSessionUnsupported => (
                StatusCode::NOT_IMPLEMENTED,
                "sandboxed_session_unsupported",
                "Sandboxed sessions cannot start from the desktop yet. Turn off the sandbox for this workspace to start a session.".to_owned(),
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
            Self::ExtensionRequest(status, code, message) => (status, code, message),
            Self::Session(error) => {
                let (status, code) = sessions::error_status(&error);
                (status, code, error.to_string())
            }
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
                    WorkspaceError::Persistence(_)
                    | WorkspaceError::Io(_)
                    | WorkspaceError::Git(_) => {
                        (StatusCode::INTERNAL_SERVER_ERROR, "internal_error")
                    }
                };
                (status, code, error.to_string())
            }
        };
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
    let service = workspace_service(&state)?;
    service
        .write(
            &workspace_id,
            &request.path,
            &request.content,
            request.expected_revision.as_deref(),
        )
        .await
        .map(Json)
        .map_err(ApiError::from)
}

#[derive(Deserialize)]
struct SearchFilesQuery {
    query: String,
    limit: Option<usize>,
    #[serde(default)]
    include_hidden: bool,
    #[serde(default)]
    include_ignored: bool,
}

async fn search_files(
    State(state): State<ApiState>,
    AxumPath(workspace_id): AxumPath<String>,
    Query(query): Query<SearchFilesQuery>,
) -> Result<Json<Vec<FileSearchMatch>>, ApiError> {
    let service = workspace_service(&state)?;
    let traversal = TraversalOptions {
        include_hidden: query.include_hidden,
        include_ignored: query.include_ignored,
    };
    service
        .search(&workspace_id, &query.query, traversal, query.limit)
        .await
        .map(Json)
        .map_err(ApiError::from)
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
    validate_selection(&selection).map_err(|error| ApiError::InvalidSandbox(error.to_string()))?;
    let root = workspace_service(&state)?.root(&workspace_id).await?;
    let sandbox = sandbox_api(&state)?;
    if selection.settings().is_some() {
        describe(
            sandbox,
            &root,
            &workspace_id,
            &SandboxPreviewRequest {
                adapter: pau_core::sandbox::SandboxAdapter::Pi,
                selection: selection.clone(),
            },
        )?;
    }
    sandbox
        .selections
        .set_workspace_default(&workspace_id, &selection, &diagnostic_timestamp())
        .await
        .map_err(|error| ApiError::from(WorkspaceError::from(error)))?;
    workspace_sandbox(&state, &workspace_id).await.map(Json)
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
    let tool_path = env::var("PATH").unwrap_or_default();
    let credential_environment = settings
        .credential_references
        .iter()
        .filter_map(|reference| {
            env::var(&reference.source)
                .ok()
                .map(|value| (reference.source.clone(), value))
        })
        .collect();
    resolve_sandbox(&SandboxLaunchInput {
        adapter: request.adapter,
        settings,
        workspace,
        home: &sandbox.home,
        session_directory: &sandbox.sessions.join(format!("preview-{workspace_id}")),
        executables,
        runtime_roots: &[],
        tool_path: &tool_path,
        credential_environment: &credential_environment,
    })
    .map(|resolved| Some(resolved.effective))
    .map_err(|error| ApiError::InvalidSandbox(error.to_string()))
}

#[derive(Deserialize)]
struct EventQuery {
    after: Option<u64>,
}

async fn websocket(
    State(state): State<ApiState>,
    Query(query): Query<EventQuery>,
    upgrade: WebSocketUpgrade,
) -> Response {
    let subscription = state.events.subscribe(query.after);
    upgrade
        .protocols(["pau"])
        .on_upgrade(move |socket| stream_events(socket, subscription))
}

async fn stream_events(mut socket: WebSocket, mut subscription: EventSubscription) {
    for message in subscription.initial.drain(..) {
        if send_stream_message(&mut socket, &message).await.is_err() {
            return;
        }
    }

    loop {
        match subscription.receiver.recv().await {
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
    shutdown: Option<oneshot::Sender<()>>,
    task: Option<JoinHandle<io::Result<()>>>,
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

    /// Returns the event hub used by this server.
    pub fn events(&self) -> &EventHub {
        &self.events
    }

    /// Starts graceful shutdown without waiting for the listener task.
    pub fn request_shutdown(&mut self) {
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

    /// Stops the server and waits for its listener task.
    pub async fn shutdown(mut self) -> io::Result<()> {
        self.request_shutdown();
        let result = self
            .task
            .take()
            .expect("server task is present until shutdown")
            .await
            .map_err(io::Error::other)?;
        self.sessions.stop_all().await;
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

impl Drop for ServerHandle {
    fn drop(&mut self) {
        self.request_shutdown();
    }
}

/// Observation-only options selected at process startup.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ServerOptions {
    /// Enables release diagnostics before the settings UI is available.
    pub diagnostics: bool,
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
/// receive the same token through their process environments.
pub async fn start_with_token(address: SocketAddr, token: ApiToken) -> io::Result<ServerHandle> {
    start_with_token_and_options(address, token, ServerOptions::default()).await
}

/// Starts the shared API with a configured token and process options.
pub async fn start_with_token_and_options(
    address: SocketAddr,
    token: ApiToken,
    options: ServerOptions,
) -> io::Result<ServerHandle> {
    if !address.ip().is_loopback() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "the local Pau server must bind to a loopback address",
        ));
    }

    let database = if cfg!(test) {
        Database::open(":memory:").await
    } else {
        let path = database_path()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        Database::open(path).await
    }
    .map_err(io::Error::other)?;
    let settings = database.settings();
    let persisted_diagnostics = settings
        .get(DIAGNOSTICS_SETTING_KEY)
        .await
        .map_err(io::Error::other)?
        .is_some_and(|setting| setting.value == "true");
    let workspaces =
        WorkspaceService::new(database.workspaces()).with_processes(database.processes());
    let sandbox = SandboxApi::new(
        database.sandbox_selection(),
        state_directory()?.join("sandbox"),
    );
    let processes = database.processes();
    let diagnostics = default_diagnostics();
    diagnostics.register_sensitive_value(token.expose());
    diagnostics.set_enabled(options.diagnostics || persisted_diagnostics);

    let listener = TcpListener::bind(address).await?;
    let address = listener.local_addr()?;
    let (shutdown, shutdown_receiver) = oneshot::channel();
    let server_token = token.clone();
    let events = EventHub::default().with_diagnostics(diagnostics.clone());
    let sessions = SessionApi::new(
        pau_pi::PiSessionRegistry::new(processes),
        pau_pi::DiscoverPiOptions::default(),
        events.clone(),
    );
    let server_sessions = sessions.clone();
    let server_events = events.clone();
    let server_diagnostics = diagnostics.clone();
    let server_settings = settings.clone();
    let dispatch = tracing::dispatcher::get_default(Clone::clone);
    let task = tokio::spawn(
        async move {
            axum::serve(
                listener,
                router_with_services(
                    server_token,
                    server_events,
                    Some(workspaces),
                    server_diagnostics,
                    Some(server_settings),
                    Some(sandbox),
                    Some(server_sessions),
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
        shutdown: Some(shutdown),
        task: Some(task),
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
mod tests {
    use std::{
        fs,
        net::Ipv4Addr,
        sync::{Arc, Mutex},
        time::Duration,
    };

    use axum::body::{Body, to_bytes};
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

    #[derive(Clone, Default)]
    struct LogBuffer(Arc<Mutex<Vec<u8>>>);

    struct LogWriter(Arc<Mutex<Vec<u8>>>);

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
        fn contents(&self) -> String {
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
        );
        let available = sandbox.executables.is_ok();
        let app = router_with_services(
            test_token(),
            EventHub::default(),
            Some(workspaces),
            default_diagnostics(),
            None,
            Some(sandbox),
            None,
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
            Some(WorkspaceService::new(database.workspaces())),
            default_diagnostics(),
            None,
            None,
            None,
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

        assert!(
            timeout(Duration::from_secs(1), TcpStream::connect(address))
                .await
                .unwrap()
                .is_err()
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
