use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::error::Error;
use std::ffi::OsString;
use std::fmt;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStderr, ChildStdout, Command};
use tokio::sync::{Mutex, broadcast, oneshot, watch};

#[cfg(unix)]
use crate::process_group::signal_process_group;
use crate::process_group::{ProcessGroup, lead_process_group};
use crate::{
    AgentCapabilities, AgentControl, AgentControlError, AgentEvent, AgentEventKind,
    AgentSessionStatus,
};

/// Protocol version exported by `@stormlightlabs/pau-claude-bridge`.
pub const CLAUDE_BRIDGE_PROTOCOL_VERSION: u64 = 1;

/// Controls exposed by the Claude bridge host.
pub const CLAUDE_BRIDGE_CAPABILITIES: AgentCapabilities = AgentCapabilities {
    prompt: true,
    follow_up: false,
    steer: false,
    interrupt: true,
    message_queue: false,
    model_selection: false,
    thinking_level: false,
    command_discovery: false,
    usage: false,
    compaction: false,
    branching: false,
    retry: false,
    rename: false,
    clone_session: false,
    shell_commands: false,
    stop: true,
};

/// Time a new bridge host has to answer the `status` handshake.
///
/// The host answers once it has checked the Claude Code version, which takes
/// a few seconds at most. A host that has not answered by then is killed and
/// the start fails, so a hung host cannot leave the start request pending.
pub const CLAUDE_BRIDGE_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(30);

/// Time allowed for each stage of bridge-host shutdown.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ClaudeBridgeShutdownTimeouts {
    /// Time for the host to stop after protocol input closes.
    pub protocol: Duration,
    /// Time after an interrupt signal.
    pub interrupt: Duration,
    /// Time after a terminate signal.
    pub terminate: Duration,
    /// Time after a forced kill.
    pub kill: Duration,
}

impl Default for ClaudeBridgeShutdownTimeouts {
    fn default() -> Self {
        Self {
            protocol: Duration::from_secs(2),
            interrupt: Duration::from_secs(2),
            terminate: Duration::from_secs(2),
            kill: Duration::from_secs(2),
        }
    }
}

/// Command used to start the package's stdio bridge host.
#[derive(Clone, Debug)]
pub struct StartClaudeBridgeOptions {
    /// Bridge host executable, normally the package's `pau-claude-bridge` bin.
    pub executable_path: PathBuf,
    /// Workspace inherited by the host.
    pub working_directory: PathBuf,
    /// Arguments passed to the bridge host.
    pub arguments: Vec<OsString>,
    /// Variables added to Pau's environment for the host and the Claude Code
    /// process it starts.
    pub environment: Vec<(OsString, OsString)>,
    /// Deadlines for shutdown escalation.
    pub shutdown_timeouts: ClaudeBridgeShutdownTimeouts,
}

/// A structured bridge command error.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ClaudeBridgeCommandError {
    /// Stable package-defined error code.
    pub code: String,
    /// Human-readable failure text.
    pub message: String,
    /// Whether retrying after a state change can succeed.
    pub recoverable: bool,
    /// Adapter-specific details retained from the bridge.
    #[serde(default)]
    pub details: Option<Value>,
}

/// A correlated response from the bridge host.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ClaudeBridgeResponse {
    /// Correlation identifier supplied by Pau.
    pub id: String,
    /// Whether the command succeeded.
    pub ok: bool,
    /// Successful command data.
    #[serde(default)]
    pub result: Option<Value>,
    /// Failed command data.
    #[serde(default)]
    pub error: Option<ClaudeBridgeCommandError>,
}

/// An ordered event emitted by the Claude bridge.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ClaudeBridgeEvent {
    /// Monotonic sequence assigned by the package.
    pub sequence: u64,
    /// Package-defined event name.
    pub event: String,
    /// Package-owned event payload.
    #[serde(default)]
    pub payload: Option<Value>,
}

