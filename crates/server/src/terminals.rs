//! Terminal routes and the registry of live PTY sessions.
//!
//! HTTP commands create, inspect, resize, signal, and close terminals. Each
//! terminal also has a WebSocket stream: binary frames carry raw input and
//! output, and text frames carry [`TerminalClientMessage`] and
//! [`TerminalServerMessage`] values. Terminals outlive their streams and stop
//! only when closed, when their process exits, or when the server shuts down.
//! A stream that attaches first receives the terminal's scrollback.

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use axum::{
    Json,
    extract::{
        Path as AxumPath, State, WebSocketUpgrade,
        ws::{CloseFrame, Message, WebSocket, close_code},
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use pau_core::{
    ServerEventKind,
    audit::{AuditActor, AuditEntry, AuditLog, AuditOperation, AuditResult},
    terminal::{
        CreateTerminalRequest, TerminalClientMessage, TerminalInfo, TerminalServerMessage,
        TerminalSignalRequest, TerminalSize, TerminalStatus,
    },
    workspace::WorkspaceError,
};
use pau_term::{AttachedOutput, Terminal, TerminalCommand, TerminalError, TerminalScrollback};
use tokio::task::JoinSet;
use uuid::Uuid;

use super::{
    ApiError, ApiErrorBody, ApiState, EventHub, audit::PendingAudit, diagnostic_timestamp,
    stop_or_kill, workspace_service,
};

/// Time a closing terminal has to exit after `SIGHUP` before `SIGKILL`.
const CLOSE_GRACE: Duration = Duration::from_secs(3);

/// Source of [`ManagedTerminal::opened`], so terminals list in the order they
/// were opened and a reattaching client can rebuild its tabs in that order.
static OPENED: AtomicU64 = AtomicU64::new(0);

/// Live terminals keyed by their stable identifier.
#[derive(Clone, Default)]
pub(crate) struct TerminalRegistry(Arc<Mutex<HashMap<String, Arc<ManagedTerminal>>>>);

impl std::fmt::Debug for TerminalRegistry {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TerminalRegistry")
            .finish_non_exhaustive()
    }
}

impl TerminalRegistry {
    fn get(&self, id: &str) -> Result<Arc<ManagedTerminal>, TerminalApiError> {
        self.0
            .lock()
            .expect("terminal registry lock poisoned")
            .get(id)
            .cloned()
            .ok_or(TerminalApiError::NotFound)
    }

    /// Closes every running terminal at shutdown and records each stop as
    /// Pau's.
    ///
    /// Terminals close at the same time, so shutdown waits at most about one
    /// [`CLOSE_GRACE`] however many are open, and a terminal still running
    /// at `kill_at` is killed. Each leaves the registry before it closes, so
    /// its exit watcher does not record the stop again. A terminal whose
    /// process had already exited was recorded by its watcher and is only
    /// forgotten.
    pub(crate) async fn stop_all(&self, audit: &AuditLog, kill_at: tokio::time::Instant) {
        let terminals: Vec<_> = self
            .0
            .lock()
            .expect("terminal registry lock poisoned")
            .drain()
            .map(|(_, managed)| managed)
            .collect();
        let mut closing = JoinSet::new();
        for managed in terminals
            .into_iter()
            .filter(|managed| matches!(managed.terminal.status(), TerminalStatus::Running))
        {
            let audit = audit.clone();
            closing.spawn(async move {
                let status = stop_or_kill(managed.terminal.close(CLOSE_GRACE), kill_at, || {
                    managed.terminal.kill();
                })
                .await;
                audit.record(AuditEntry {
                    workspace_id: Some(managed.workspace_id.clone()),
                    target: Some(managed.id.clone()),
                    exit_code: exit_code(&status),
                    ..AuditEntry::new(
                        AuditActor::Pau,
                        AuditOperation::TerminalStop,
                        AuditResult::Succeeded,
                    )
                });
            });
        }
        closing.join_all().await;
    }
}

/// Whether `path` is a terminal stream, which accepts the bearer token as a
/// WebSocket subprotocol because browsers cannot set WebSocket headers.
pub(crate) fn is_stream_path(path: &str) -> bool {
    path.strip_prefix("/api/terminals/")
        .and_then(|rest| rest.strip_suffix("/stream"))
        .is_some_and(|id| !id.is_empty() && !id.contains('/'))
}

struct ManagedTerminal {
    id: String,
    opened: u64,
    workspace_id: String,
    command: Vec<String>,
    terminal: Terminal,
    scrollback: TerminalScrollback,
}

impl ManagedTerminal {
    fn info(&self) -> TerminalInfo {
        TerminalInfo {
            id: self.id.clone(),
            workspace_id: self.workspace_id.clone(),
            command: self.command.clone(),
            size: self.terminal.size(),
            status: self.terminal.status(),
        }
    }
}

fn publish(events: &EventHub, info: &TerminalInfo) {
    events.publish(
        diagnostic_timestamp(),
        Some(info.workspace_id.clone()),
        Some(info.id.clone()),
        ServerEventKind::TerminalChanged,
        serde_json::to_string(info).expect("terminal info is serializable"),
    );
}

pub(crate) enum TerminalApiError {
    Api(ApiError),
    NotFound,
    Invalid(String),
    Start(String),
    Failed(String),
}

impl From<ApiError> for TerminalApiError {
    fn from(error: ApiError) -> Self {
        Self::Api(error)
    }
}

impl From<WorkspaceError> for TerminalApiError {
    fn from(error: WorkspaceError) -> Self {
        Self::Api(error.into())
    }
}

impl From<TerminalError> for TerminalApiError {
    fn from(error: TerminalError) -> Self {
        match error {
            TerminalError::InvalidSize => Self::Invalid(error.to_string()),
            TerminalError::Spawn(_) => Self::Start(error.to_string()),
            TerminalError::Io(_) | TerminalError::Closed => Self::Failed(error.to_string()),
        }
    }
}

impl TerminalApiError {
    /// The response status, stable error code, and message.
    pub(crate) fn parts(&self) -> (StatusCode, &'static str, String) {
        match self {
            Self::Api(error) => error.parts(),
            Self::NotFound => (
                StatusCode::NOT_FOUND,
                "terminal_not_found",
                "terminal does not exist".to_owned(),
            ),
            Self::Invalid(message) => {
                (StatusCode::BAD_REQUEST, "invalid_terminal", message.clone())
            }
            Self::Start(message) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "terminal_start_failed",
                message.clone(),
            ),
            Self::Failed(message) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                message.clone(),
            ),
        }
    }
}

