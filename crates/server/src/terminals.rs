//! Terminal routes and the registry of live PTY sessions.
//!
//! HTTP commands create, inspect, resize, signal, and close terminals. Each
//! terminal also has a WebSocket stream: binary frames carry raw input and
//! output, and text frames carry [`TerminalClientMessage`] and
//! [`TerminalServerMessage`] values. Terminals outlive their streams and stop
//! only when closed, when their process exits, or when the server drops them.
//! A stream that attaches first receives the terminal's scrollback.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, Weak},
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
    terminal::{
        CreateTerminalRequest, TerminalClientMessage, TerminalInfo, TerminalServerMessage,
        TerminalSignalRequest, TerminalSize,
    },
    workspace::WorkspaceError,
};
use pau_term::{AttachedOutput, Terminal, TerminalCommand, TerminalError, TerminalScrollback};
use uuid::Uuid;

use super::{ApiError, ApiErrorBody, ApiState, EventHub, diagnostic_timestamp, workspace_service};

/// Time a closing terminal has to exit after `SIGHUP` before `SIGKILL`.
const CLOSE_GRACE: Duration = Duration::from_secs(3);

/// Live terminals keyed by their stable identifier.
#[derive(Clone, Default)]
pub(crate) struct TerminalRegistry(Arc<Mutex<HashMap<String, Arc<ManagedTerminal>>>>);

impl TerminalRegistry {
    fn get(&self, id: &str) -> Result<Arc<ManagedTerminal>, TerminalApiError> {
        self.0
            .lock()
            .expect("terminal registry lock poisoned")
            .get(id)
            .cloned()
            .ok_or(TerminalApiError::NotFound)
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

impl IntoResponse for TerminalApiError {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            Self::Api(error) => return error.into_response(),
            Self::NotFound => (
                StatusCode::NOT_FOUND,
                "terminal_not_found",
                "terminal does not exist".to_owned(),
            ),
            Self::Invalid(message) => (StatusCode::BAD_REQUEST, "invalid_terminal", message),
            Self::Start(message) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "terminal_start_failed",
                message,
            ),
            Self::Failed(message) => (StatusCode::INTERNAL_SERVER_ERROR, "internal_error", message),
        };
        (status, Json(ApiErrorBody { code, message })).into_response()
    }
}

/// Opens a terminal in a workspace root and starts streaming its output.
pub(crate) async fn create_terminal(
    State(state): State<ApiState>,
    Json(request): Json<CreateTerminalRequest>,
) -> Result<(StatusCode, Json<TerminalInfo>), TerminalApiError> {
    let root = workspace_service(&state)?
        .root(&request.workspace_id)
        .await?;
    let command = match request.command {
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
                size: request.size,
            }
        }
    };
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
    tokio::spawn(async move {
        exit.wait().await;
        if let Some(managed) = weak.upgrade() {
            publish(&events, &managed.info());
        }
    });

    let info = managed.info();
    publish(&state.events, &info);
    Ok((StatusCode::CREATED, Json(info)))
}

/// Lists live terminals.
pub(crate) async fn list_terminals(State(state): State<ApiState>) -> Json<Vec<TerminalInfo>> {
    let mut terminals: Vec<_> = state
        .terminals
        .0
        .lock()
        .expect("terminal registry lock poisoned")
        .values()
        .map(|terminal| terminal.info())
        .collect();
    terminals.sort_by(|left, right| left.id.cmp(&right.id));
    Json(terminals)
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
    let managed = state
        .terminals
        .0
        .lock()
        .expect("terminal registry lock poisoned")
        .remove(&terminal_id)
        .ok_or(TerminalApiError::NotFound)?;
    managed.terminal.close(CLOSE_GRACE).await;
    Ok(Json(managed.info()))
}

/// Attaches a WebSocket to a terminal's input and output.
///
/// The stream first sends the terminal's scrollback as one binary frame, when
/// it holds any output, and then live output. A client that reattaches
/// receives the whole scrollback again, so it should clear its screen first.
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
    let replay = attachment.replay();
    if !replay.is_empty() && socket.send(Message::Binary(replay)).await.is_err() {
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
                // socket would look like a network failure.
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
    use crate::{ApiToken, default_diagnostics, router_with_services};

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";
    /// Upper bound for one real-process step. It only turns a hang into a
    /// failure.
    const STEP_LIMIT: Duration = Duration::from_secs(20);

    type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

    struct Fixture {
        _directory: TempDir,
        app: Router,
        events: EventHub,
        workspace_id: String,
        address: SocketAddr,
    }

    async fn fixture() -> Fixture {
        let directory = tempdir().unwrap();
        let root = directory.path().join("project");
        fs::create_dir(&root).unwrap();
        let database = Database::open(":memory:").await.unwrap();
        let workspaces = WorkspaceService::new(database.workspaces());
        let workspace = workspaces.open(&root, None).await.unwrap();
        let events = EventHub::default();
        let app = router_with_services(
            ApiToken::configured(TOKEN).unwrap(),
            events.clone(),
            Some(workspaces),
            default_diagnostics(),
            None,
            None,
            None,
        );
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(axum::serve(listener, app.clone()).into_future());
        Fixture {
            _directory: directory,
            app,
            events,
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
    async fn streams_input_output_resize_and_exit() {
        let fixture = fixture().await;
        let info = fixture
            .create("read line; echo \"got:$line\"; stty size; exit 4")
            .await;
        assert_eq!(info.status, TerminalStatus::Running);
        assert_eq!(info.command[0], "/bin/sh");

        let mut socket = fixture.connect(&info.id, Some(TOKEN)).await.unwrap();
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
        assert_eq!(body.as_array().unwrap().len(), 2);

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

    #[test]
    fn recognizes_only_terminal_stream_paths() {
        assert!(is_stream_path("/api/terminals/abc/stream"));
        assert!(!is_stream_path("/api/terminals//stream"));
        assert!(!is_stream_path("/api/terminals/a/b/stream"));
        assert!(!is_stream_path("/api/terminals/abc"));
    }
}