/// Severity of a bridge diagnostic.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ClaudeDiagnosticLevel {
    /// Detailed development information.
    Debug,
    /// Normal process information.
    Info,
    /// A condition that did not stop the process.
    Warn,
    /// A protocol or process failure.
    Error,
}

/// A record read only from the bridge diagnostic stream.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ClaudeBridgeDiagnostic {
    /// Diagnostic severity.
    pub level: ClaudeDiagnosticLevel,
    /// Diagnostic text.
    pub message: String,
    /// Package-owned structured context.
    #[serde(default)]
    pub context: Option<Value>,
}

/// A valid record from the bridge protocol stream.
#[derive(Clone, Debug, PartialEq)]
pub enum ClaudeBridgeFrame {
    /// A correlated command response.
    Response(ClaudeBridgeResponse),
    /// An ordered agent event.
    Event(ClaudeBridgeEvent),
}

/// Why one complete bridge record was rejected.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ClaudeBridgeDecodeError {
    /// The line was not a valid contract frame.
    Malformed(String),
    /// The line used a protocol version this adapter does not implement.
    UnsupportedVersion(u64),
}

impl fmt::Display for ClaudeBridgeDecodeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Malformed(message) => {
                write!(formatter, "malformed Claude bridge frame: {message}")
            }
            Self::UnsupportedVersion(version) => {
                write!(
                    formatter,
                    "unsupported Claude bridge protocol version: {version}"
                )
            }
        }
    }
}

impl Error for ClaudeBridgeDecodeError {}

#[derive(Deserialize)]
struct Envelope {
    version: u64,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum ProtocolRecord {
    #[serde(rename = "response")]
    Response {
        version: u64,
        #[serde(flatten)]
        response: ClaudeBridgeResponse,
    },
    #[serde(rename = "event")]
    Event {
        version: u64,
        #[serde(flatten)]
        event: ClaudeBridgeEvent,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DiagnosticRecord {
    version: u64,
    #[serde(rename = "type")]
    kind: String,
    #[serde(flatten)]
    diagnostic: ClaudeBridgeDiagnostic,
}

/// Decodes one complete protocol-stream fixture record.
pub fn decode_claude_bridge_frame(
    line: &str,
) -> Result<ClaudeBridgeFrame, ClaudeBridgeDecodeError> {
    let envelope: Envelope = serde_json::from_str(line)
        .map_err(|error| ClaudeBridgeDecodeError::Malformed(error.to_string()))?;
    if envelope.version != CLAUDE_BRIDGE_PROTOCOL_VERSION {
        return Err(ClaudeBridgeDecodeError::UnsupportedVersion(
            envelope.version,
        ));
    }
    let record: ProtocolRecord = serde_json::from_str(line)
        .map_err(|error| ClaudeBridgeDecodeError::Malformed(error.to_string()))?;
    Ok(match record {
        ProtocolRecord::Response { version, response } => {
            debug_assert_eq!(version, CLAUDE_BRIDGE_PROTOCOL_VERSION);
            ClaudeBridgeFrame::Response(response)
        }
        ProtocolRecord::Event { version, event } => {
            debug_assert_eq!(version, CLAUDE_BRIDGE_PROTOCOL_VERSION);
            ClaudeBridgeFrame::Event(event)
        }
    })
}

/// Decodes one complete diagnostic-stream fixture record.
pub fn decode_claude_bridge_diagnostic(
    line: &str,
) -> Result<ClaudeBridgeDiagnostic, ClaudeBridgeDecodeError> {
    let envelope: Envelope = serde_json::from_str(line)
        .map_err(|error| ClaudeBridgeDecodeError::Malformed(error.to_string()))?;
    if envelope.version != CLAUDE_BRIDGE_PROTOCOL_VERSION {
        return Err(ClaudeBridgeDecodeError::UnsupportedVersion(
            envelope.version,
        ));
    }
    let record: DiagnosticRecord = serde_json::from_str(line)
        .map_err(|error| ClaudeBridgeDecodeError::Malformed(error.to_string()))?;
    if record.kind != "diagnostic" {
        return Err(ClaudeBridgeDecodeError::Malformed(
            "diagnostic stream record has the wrong type".to_owned(),
        ));
    }
    debug_assert_eq!(record.version, CLAUDE_BRIDGE_PROTOCOL_VERSION);
    Ok(record.diagnostic)
}

/// Source of a Claude adapter diagnostic.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ClaudeBridgeDiagnosticSource {
    /// A package diagnostic from stderr.
    Bridge,
    /// Invalid data from the protocol stream.
    Protocol,
    /// A host-process I/O failure.
    Process,
}

/// Diagnostic retained outside the protocol event stream.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaudeAdapterDiagnostic {
    /// Stream or subsystem that reported the issue.
    pub source: ClaudeBridgeDiagnosticSource,
    /// Structured package severity when available.
    pub level: Option<ClaudeDiagnosticLevel>,
    /// Diagnostic text.
    pub message: String,
}

/// Exit information for one bridge host.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaudeBridgeExit {
    /// Platform exit code, when supplied.
    pub code: Option<i32>,
    /// Unix signal, when applicable.
    pub signal: Option<i32>,
    /// Whether Pau requested shutdown first.
    pub requested: bool,
}