impl IntoResponse for TerminalApiError {
    fn into_response(self) -> Response {
        let (status, code, message) = self.parts();
        (status, Json(ApiErrorBody { code, message })).into_response()
    }
}

/// Opens a terminal in a workspace root and starts streaming its output.
///
/// Once shutdown begins, an open is `503 shutting_down`, as
/// [`crate::StartGate`] describes.
pub(crate) async fn create_terminal(
    State(state): State<ApiState>,
    Json(request): Json<CreateTerminalRequest>,
) -> Result<(StatusCode, Json<TerminalInfo>), TerminalApiError> {
    let mut audit = PendingAudit::operator(
        &state.audit,
        AuditOperation::TerminalStart,
        Some(request.workspace_id.clone()),
        None,
    );
    let result = state.starts.run(open_terminal(&state, request)).await;
    if let Ok((_, Json(info))) = &result {
        audit.target(info.id.clone());
    }
    audit.finish(&result);
    result
}

async fn open_terminal(
    state: &ApiState,
    request: CreateTerminalRequest,
) -> Result<(StatusCode, Json<TerminalInfo>), TerminalApiError> {
    let workspaces = workspace_service(state)?;
    let root = workspaces.root(&request.workspace_id).await?;
    let mut command = match request.command {
        None => TerminalCommand::shell(root, request.size),
        Some(command) => {
            let mut parts = command.into_iter();
            let program = parts
                .next()
                .filter(|program| !program.is_empty())
                .ok_or_else(|| TerminalApiError::Invalid("command must name a program".into()))?;
            TerminalCommand {
                program,
                args: parts.collect(),
                cwd: root,
                environment: Vec::new(),
                size: request.size,
            }
        }
    };
    command.environment = workspaces.process_environment();
    let argv = std::iter::once(command.program.clone())
        .chain(command.args.iter().cloned())
        .collect();
    // Spawning forks and waits for exec to report success, so keep it off
    // the runtime worker.
    let (terminal, output) = tokio::task::spawn_blocking(move || Terminal::spawn(command))
        .await
        .map_err(|error| TerminalApiError::Failed(error.to_string()))??;

    let mut exit = terminal.exit();
    let managed = Arc::new(ManagedTerminal {
        id: Uuid::new_v4().to_string(),
        opened: OPENED.fetch_add(1, Ordering::Relaxed),
        workspace_id: request.workspace_id,
        command: argv,
        terminal,
        scrollback: TerminalScrollback::follow(output),
    });
    state
        .terminals
        .0
        .lock()
        .expect("terminal registry lock poisoned")
        .insert(managed.id.clone(), Arc::clone(&managed));

    let weak: Weak<ManagedTerminal> = Arc::downgrade(&managed);
    let events = state.events.clone();
    let registry = state.terminals.clone();
    let audit = state.audit.clone();
    tokio::spawn(async move {
        let status = exit.wait().await;
        if let Some(managed) = weak.upgrade() {
            // A closed terminal leaves the registry first, and its close
            // request records the stop.
            if registry.get(&managed.id).is_ok() {
                audit.record(unrequested_stop(&managed, status));
            }
            publish(&events, &managed.info());
        }
    });

    let info = managed.info();
    publish(&state.events, &info);
    Ok((StatusCode::CREATED, Json(info)))
}