/// Output produced asynchronously by a bridge host.
#[derive(Clone, Debug, PartialEq)]
pub enum ClaudeBridgeOutput {
    /// Valid package event.
    Event(ClaudeBridgeEvent),
    /// Diagnostic kept separate from events.
    Diagnostic(ClaudeAdapterDiagnostic),
    /// Host-process exit.
    Exit(ClaudeBridgeExit),
}

/// Failure to start, command, or stop the bridge host.
#[derive(Debug)]
pub enum ClaudeBridgeProcessError {
    /// The host process could not start.
    Start(std::io::Error),
    /// The command could not be written.
    Write(std::io::Error),
    /// The package rejected a command.
    Rejected(ClaudeBridgeCommandError),
    /// The host exited before responding.
    Exited(ClaudeBridgeExit),
    /// The host did not answer the `status` handshake in time and was killed.
    HandshakeTimeout(Duration),
    /// The host survived the forced-kill deadline.
    KillTimeout,
    /// A platform signal failed.
    Signal(std::io::Error),
}

impl fmt::Display for ClaudeBridgeProcessError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Start(error) => write!(formatter, "could not start Claude bridge: {error}"),
            Self::Write(error) => {
                write!(formatter, "could not write Claude bridge command: {error}")
            }
            Self::Rejected(error) => write!(
                formatter,
                "Claude bridge rejected {}: {}",
                error.code, error.message
            ),
            Self::Exited(exit) => write!(
                formatter,
                "Claude bridge exited before responding: {exit:?}"
            ),
            Self::HandshakeTimeout(deadline) => write!(
                formatter,
                "Claude bridge did not answer within {} seconds of starting",
                deadline.as_secs()
            ),
            Self::KillTimeout => {
                formatter.write_str("Claude bridge did not exit after the kill deadline")
            }
            Self::Signal(error) => write!(formatter, "could not signal Claude bridge: {error}"),
        }
    }
}

impl Error for ClaudeBridgeProcessError {}

type PendingCommands = Arc<Mutex<HashMap<String, oneshot::Sender<ClaudeBridgeResponse>>>>;

/// Owns one package stdio host; it never speaks Claude's native protocol.
pub struct ClaudeBridgeProcess {
    stdin: Mutex<Option<tokio::process::ChildStdin>>,
    pending: PendingCommands,
    output: broadcast::Sender<ClaudeBridgeOutput>,
    exit: watch::Receiver<Option<ClaudeBridgeExit>>,
    kill: tokio::sync::mpsc::Sender<()>,
    next_command_id: AtomicU64,
    process_id: u32,
    shutdown_timeouts: ClaudeBridgeShutdownTimeouts,
    shutdown_requested: Arc<AtomicBool>,
}

impl ClaudeBridgeProcess {
    /// Starts a bridge host with piped contract and diagnostic streams.
    pub fn start(options: StartClaudeBridgeOptions) -> Result<Self, ClaudeBridgeProcessError> {
        let mut command = Command::new(&options.executable_path);
        command
            .args(&options.arguments)
            .envs(
                options
                    .environment
                    .iter()
                    .map(|(name, value)| (name, value)),
            )
            .current_dir(&options.working_directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = lead_process_group(&mut command)
            .spawn()
            .map_err(ClaudeBridgeProcessError::Start)?;
        let process_id = child.id().ok_or_else(|| {
            ClaudeBridgeProcessError::Start(std::io::Error::other(
                "bridge host did not report a process ID",
            ))
        })?;
        let stdin = child.stdin.take().ok_or_else(|| missing_pipe("stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| missing_pipe("stdout"))?;
        let stderr = child.stderr.take().ok_or_else(|| missing_pipe("stderr"))?;
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let (output, _) = broadcast::channel(256);
        let (exit_sender, exit) = watch::channel(None);
        let (kill, mut kill_receiver) = tokio::sync::mpsc::channel(1);
        let shutdown_requested = Arc::new(AtomicBool::new(false));

        tokio::spawn(read_protocol(stdout, Arc::clone(&pending), output.clone()));
        tokio::spawn(read_diagnostics(stderr, output.clone()));
        let watcher_output = output.clone();
        let watcher_pending = Arc::clone(&pending);
        let watcher_requested = Arc::clone(&shutdown_requested);
        let mut group = ProcessGroup::new(child);
        tokio::spawn(async move {
            let status = tokio::select! {
                status = group.wait() => status,
                _ = kill_receiver.recv() => group.kill().await,
            };
            if let Ok(status) = status {
                let exit = process_exit(status, watcher_requested.load(Ordering::SeqCst));
                watcher_pending.lock().await.clear();
                let _ = exit_sender.send(Some(exit.clone()));
                let _ = watcher_output.send(ClaudeBridgeOutput::Exit(exit));
            }
        });

        Ok(Self {
            stdin: Mutex::new(Some(stdin)),
            pending,
            output,
            exit,
            kill,
            next_command_id: AtomicU64::new(1),
            process_id,
            shutdown_timeouts: options.shutdown_timeouts,
            shutdown_requested,
        })
    }

    /// Returns the bridge host PID used as the root of Claude's process tree.
    pub fn process_id(&self) -> u32 {
        self.process_id
    }

    /// Subscribes to package events, diagnostics, and process exit.
    pub fn subscribe(&self) -> broadcast::Receiver<ClaudeBridgeOutput> {
        self.output.subscribe()
    }

    /// Sends a command and waits for the response with its generated ID.
    pub async fn command(
        &self,
        command: &str,
        payload: Option<Value>,
    ) -> Result<Value, ClaudeBridgeProcessError> {
        if let Some(exit) = self.exit.borrow().clone() {
            return Err(ClaudeBridgeProcessError::Exited(exit));
        }
        let id = format!(
            "pau-{}",
            self.next_command_id.fetch_add(1, Ordering::Relaxed)
        );
        let frame = CommandFrame {
            version: CLAUDE_BRIDGE_PROTOCOL_VERSION,
            kind: "command",
            id: &id,
            command,
            payload,
        };
        let mut encoded = serde_json::to_vec(&frame).expect("bridge command values serialize");
        encoded.push(b'\n');
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(id.clone(), sender);
        let write = async {
            let mut stdin = self.stdin.lock().await;
            let stdin = stdin.as_mut().ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::BrokenPipe, "bridge stdin is closed")
            })?;
            stdin.write_all(&encoded).await?;
            stdin.flush().await
        }
        .await;
        if let Err(error) = write {
            self.pending.lock().await.remove(&id);
            return Err(ClaudeBridgeProcessError::Write(error));
        }
        let response = receiver.await.map_err(|_| {
            ClaudeBridgeProcessError::Exited(self.exit.borrow().clone().unwrap_or(
                ClaudeBridgeExit {
                    code: None,
                    signal: None,
                    requested: false,
                },
            ))
        })?;
        if response.ok {
            Ok(response.result.unwrap_or(Value::Null))
        } else {
            Err(ClaudeBridgeProcessError::Rejected(
                response.error.unwrap_or(ClaudeBridgeCommandError {
                    code: "invalid_response".to_owned(),
                    message: "Claude bridge returned a failed response without an error".to_owned(),
                    recoverable: false,
                    details: None,
                }),
            ))
        }
    }