/// Lists live terminals, oldest first.
pub(crate) async fn list_terminals(State(state): State<ApiState>) -> Json<Vec<TerminalInfo>> {
    let mut terminals: Vec<_> = state
        .terminals
        .0
        .lock()
        .expect("terminal registry lock poisoned")
        .values()
        .cloned()
        .collect();
    terminals.sort_by_key(|terminal| terminal.opened);
    Json(terminals.iter().map(|terminal| terminal.info()).collect())
}

/// Returns one terminal.
pub(crate) async fn get_terminal(
    State(state): State<ApiState>,
    AxumPath(terminal_id): AxumPath<String>,
) -> Result<Json<TerminalInfo>, TerminalApiError> {
    Ok(Json(state.terminals.get(&terminal_id)?.info()))
}

/// Applies new terminal dimensions.
pub(crate) async fn resize_terminal(
    State(state): State<ApiState>,
    AxumPath(terminal_id): AxumPath<String>,
    Json(size): Json<TerminalSize>,
) -> Result<Json<TerminalInfo>, TerminalApiError> {
    let managed = state.terminals.get(&terminal_id)?;
    managed.terminal.resize(size)?;
    Ok(Json(managed.info()))
}

/// Sends a signal to the terminal's foreground process group.
pub(crate) async fn signal_terminal(
    State(state): State<ApiState>,
    AxumPath(terminal_id): AxumPath<String>,
    Json(request): Json<TerminalSignalRequest>,
) -> Result<StatusCode, TerminalApiError> {
    state
        .terminals
        .get(&terminal_id)?
        .terminal
        .signal(request.signal)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Stops a terminal, waits for its process to exit, and forgets it.
pub(crate) async fn close_terminal(
    State(state): State<ApiState>,
    AxumPath(terminal_id): AxumPath<String>,
) -> Result<Json<TerminalInfo>, TerminalApiError> {
    let mut audit = PendingAudit::operator(
        &state.audit,
        AuditOperation::TerminalStop,
        None,
        Some(terminal_id.clone()),
    );
    let closed = async {
        let managed = state
            .terminals
            .0
            .lock()
            .expect("terminal registry lock poisoned")
            .remove(&terminal_id)
            .ok_or(TerminalApiError::NotFound)?;
        audit.workspace(managed.workspace_id.clone());
        let status = managed.terminal.close(CLOSE_GRACE).await;
        Ok((managed.info(), exit_code(&status)))
    }
    .await;
    let exit = closed.as_ref().ok().and_then(|(_, exit)| *exit);
    let result = closed.map(|(info, _)| Json(info));
    audit.finish_with_exit(&result, exit);
    result
}

/// The exit code an audit record keeps for a terminal status.
fn exit_code(status: &TerminalStatus) -> Option<i32> {
    match status {
        TerminalStatus::Exited { exit_code, .. } => i32::try_from(*exit_code).ok(),
        TerminalStatus::Running => None,
    }
}

/// The record of a terminal whose process ended without a close request.
fn unrequested_stop(managed: &ManagedTerminal, status: TerminalStatus) -> AuditEntry {
    let exit_code = exit_code(&status);
    AuditEntry {
        workspace_id: Some(managed.workspace_id.clone()),
        target: Some(managed.id.clone()),
        exit_code,
        ..AuditEntry::new(
            AuditActor::Process,
            AuditOperation::TerminalStop,
            if exit_code == Some(0) {
                AuditResult::Succeeded
            } else {
                AuditResult::Failed
            },
        )
    }
}

/// Attaches a WebSocket to a terminal's input and output.
///
/// The stream first sends the terminal's scrollback as one binary frame, empty
/// when it holds no output, and then live output. A client tells the replay
/// from live output by that order, so it can drop the answers a terminal gives
/// to old queries in the replay. A client that reattaches receives the whole
/// scrollback again, so it should clear its screen first.
pub(crate) async fn stream_terminal(
    State(state): State<ApiState>,
    AxumPath(terminal_id): AxumPath<String>,
    upgrade: WebSocketUpgrade,
) -> Result<Response, TerminalApiError> {
    let managed = state.terminals.get(&terminal_id)?;
    Ok(upgrade
        .protocols(["pau"])
        .on_upgrade(move |socket| serve_stream(socket, managed)))
}

async fn serve_stream(mut socket: WebSocket, managed: Arc<ManagedTerminal>) {
    let mut attachment = managed.scrollback.attach();
    let replay = attachment.take_replay();
    if socket.send(Message::Binary(replay)).await.is_err() {
        return;
    }
    loop {
        tokio::select! {
            message = socket.recv() => match message {
                Some(Ok(Message::Binary(bytes))) => {
                    // Input closes when the child exits. Keep forwarding the
                    // remaining output until the stream ends.
                    let _ = managed.terminal.write(bytes.to_vec()).await;
                }
                Some(Ok(Message::Text(text))) => {
                    match serde_json::from_str(&text) {
                        Ok(TerminalClientMessage::Resize { size }) => {
                            let _ = managed.terminal.resize(size);
                        }
                        Ok(TerminalClientMessage::Signal { signal }) => {
                            let _ = managed.terminal.signal(signal);
                        }
                        Err(_) => {}
                    }
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return,
                Some(Ok(_)) => {}
            },
            output = attachment.recv() => match output {
                AttachedOutput::Output(chunk) => {
                    if socket.send(Message::Binary(chunk)).await.is_err() {
                        return;
                    }
                }
                // Close code 1013 (try again later) tells the client to
                // reattach and catch up from the scrollback, where a dropped
                // socket would look like a network failure. If output keeps
                // outrunning the link, each reattach lags again, so the
                // client must back off between attempts.
                AttachedOutput::Lagged => {
                    let _ = socket
                        .send(Message::Close(Some(CloseFrame {
                            code: close_code::AGAIN,
                            reason: "output fell behind; reattach".into(),
                        })))
                        .await;
                    return;
                }
                AttachedOutput::Ended => {
                    let _ = send_exited(&mut socket, &managed).await;
                    return;
                }
            },
        }
    }
}

async fn send_exited(socket: &mut WebSocket, managed: &ManagedTerminal) -> Result<(), axum::Error> {
    // Output ends when the last process holding the PTY closes it, which can
    // happen just before the waiter thread records the exit status.
    let status = managed.terminal.exit().wait().await;
    let message = serde_json::to_string(&TerminalServerMessage::Exited { status })
        .expect("terminal messages are serializable");
    socket.send(Message::Text(message.into())).await?;
    socket.send(Message::Close(None)).await
}

#[cfg(test)]
mod tests {
    use std::{fs, net::SocketAddr};

    use axum::{
        Router,
        body::{Body, to_bytes},
        extract::Request,
        http::header,
    };
    use futures_util::{SinkExt, StreamExt};
    use pau_core::{
        ServerStreamMessage, persistence::Database, terminal::TerminalStatus,
        workspace::WorkspaceService,
    };
    use tempfile::{TempDir, tempdir};
    use tokio::{
        net::{TcpListener, TcpStream},
        time::timeout,
    };
    use tokio_tungstenite::{
        MaybeTlsStream, WebSocketStream,
        tungstenite::{self, client::IntoClientRequest, http::HeaderValue},
    };
    use tower::ServiceExt;

    use super::*;
    use pau_core::audit::{AuditLog, AuditRecord};

    use crate::{ApiServices, ApiToken, default_diagnostics, router_with_services};

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";
    /// Upper bound for one real-process step. It only turns a hang into a
    /// failure.
    const STEP_LIMIT: Duration = Duration::from_secs(20);

    /// The `PATH` the fixture's workspace service gives its processes, which
    /// differs from the test's own.
    const PROCESS_PATH: &str = "/pau-login/bin:/usr/bin:/bin";

    type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

    struct Fixture {
        _directory: TempDir,
        app: Router,
        events: EventHub,
        audit: AuditLog,
        workspace_id: String,
        address: SocketAddr,
    }

    async fn fixture() -> Fixture {
        let directory = tempdir().unwrap();
        let root = directory.path().join("project");
        fs::create_dir(&root).unwrap();
        let database = Database::open(":memory:").await.unwrap();
        let workspaces =
            WorkspaceService::new(database.workspaces()).with_path(PROCESS_PATH.into());
        let workspace = workspaces.open(&root, None).await.unwrap();
        let events = EventHub::default();
        let audit = AuditLog::new(database.audit(), Default::default());
        let app = router_with_services(
            ApiToken::configured(TOKEN).unwrap(),
            events.clone(),
            default_diagnostics(),
            ApiServices {
                workspaces: Some(workspaces),
                audit: audit.clone(),
                ..ApiServices::default()
            },
        );
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(axum::serve(listener, app.clone()).into_future());
        Fixture {
            _directory: directory,
            app,
            events,
            audit,
            workspace_id: workspace.id,
            address,
        }
    }

    impl Fixture {
        async fn call(
            &self,
            method: &str,
            path: &str,
            body: Option<serde_json::Value>,
        ) -> (StatusCode, serde_json::Value) {
            let request = Request::builder()
                .method(method)
                .uri(path)
                .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(body.map_or_else(Body::empty, |body| Body::from(body.to_string())))
                .unwrap();
            let response = self.app.clone().oneshot(request).await.unwrap();
            let status = response.status();
            let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
            let json = if bytes.is_empty() {
                serde_json::Value::Null
            } else {
                serde_json::from_slice(&bytes).unwrap()
            };
            (status, json)
        }

        async fn create(&self, script: &str) -> TerminalInfo {
            let (status, body) = self
                .call(
                    "POST",
                    "/api/terminals",
                    Some(serde_json::json!({
                        "workspace_id": self.workspace_id,
                        "command": ["/bin/sh", "-c", script],
                        "size": {"cols": 80, "rows": 24},
                    })),
                )
                .await;
            assert_eq!(status, StatusCode::CREATED, "{body}");
            serde_json::from_value(body).unwrap()
        }

        async fn connect(
            &self,
            id: &str,
            token: Option<&str>,
        ) -> Result<Socket, tungstenite::Error> {
            let mut request = format!("ws://{}/api/terminals/{id}/stream", self.address)
                .into_client_request()
                .unwrap();
            let protocols = match token {
                Some(token) => format!("pau, pau.bearer.{token}"),
                None => "pau".to_owned(),
            };
            request.headers_mut().insert(
                header::SEC_WEBSOCKET_PROTOCOL,
                HeaderValue::from_str(&protocols).unwrap(),
            );
            tokio_tungstenite::connect_async(request)
                .await
                .map(|(socket, _)| socket)
        }
    }

    /// Reads binary output until it contains `needle` or the server reports
    /// exit, and returns the output and any exit message.
    async fn read_stream(
        socket: &mut Socket,
        needle: Option<&str>,
    ) -> (String, Option<TerminalServerMessage>) {
        let mut output = Vec::new();
        timeout(STEP_LIMIT, async {
            while let Some(message) = socket.next().await {
                match message.unwrap() {
                    tungstenite::Message::Binary(bytes) => {
                        output.extend_from_slice(&bytes);
                        let text = String::from_utf8_lossy(&output);
                        if needle.is_some_and(|needle| text.contains(needle)) {
                            return (text.into_owned(), None);
                        }
                    }
                    tungstenite::Message::Text(text) => {
                        let exited = serde_json::from_str(&text).unwrap();
                        return (String::from_utf8_lossy(&output).into_owned(), Some(exited));
                    }
                    _ => {}
                }
            }
            panic!("stream ended without an exit message");
        })
        .await
        .unwrap()
    }

    fn exited(exit_code: u32) -> Option<TerminalServerMessage> {
        Some(TerminalServerMessage::Exited {
            status: TerminalStatus::Exited {
                exit_code,
                signal: None,
            },
        })
    }

    #[tokio::test]
    async fn gives_a_terminal_the_server_path() {
        let fixture = fixture().await;
        let info = fixture.create("printf 'path=%s;' \"$PATH\"").await;

        let mut socket = fixture.connect(&info.id, Some(TOKEN)).await.unwrap();
        let (output, _) = read_stream(&mut socket, None).await;

        assert!(
            output.contains(&format!("path={PROCESS_PATH};")),
            "{output:?}"
        );
    }

    #[tokio::test]
    async fn streams_input_output_resize_and_exit() {
        let fixture = fixture().await;
        let info = fixture
            .create("read line; echo \"got:$line\"; stty size; exit 4")
            .await;
        assert_eq!(info.status, TerminalStatus::Running);
        assert_eq!(info.command[0], "/bin/sh");

        let mut socket = fixture.connect(&info.id, Some(TOKEN)).await.unwrap();
        // The script has printed nothing yet, so the replay frame is empty.
        let replay = timeout(STEP_LIMIT, socket.next()).await.unwrap();
        assert_eq!(
            replay.unwrap().unwrap(),
            tungstenite::Message::binary(Vec::new())
        );
        let resize = TerminalClientMessage::Resize {
            size: TerminalSize {
                cols: 100,
                rows: 30,
            },
        };
        socket
            .send(tungstenite::Message::text(
                serde_json::to_string(&resize).unwrap(),
            ))
            .await
            .unwrap();
        socket
            .send(tungstenite::Message::binary(b"hi there\r".to_vec()))
            .await
            .unwrap();

        let (output, exit) = read_stream(&mut socket, None).await;
        assert!(output.contains("got:hi there"), "{output:?}");
        assert!(output.contains("30 100"), "{output:?}");
        assert_eq!(exit, exited(4));

        let (status, body) = fixture
            .call("GET", &format!("/api/terminals/{}", info.id), None)
            .await;
        assert_eq!(status, StatusCode::OK);
        let current: TerminalInfo = serde_json::from_value(body).unwrap();
        assert_eq!(
            current.size,
            TerminalSize {
                cols: 100,
                rows: 30
            }
        );

        let initial = fixture.events.subscribe(None).initial;
        let [ServerStreamMessage::Snapshot { snapshot }] = initial.as_slice() else {
            panic!("expected a snapshot");
        };
        assert!(snapshot.events.iter().any(|event| {
            event.kind == ServerEventKind::TerminalChanged
                && event.session_id.as_deref() == Some(info.id.as_str())
                && event.workspace_id.as_deref() == Some(fixture.workspace_id.as_str())
        }));
    }

    #[tokio::test]
    async fn signals_resizes_lists_and_closes_terminals() {
        let fixture = fixture().await;
        let trapped = fixture
            .create("trap 'exit 9' INT; echo ready; while :; do sleep 1; done")
            .await;
        let looping = fixture.create("while :; do sleep 1; done").await;

        let (status, body) = fixture.call("GET", "/api/terminals", None).await;
        assert_eq!(status, StatusCode::OK);
        let listed: Vec<TerminalInfo> = serde_json::from_value(body).unwrap();
        let ids: Vec<_> = listed.iter().map(|terminal| terminal.id.as_str()).collect();
        assert_eq!(ids, [trapped.id.as_str(), looping.id.as_str()]);

        let size_path = format!("/api/terminals/{}/size", looping.id);
        let (status, body) = fixture
            .call(
                "PUT",
                &size_path,
                Some(serde_json::json!({"cols": 120, "rows": 40})),
            )
            .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["size"], serde_json::json!({"cols": 120, "rows": 40}));
        let (status, body) = fixture
            .call(
                "PUT",
                &size_path,
                Some(serde_json::json!({"cols": 0, "rows": 40})),
            )
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["code"], "invalid_terminal");

        // The scrollback replays "ready" if the script printed it before the
        // stream attached.
        let mut socket = fixture.connect(&trapped.id, Some(TOKEN)).await.unwrap();
        read_stream(&mut socket, Some("ready\r")).await;
        let (status, _) = fixture
            .call(
                "POST",
                &format!("/api/terminals/{}/signal", trapped.id),
                Some(serde_json::json!({"signal": "interrupt"})),
            )
            .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let (_, exit) = read_stream(&mut socket, None).await;
        assert_eq!(exit, exited(9));

        let (status, body) = fixture
            .call("DELETE", &format!("/api/terminals/{}", looping.id), None)
            .await;
        assert_eq!(status, StatusCode::OK);
        let closed: TerminalInfo = serde_json::from_value(body).unwrap();
        assert!(matches!(
            closed.status,
            TerminalStatus::Exited {
                signal: Some(_),
                ..
            }
        ));
        let (status, body) = fixture
            .call("GET", &format!("/api/terminals/{}", looping.id), None)
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["code"], "terminal_not_found");
    }

    #[tokio::test]
    async fn replays_output_written_before_and_between_streams() {
        let fixture = fixture().await;
        let info = fixture
            .create("echo first; read _; echo detached; read _; echo second; exit 5")
            .await;

        let mut socket = fixture.connect(&info.id, Some(TOKEN)).await.unwrap();
        read_stream(&mut socket, Some("first\r")).await;
        socket
            .send(tungstenite::Message::binary(b"\r".to_vec()))
            .await
            .unwrap();
        socket.close(None).await.unwrap();

        let mut socket = fixture.connect(&info.id, Some(TOKEN)).await.unwrap();
        read_stream(&mut socket, Some("detached\r")).await;
        socket
            .send(tungstenite::Message::binary(b"\r".to_vec()))
            .await
            .unwrap();
        let (output, exit) = read_stream(&mut socket, None).await;
        assert_eq!(exit, exited(5));

        // A stream that attaches after exit still receives the scrollback.
        let mut socket = fixture.connect(&info.id, Some(TOKEN)).await.unwrap();
        let (replay, exit) = read_stream(&mut socket, None).await;
        assert_eq!(exit, exited(5));
        let lines: Vec<_> = replay.split("\r\n").collect();
        assert_eq!(
            lines.iter().filter(|line| **line == "first").count(),
            1,
            "{replay:?}"
        );
        let position = |text| {
            replay
                .find(text)
                .unwrap_or_else(|| panic!("{text:?} missing from {replay:?}"))
        };
        assert!(position("first") < position("detached"), "{replay:?}");
        assert!(position("detached") < position("second"), "{replay:?}");
        assert!(output.contains("second"), "{output:?}");
    }

    #[tokio::test]
    async fn closes_a_stream_that_reads_slower_than_the_terminal_writes() {
        let fixture = fixture().await;
        let info = fixture.create("exec yes pau").await;
        let mut socket = fixture.connect(&info.id, Some(TOKEN)).await.unwrap();

        // While the client reads nothing, the socket buffers fill and the
        // stream falls behind the terminal's live output.
        tokio::time::sleep(Duration::from_secs(1)).await;
        let code = timeout(STEP_LIMIT, async {
            while let Some(message) = socket.next().await {
                if let tungstenite::Message::Close(frame) = message.unwrap() {
                    return frame.map(|frame| frame.code);
                }
            }
            None
        })
        .await
        .unwrap();
        assert_eq!(code, Some(close_code::AGAIN.into()));

        let (status, _) = fixture
            .call("DELETE", &format!("/api/terminals/{}", info.id), None)
            .await;
        assert_eq!(status, StatusCode::OK);
    }

    #[tokio::test]
    async fn rejects_invalid_terminal_requests() {
        let fixture = fixture().await;
        let size = serde_json::json!({"cols": 80, "rows": 24});
        for (body, expected, code) in [
            (
                serde_json::json!({"workspace_id": "missing", "size": size}),
                StatusCode::NOT_FOUND,
                "not_found",
            ),
            (
                serde_json::json!({
                    "workspace_id": fixture.workspace_id,
                    "size": {"cols": 80, "rows": 0},
                }),
                StatusCode::BAD_REQUEST,
                "invalid_terminal",
            ),
            (
                serde_json::json!({
                    "workspace_id": fixture.workspace_id,
                    "command": [],
                    "size": size,
                }),
                StatusCode::BAD_REQUEST,
                "invalid_terminal",
            ),
            (
                serde_json::json!({
                    "workspace_id": fixture.workspace_id,
                    "command": ["/nonexistent/pau-terminal-test"],
                    "size": size,
                }),
                StatusCode::UNPROCESSABLE_ENTITY,
                "terminal_start_failed",
            ),
        ] {
            let (status, response) = fixture.call("POST", "/api/terminals", Some(body)).await;
            assert_eq!(status, expected, "{response}");
            assert_eq!(response["code"], code);
        }
    }

    #[tokio::test]
    async fn records_terminal_starts_and_stops() {
        let fixture = fixture().await;
        let mut events = fixture.events.subscribe(None);
        let exiting = fixture.create("exit 4").await;
        timeout(STEP_LIMIT, async {
            loop {
                let event = events.receiver.recv().await.unwrap();
                if event.session_id.as_deref() == Some(exiting.id.as_str())
                    && event.payload.contains("exited")
                {
                    return;
                }
            }
        })
        .await
        .unwrap();
        let running = fixture.create("sleep 30").await;
        let (status, _) = fixture
            .call("DELETE", &format!("/api/terminals/{}", running.id), None)
            .await;
        assert_eq!(status, StatusCode::OK);
        let create = |command: serde_json::Value| {
            fixture.call(
                "POST",
                "/api/terminals",
                Some(serde_json::json!({
                    "workspace_id": fixture.workspace_id,
                    "command": command,
                    "size": {"cols": 80, "rows": 24},
                })),
            )
        };
        assert_eq!(
            create(serde_json::json!([""])).await.0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            create(serde_json::json!([
                "/nonexistent/program",
                "--token=secret"
            ]))
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        let (status, _) = fixture.call("DELETE", "/api/terminals/unknown", None).await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        let records: Vec<AuditRecord> = fixture.audit.list().await.unwrap();
        let summary: Vec<_> = records
            .iter()
            .map(|record| {
                (
                    serde_json::to_value(record.entry.actor).unwrap(),
                    serde_json::to_value(record.entry.operation).unwrap(),
                    serde_json::to_value(record.entry.result).unwrap(),
                    record.entry.target.clone(),
                    record.entry.reason.clone(),
                    record.entry.exit_code,
                )
            })
            .collect();
        let row = |actor: &str,
                   operation: &str,
                   result: &str,
                   target: Option<&str>,
                   reason: Option<&str>,
                   exit_code: Option<i32>| {
            (
                serde_json::json!(actor),
                serde_json::json!(operation),
                serde_json::json!(result),
                target.map(str::to_owned),
                reason.map(str::to_owned),
                exit_code,
            )
        };
        assert_eq!(
            summary,
            [
                row(
                    "operator",
                    "terminal_start",
                    "succeeded",
                    Some(&exiting.id),
                    None,
                    None
                ),
                row(
                    "process",
                    "terminal_stop",
                    "failed",
                    Some(&exiting.id),
                    None,
                    Some(4)
                ),
                row(
                    "operator",
                    "terminal_start",
                    "succeeded",
                    Some(&running.id),
                    None,
                    None
                ),
                row(
                    "operator",
                    "terminal_stop",
                    "succeeded",
                    Some(&running.id),
                    None,
                    Some(1)
                ),
                row(
                    "operator",
                    "terminal_start",
                    "denied",
                    None,
                    Some("invalid_terminal"),
                    None
                ),
                row(
                    "operator",
                    "terminal_start",
                    "failed",
                    None,
                    Some("terminal_start_failed"),
                    None
                ),
                row(
                    "operator",
                    "terminal_stop",
                    "denied",
                    Some("unknown"),
                    Some("terminal_not_found"),
                    None
                ),
            ]
        );
        assert!(records[..4].iter().all(|record| {
            record.entry.workspace_id.as_deref() == Some(fixture.workspace_id.as_str())
        }));
        assert!(!serde_json::to_string(&records).unwrap().contains("secret"));
    }

    #[test]
    fn recognizes_only_terminal_stream_paths() {
        assert!(is_stream_path("/api/terminals/abc/stream"));
        assert!(!is_stream_path("/api/terminals//stream"));
        assert!(!is_stream_path("/api/terminals/a/b/stream"));
        assert!(!is_stream_path("/api/terminals/abc"));
    }
}