    /// Closes contract input and escalates signals if the host does not stop.
    pub async fn shutdown(&self) -> Result<ClaudeBridgeExit, ClaudeBridgeProcessError> {
        self.shutdown_requested.store(true, Ordering::SeqCst);
        self.stdin.lock().await.take();
        if let Some(exit) =
            wait_for_exit_for(self.exit.clone(), self.shutdown_timeouts.protocol).await
        {
            return Ok(exit);
        }
        self.send_signal(interrupt_signal()).await?;
        if let Some(exit) =
            wait_for_exit_for(self.exit.clone(), self.shutdown_timeouts.interrupt).await
        {
            return Ok(exit);
        }
        self.send_signal(terminate_signal()).await?;
        if let Some(exit) =
            wait_for_exit_for(self.exit.clone(), self.shutdown_timeouts.terminate).await
        {
            return Ok(exit);
        }
        let _ = self.kill.send(()).await;
        wait_for_exit_for(self.exit.clone(), self.shutdown_timeouts.kill)
            .await
            .ok_or(ClaudeBridgeProcessError::KillTimeout)
    }

    #[cfg(unix)]
    async fn send_signal(&self, signal: i32) -> Result<(), ClaudeBridgeProcessError> {
        signal_process_group(self.process_id, signal).map_err(ClaudeBridgeProcessError::Signal)
    }

    #[cfg(not(unix))]
    async fn send_signal(&self, _signal: i32) -> Result<(), ClaudeBridgeProcessError> {
        let _ = self.kill.send(()).await;
        Ok(())
    }
}

#[derive(Serialize)]
struct CommandFrame<'a> {
    version: u64,
    #[serde(rename = "type")]
    kind: &'static str,
    id: &'a str,
    command: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<Value>,
}

/// Claude event meaning projected without changing the package payload.
#[derive(Clone, Debug, PartialEq)]
pub enum ClaudeEventPayload {
    /// Streamed assistant text.
    TextDelta { text: String },
    /// A tool invocation began.
    ToolStarted {
        id: String,
        name: String,
        input: Value,
    },
    /// A tool invocation finished.
    ToolCompleted {
        id: String,
        content: Value,
        is_error: bool,
    },
    /// The authoritative turn result and resulting session state.
    TurnCompleted {
        status: AgentSessionStatus,
        completion: Value,
    },
    /// A package event unknown to this adapter release.
    Unknown {
        event: String,
        payload: Option<Value>,
    },
}

/// Projects the package's fixture events into the shared agent categories.
pub fn project_claude_event(event: &ClaudeBridgeEvent) -> AgentEvent<ClaudeEventPayload> {
    let payload = event.payload.clone().unwrap_or(Value::Null);
    match event.event.as_str() {
        "text.delta" => AgentEvent::new(
            AgentEventKind::TextDelta,
            ClaudeEventPayload::TextDelta {
                text: payload
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
            },
        ),
        "tool.started" => AgentEvent::new(
            AgentEventKind::ToolCall,
            ClaudeEventPayload::ToolStarted {
                id: payload
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                name: payload
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                input: payload.get("input").cloned().unwrap_or(Value::Null),
            },
        ),
        "tool.completed" => AgentEvent::new(
            AgentEventKind::ToolResult,
            ClaudeEventPayload::ToolCompleted {
                id: payload
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                content: payload.get("content").cloned().unwrap_or(Value::Null),
                is_error: payload
                    .get("isError")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            },
        ),
        "turn.completed" => {
            let status = if payload.get("status").and_then(Value::as_str) == Some("failed") {
                AgentSessionStatus::Failed
            } else {
                AgentSessionStatus::Idle
            };
            AgentEvent::new(
                AgentEventKind::Lifecycle,
                ClaudeEventPayload::TurnCompleted {
                    status,
                    completion: payload,
                },
            )
        }
        _ => AgentEvent::new(
            AgentEventKind::Lifecycle,
            ClaudeEventPayload::Unknown {
                event: event.event.clone(),
                payload: event.payload.clone(),
            },
        ),
    }
}

/// Session controls backed only by the package's versioned bridge commands.
pub struct ClaudeSession {
    process: Arc<ClaudeBridgeProcess>,
    status: Arc<Mutex<AgentSessionStatus>>,
    native_session_id: Arc<Mutex<Option<String>>>,
}

impl ClaudeSession {
    /// Starts and handshakes with one package bridge host, killing it when it
    /// does not answer within [`CLAUDE_BRIDGE_HANDSHAKE_TIMEOUT`].
    pub async fn start(
        options: StartClaudeBridgeOptions,
    ) -> Result<Self, ClaudeBridgeProcessError> {
        Self::start_within(options, CLAUDE_BRIDGE_HANDSHAKE_TIMEOUT).await
    }

    async fn start_within(
        options: StartClaudeBridgeOptions,
        handshake_timeout: Duration,
    ) -> Result<Self, ClaudeBridgeProcessError> {
        let process = Arc::new(ClaudeBridgeProcess::start(options)?);
        let state =
            match tokio::time::timeout(handshake_timeout, process.command("status", None)).await {
                Ok(state) => state?,
                Err(_) => {
                    let _ = process.kill.send(()).await;
                    wait_for_exit_for(process.exit.clone(), process.shutdown_timeouts.kill).await;
                    return Err(ClaudeBridgeProcessError::HandshakeTimeout(
                        handshake_timeout,
                    ));
                }
            };
        let native_session_id = state
            .get("nativeSessionId")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let session = Self {
            process: Arc::clone(&process),
            status: Arc::new(Mutex::new(AgentSessionStatus::Idle)),
            native_session_id: Arc::new(Mutex::new(native_session_id)),
        };
        observe_session(
            process.subscribe(),
            Arc::clone(&session.status),
            Arc::clone(&session.native_session_id),
        );
        Ok(session)
    }

    /// Returns controls implemented by the bridge contract.
    pub fn capabilities(&self) -> AgentCapabilities {
        CLAUDE_BRIDGE_CAPABILITIES
    }

    /// Returns the root PID used to register this session with resource monitoring.
    pub fn process_id(&self) -> u32 {
        self.process.process_id()
    }

    /// Returns the latest state projected from controls and package events.
    pub async fn status(&self) -> AgentSessionStatus {
        *self.status.lock().await
    }

    /// Returns Claude's native session identifier after a completed turn.
    pub async fn native_session_id(&self) -> Option<String> {
        self.native_session_id.lock().await.clone()
    }

    /// Subscribes to unmodified package events and separate diagnostics.
    pub fn subscribe(&self) -> broadcast::Receiver<ClaudeBridgeOutput> {
        self.process.subscribe()
    }

    /// Starts one Claude turn.
    pub async fn prompt(&self, text: impl Into<String>) -> Result<(), ClaudeSessionError> {
        let mut status = self.status.lock().await;
        if *status != AgentSessionStatus::Idle {
            return Err(invalid_state(
                AgentControl::Prompt,
                *status,
                "wait for the session to become idle",
            ));
        }
        self.process
            .command("prompt", Some(json!({ "text": text.into() })))
            .await?;
        *status = AgentSessionStatus::Running;
        Ok(())
    }

    /// Interrupts the active turn without stopping the bridge host.
    pub async fn interrupt(&self) -> Result<(), ClaudeSessionError> {
        let status = *self.status.lock().await;
        if status != AgentSessionStatus::Running {
            return Err(invalid_state(
                AgentControl::Interrupt,
                status,
                "only a running session can be interrupted",
            ));
        }
        self.process.command("interrupt", None).await?;
        Ok(())
    }

    /// Stops the bridge host and its owned Claude process.
    pub async fn stop(&self) -> Result<ClaudeBridgeExit, ClaudeSessionError> {
        {
            let mut status = self.status.lock().await;
            // A failed session is accepted so its host can always be ended,
            // even when it exited on its own.
            if !matches!(
                *status,
                AgentSessionStatus::Idle
                    | AgentSessionStatus::Running
                    | AgentSessionStatus::Waiting
                    | AgentSessionStatus::Failed
            ) {
                return Err(invalid_state(
                    AgentControl::Stop,
                    *status,
                    "the session is already stopping or stopped",
                ));
            }
            *status = AgentSessionStatus::Stopping;
        }
        // Closing contract input invokes the package host's own staged Claude shutdown.
        let exit = self.process.shutdown().await?;
        *self.status.lock().await = AgentSessionStatus::Stopped;
        Ok(exit)
    }
}

/// A Claude session control or bridge transport failure.
#[derive(Debug)]
pub enum ClaudeSessionError {
    /// Shared capability or lifecycle rejection.
    Control(AgentControlError),
    /// Package bridge transport failure.
    Process(ClaudeBridgeProcessError),
}

impl fmt::Display for ClaudeSessionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Control(error) => error.fmt(formatter),
            Self::Process(error) => error.fmt(formatter),
        }
    }
}

impl Error for ClaudeSessionError {}

impl From<ClaudeBridgeProcessError> for ClaudeSessionError {
    fn from(error: ClaudeBridgeProcessError) -> Self {
        Self::Process(error)
    }
}

fn invalid_state(
    control: AgentControl,
    status: AgentSessionStatus,
    reason: &'static str,
) -> ClaudeSessionError {
    ClaudeSessionError::Control(AgentControlError::InvalidState {
        control,
        status,
        reason,
    })
}

fn observe_session(
    mut output: broadcast::Receiver<ClaudeBridgeOutput>,
    status: Arc<Mutex<AgentSessionStatus>>,
    native_session_id: Arc<Mutex<Option<String>>>,
) {
    tokio::spawn(async move {
        loop {
            match output.recv().await {
                Ok(ClaudeBridgeOutput::Event(event)) if event.event == "turn.completed" => {
                    let payload = event.payload.as_ref();
                    if let Some(id) = payload
                        .and_then(|value| value.get("sessionId"))
                        .and_then(Value::as_str)
                    {
                        *native_session_id.lock().await = Some(id.to_owned());
                    }
                    // Every finished turn leaves the session idle, failed ones
                    // included: a failed API call ends the turn, not the bridge,
                    // so the next prompt must still be accepted.
                    let mut current = status.lock().await;
                    if !matches!(
                        *current,
                        AgentSessionStatus::Stopping | AgentSessionStatus::Stopped
                    ) {
                        *current = AgentSessionStatus::Idle;
                    }
                }
                Ok(ClaudeBridgeOutput::Exit(exit)) => {
                    let mut current = status.lock().await;
                    *current = if exit.requested || *current == AgentSessionStatus::Stopping {
                        AgentSessionStatus::Stopped
                    } else {
                        AgentSessionStatus::Failed
                    };
                    break;
                }
                Ok(_) => {}
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

async fn read_protocol(
    stdout: ChildStdout,
    pending: PendingCommands,
    output: broadcast::Sender<ClaudeBridgeOutput>,
) {
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        match decode_claude_bridge_frame(&line) {
            Ok(ClaudeBridgeFrame::Response(response)) => {
                if let Some(sender) = pending.lock().await.remove(&response.id) {
                    let _ = sender.send(response);
                } else {
                    protocol_diagnostic(
                        &output,
                        "Claude bridge returned an uncorrelated response".to_owned(),
                    );
                }
            }
            Ok(ClaudeBridgeFrame::Event(event)) => {
                let _ = output.send(ClaudeBridgeOutput::Event(event));
            }
            Err(error) => protocol_diagnostic(&output, error.to_string()),
        }
    }
}

async fn read_diagnostics(stderr: ChildStderr, output: broadcast::Sender<ClaudeBridgeOutput>) {
    let mut lines = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let diagnostic = match decode_claude_bridge_diagnostic(&line) {
            Ok(frame) => ClaudeAdapterDiagnostic {
                source: ClaudeBridgeDiagnosticSource::Bridge,
                level: Some(frame.level),
                message: frame.message,
            },
            Err(_) => ClaudeAdapterDiagnostic {
                source: ClaudeBridgeDiagnosticSource::Bridge,
                level: None,
                message: line,
            },
        };
        let _ = output.send(ClaudeBridgeOutput::Diagnostic(diagnostic));
    }
}

fn protocol_diagnostic(output: &broadcast::Sender<ClaudeBridgeOutput>, message: String) {
    let _ = output.send(ClaudeBridgeOutput::Diagnostic(ClaudeAdapterDiagnostic {
        source: ClaudeBridgeDiagnosticSource::Protocol,
        level: Some(ClaudeDiagnosticLevel::Error),
        message,
    }));
}

fn missing_pipe(name: &str) -> ClaudeBridgeProcessError {
    ClaudeBridgeProcessError::Start(std::io::Error::other(format!(
        "Claude bridge {name} pipe was not available"
    )))
}

async fn wait_for_exit(
    mut exit: watch::Receiver<Option<ClaudeBridgeExit>>,
) -> Option<ClaudeBridgeExit> {
    loop {
        if let Some(exit) = exit.borrow().clone() {
            return Some(exit);
        }
        if exit.changed().await.is_err() {
            return exit.borrow().clone();
        }
    }
}

async fn wait_for_exit_for(
    exit: watch::Receiver<Option<ClaudeBridgeExit>>,
    duration: Duration,
) -> Option<ClaudeBridgeExit> {
    tokio::time::timeout(duration, wait_for_exit(exit))
        .await
        .ok()
        .flatten()
}

fn process_exit(status: std::process::ExitStatus, requested: bool) -> ClaudeBridgeExit {
    #[cfg(unix)]
    use std::os::unix::process::ExitStatusExt;
    ClaudeBridgeExit {
        code: status.code(),
        #[cfg(unix)]
        signal: status.signal(),
        #[cfg(not(unix))]
        signal: None,
        requested,
    }
}

#[cfg(unix)]
fn interrupt_signal() -> i32 {
    libc::SIGINT
}
#[cfg(not(unix))]
fn interrupt_signal() -> i32 {
    0
}
#[cfg(unix)]
fn terminate_signal() -> i32 {
    libc::SIGTERM
}
#[cfg(not(unix))]
fn terminate_signal() -> i32 {
    0
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::process_group::tests::{assert_gone, grandchild, host_with_grandchild};

    #[tokio::test]
    async fn kills_a_bridge_that_never_answers_the_handshake() {
        let directory = tempfile::tempdir().unwrap();
        let options = StartClaudeBridgeOptions {
            executable_path: host_with_grandchild(directory.path()),
            working_directory: directory.path().to_path_buf(),
            arguments: Vec::new(),
            environment: Vec::new(),
            shutdown_timeouts: ClaudeBridgeShutdownTimeouts::default(),
        };

        let error = ClaudeSession::start_within(options, Duration::from_secs(3))
            .await
            .err()
            .expect("the start should fail");
        assert!(
            matches!(error, ClaudeBridgeProcessError::HandshakeTimeout(_)),
            "{error}"
        );
        assert!(error.to_string().contains("did not answer"), "{error}");
        assert_gone(grandchild(directory.path()).await).await;
    }
}
