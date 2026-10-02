use serde_json::{Map, Value};
use std::collections::HashMap;
use std::error::Error;
use std::ffi::OsString;
use std::fmt;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStderr, ChildStdout, Command};
use tokio::sync::{Mutex, broadcast, oneshot, watch};

/// Time allowed for each stage of Pi process shutdown.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PiShutdownTimeouts {
    /// Time for Pi to exit after its protocol input closes.
    pub protocol: Duration,
    /// Time for Pi to exit after an interrupt signal.
    pub interrupt: Duration,
    /// Time for Pi to exit after a terminate signal.
    pub terminate: Duration,
    /// Time for Pi to exit after a kill signal.
    pub kill: Duration,
}

impl Default for PiShutdownTimeouts {
    fn default() -> Self {
        Self {
            protocol: Duration::from_secs(2),
            interrupt: Duration::from_secs(2),
            terminate: Duration::from_secs(2),
            kill: Duration::from_secs(2),
        }
    }
}

/// Options for starting one Pi RPC process.
#[derive(Clone, Debug)]
pub struct StartPiProcessOptions {
    /// The Pi executable returned by discovery.
    pub executable_path: PathBuf,
    /// The workspace in which Pi runs.
    pub working_directory: PathBuf,
    /// Additional Pi CLI arguments, after `--mode rpc`.
    pub arguments: Vec<OsString>,
    /// Variables added to Pau's environment for this process.
    pub environment: Vec<(OsString, OsString)>,
    /// Deadlines for orderly shutdown and signal escalation.
    pub shutdown_timeouts: PiShutdownTimeouts,
}

/// The source of a process diagnostic.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PiDiagnosticSource {
    /// Text written to Pi's stderr stream.
    Stderr,
    /// Invalid or uncorrelated data written to the RPC stdout stream.
    Protocol,
    /// A failure while reading a child-process stream.
    Process,
}

/// A diagnostic kept separate from valid RPC records.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PiDiagnostic {
    /// The stream or subsystem that produced the diagnostic.
    pub source: PiDiagnosticSource,
    /// Diagnostic text, without a trailing CR or LF.
    pub message: String,
}

/// A completed Pi child process.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PiProcessExit {
    /// The platform exit code, when the process reported one.
    pub code: Option<i32>,
    /// The terminating Unix signal, when applicable.
    pub signal: Option<i32>,
    /// Whether Pau had started staged shutdown before the exit.
    pub requested: bool,
}

/// Asynchronous output from a Pi RPC process.
#[derive(Clone, Debug, PartialEq)]
pub enum PiProcessOutput {
    /// A valid RPC record that is not a correlated command response.
    Event(Value),
    /// Stderr text or a protocol/process diagnostic.
    Diagnostic(PiDiagnostic),
    /// The child process exited.
    Exit(PiProcessExit),
}

/// A Pi process or RPC transport failure.
#[derive(Debug)]
pub enum PiProcessError {
    /// The child process could not be started with piped RPC streams.
    Start(std::io::Error),
    /// An outgoing record must be a JSON object with a string `type` field.
    InvalidCommand,
    /// The command could not be written to Pi.
    Write(std::io::Error),
    /// Pi exited before returning this command's response.
    Exited(PiProcessExit),
    /// Pi did not exit after the final kill deadline.
    KillTimeout,
    /// A platform signal could not be sent to Pi.
    Signal(std::io::Error),
}

impl fmt::Display for PiProcessError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Start(error) => write!(formatter, "could not start Pi RPC process: {error}"),
            Self::InvalidCommand => {
                formatter.write_str("Pi RPC records must be JSON objects with a string `type`")
            }
            Self::Write(error) => write!(formatter, "could not write Pi RPC command: {error}"),
            Self::Exited(exit) => write!(formatter, "Pi exited before responding: {exit:?}"),
            Self::KillTimeout => formatter.write_str("Pi did not exit after the kill deadline"),
            Self::Signal(error) => write!(formatter, "could not signal Pi: {error}"),
        }
    }
}

impl Error for PiProcessError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Start(error) | Self::Write(error) | Self::Signal(error) => Some(error),
            _ => None,
        }
    }
}

type PendingCommands = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;

/// Owns one supervised `pi --mode rpc` child process.
pub struct PiProcess {
    stdin: Mutex<Option<tokio::process::ChildStdin>>,
    pending: PendingCommands,
    output: broadcast::Sender<PiProcessOutput>,
    exit: watch::Receiver<Option<PiProcessExit>>,
    kill: tokio::sync::mpsc::Sender<()>,
    next_command_id: AtomicU64,
    process_id: u32,
    shutdown_timeouts: PiShutdownTimeouts,
    shutdown_requested: Arc<std::sync::atomic::AtomicBool>,
}

impl PiProcess {
    /// Starts Pi with piped stdin, stdout, and stderr in RPC mode.
    pub fn start(options: StartPiProcessOptions) -> Result<Self, PiProcessError> {
        let mut command = Command::new(&options.executable_path);
        command
            .arg("--mode")
            .arg("rpc")
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
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let mut child =
            crate::retry_executable_busy(|| command.spawn()).map_err(PiProcessError::Start)?;
        let process_id = child.id().ok_or_else(|| {
            PiProcessError::Start(std::io::Error::other("Pi did not report a process ID"))
        })?;
        let stdin = child.stdin.take().ok_or_else(|| missing_pipe("stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| missing_pipe("stdout"))?;
        let stderr = child.stderr.take().ok_or_else(|| missing_pipe("stderr"))?;
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let (output, _) = broadcast::channel(256);
        let (exit_sender, exit) = watch::channel(None);
        let (kill_sender, mut kill_receiver) = tokio::sync::mpsc::channel(1);
        let shutdown_requested = Arc::new(std::sync::atomic::AtomicBool::new(false));

        tokio::spawn(read_stdout(stdout, Arc::clone(&pending), output.clone()));
        tokio::spawn(read_stderr(stderr, output.clone()));

        let watcher_output = output.clone();
        let watcher_pending = Arc::clone(&pending);
        let watcher_shutdown = Arc::clone(&shutdown_requested);
        tokio::spawn(async move {
            let status = tokio::select! {
                status = child.wait() => status,
                _ = kill_receiver.recv() => {
                    let _ = child.start_kill();
                    child.wait().await
                }
            };
            match status {
                Ok(status) => {
                    let exit = process_exit(status, watcher_shutdown.load(Ordering::SeqCst));
                    watcher_pending.lock().await.clear();
                    let _ = exit_sender.send(Some(exit.clone()));
                    let _ = watcher_output.send(PiProcessOutput::Exit(exit));
                }
                Err(error) => {
                    let _ = watcher_output.send(PiProcessOutput::Diagnostic(PiDiagnostic {
                        source: PiDiagnosticSource::Process,
                        message: format!("could not wait for Pi: {error}"),
                    }));
                }
            }
        });

        Ok(Self {
            stdin: Mutex::new(Some(stdin)),
            pending,
            output,
            exit,
            kill: kill_sender,
            next_command_id: AtomicU64::new(1),
            process_id,
            shutdown_timeouts: options.shutdown_timeouts,
            shutdown_requested,
        })
    }

    /// Returns the operating-system identifier used by resource monitoring.
    pub fn process_id(&self) -> u32 {
        self.process_id
    }

    /// Subscribes to events, diagnostics, and process exit notifications.
    pub fn subscribe(&self) -> broadcast::Receiver<PiProcessOutput> {
        self.output.subscribe()
    }

    /// Sends one command and resolves it with the response bearing the same ID.
    pub async fn command(&self, command: Value) -> Result<Value, PiProcessError> {
        let mut command = match command {
            Value::Object(command) if command.get("type").and_then(Value::as_str).is_some() => {
                command
            }
            _ => return Err(PiProcessError::InvalidCommand),
        };
        if let Some(exit) = self.exit.borrow().clone() {
            return Err(PiProcessError::Exited(exit));
        }

        let id = format!(
            "pau-{}",
            self.next_command_id.fetch_add(1, Ordering::Relaxed)
        );
        command.insert("id".to_owned(), Value::String(id.clone()));
        let encoded = encode_record(command);
        let (response_sender, response_receiver) = oneshot::channel();
        self.pending
            .lock()
            .await
            .insert(id.clone(), response_sender);

        let write_result = async {
            let mut stdin = self.stdin.lock().await;
            let stdin = stdin.as_mut().ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::BrokenPipe, "Pi stdin is closed")
            })?;
            stdin.write_all(&encoded).await?;
            stdin.flush().await
        }
        .await;
        if let Err(error) = write_result {
            self.pending.lock().await.remove(&id);
            return Err(PiProcessError::Write(error));
        }

        match response_receiver.await {
            Ok(response) => Ok(response),
            Err(_) => {
                let exit = wait_for_exit(self.exit.clone())
                    .await
                    .unwrap_or(PiProcessExit {
                        code: None,
                        signal: None,
                        requested: false,
                    });
                Err(PiProcessError::Exited(exit))
            }
        }
    }

    /// Writes an extension UI response without creating a command correlation entry.
    pub(crate) async fn send_record(&self, record: Value) -> Result<(), PiProcessError> {
        let record = match record {
            Value::Object(record) if record.get("type").and_then(Value::as_str).is_some() => record,
            _ => return Err(PiProcessError::InvalidCommand),
        };
        if let Some(exit) = self.exit.borrow().clone() {
            return Err(PiProcessError::Exited(exit));
        }

        let encoded = encode_record(record);
        let mut stdin = self.stdin.lock().await;
        let stdin = stdin.as_mut().ok_or_else(|| {
            PiProcessError::Write(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "Pi stdin is closed",
            ))
        })?;
        stdin
            .write_all(&encoded)
            .await
            .map_err(PiProcessError::Write)?;
        stdin.flush().await.map_err(PiProcessError::Write)
    }

    /// Closes protocol input, then escalates through interrupt, terminate, and kill.
    pub async fn shutdown(&self) -> Result<PiProcessExit, PiProcessError> {
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
            .ok_or(PiProcessError::KillTimeout)
    }

    #[cfg(unix)]
    async fn send_signal(&self, signal: i32) -> Result<(), PiProcessError> {
        let result = unsafe { libc::kill(self.process_id as i32, signal) };
        if result == 0 {
            Ok(())
        } else {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::ESRCH) {
                Ok(())
            } else {
                Err(PiProcessError::Signal(error))
            }
        }
    }

    #[cfg(not(unix))]
    async fn send_signal(&self, _signal: i32) -> Result<(), PiProcessError> {
        let _ = self.kill.send(()).await;
        Ok(())
    }
}

fn encode_record(mut command: Map<String, Value>) -> Vec<u8> {
    let mut encoded = serde_json::to_vec(&Value::Object(std::mem::take(&mut command)))
        .expect("JSON values always serialize");
    encoded.push(b'\n');
    encoded
}

async fn read_stdout(
    stdout: ChildStdout,
    pending: PendingCommands,
    output: broadcast::Sender<PiProcessOutput>,
) {
    let mut reader = BufReader::new(stdout);
    let mut bytes = Vec::new();
    loop {
        bytes.clear();
        match reader.read_until(b'\n', &mut bytes).await {
            Ok(0) => break,
            Ok(_) => {
                trim_record_ending(&mut bytes);
                match serde_json::from_slice::<Value>(&bytes) {
                    Ok(record) => route_record(record, &pending, &output).await,
                    Err(error) => {
                        let _ = output.send(PiProcessOutput::Diagnostic(PiDiagnostic {
                            source: PiDiagnosticSource::Protocol,
                            message: format!("invalid Pi JSONL record: {error}"),
                        }));
                    }
                }
            }
            Err(error) => {
                let _ = output.send(PiProcessOutput::Diagnostic(PiDiagnostic {
                    source: PiDiagnosticSource::Process,
                    message: format!("could not read Pi stdout: {error}"),
                }));
                break;
            }
        }
    }
}

async fn route_record(
    record: Value,
    pending: &PendingCommands,
    output: &broadcast::Sender<PiProcessOutput>,
) {
    let is_response = record.get("type").and_then(Value::as_str) == Some("response");
    let id = record.get("id").and_then(Value::as_str);
    if is_response
        && let Some(id) = id
        && let Some(sender) = pending.lock().await.remove(id)
    {
        let _ = sender.send(record);
        return;
    }

    if is_response {
        let _ = output.send(PiProcessOutput::Diagnostic(PiDiagnostic {
            source: PiDiagnosticSource::Protocol,
            message: "Pi returned a response without a matching command ID".to_owned(),
        }));
    } else {
        let _ = output.send(PiProcessOutput::Event(record));
    }
}

async fn read_stderr(stderr: ChildStderr, output: broadcast::Sender<PiProcessOutput>) {
    let mut reader = BufReader::new(stderr);
    let mut bytes = Vec::new();
    loop {
        bytes.clear();
        match reader.read_until(b'\n', &mut bytes).await {
            Ok(0) => break,
            Ok(_) => {
                trim_record_ending(&mut bytes);
                let _ = output.send(PiProcessOutput::Diagnostic(PiDiagnostic {
                    source: PiDiagnosticSource::Stderr,
                    message: String::from_utf8_lossy(&bytes).into_owned(),
                }));
            }
            Err(error) => {
                let _ = output.send(PiProcessOutput::Diagnostic(PiDiagnostic {
                    source: PiDiagnosticSource::Process,
                    message: format!("could not read Pi stderr: {error}"),
                }));
                break;
            }
        }
    }
}

fn trim_record_ending(bytes: &mut Vec<u8>) {
    if bytes.last() == Some(&b'\n') {
        bytes.pop();
        if bytes.last() == Some(&b'\r') {
            bytes.pop();
        }
    }
}

async fn wait_for_exit(mut exit: watch::Receiver<Option<PiProcessExit>>) -> Option<PiProcessExit> {
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
    exit: watch::Receiver<Option<PiProcessExit>>,
    duration: Duration,
) -> Option<PiProcessExit> {
    tokio::time::timeout(duration, wait_for_exit(exit))
        .await
        .ok()
        .flatten()
}

fn missing_pipe(name: &str) -> PiProcessError {
    PiProcessError::Start(std::io::Error::other(format!(
        "Pi {name} pipe was not available"
    )))
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

fn process_exit(status: std::process::ExitStatus, requested: bool) -> PiProcessExit {
    #[cfg(unix)]
    use std::os::unix::process::ExitStatusExt;

    PiProcessExit {
        code: status.code(),
        #[cfg(unix)]
        signal: status.signal(),
        #[cfg(not(unix))]
        signal: None,
        requested,
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::TempDir;

    #[tokio::test]
    async fn frames_records_correlates_commands_and_separates_diagnostics() {
        let fixture = FakePi::new(
            r#"
read first
read second
printf 'fixture warning\n' >&2
printf '{"type":"message_'
printf 'update","delta":"one"}\r\n{"type":"agent_settled"}\n'
printf 'not-json\n'
printf '{"id":"pau-2","type":"response","command":"second","success":true}\n{"type":"extension_event","value":3}\n{"id":"pau-1","type":"response","command":"first","success":true}\n'
cat >/dev/null
"#,
        );
        let process = Arc::new(fixture.start(PiShutdownTimeouts::default()));
        let mut output = process.subscribe();

        let first_process = Arc::clone(&process);
        let first =
            tokio::spawn(async move { first_process.command(json!({"type": "first"})).await });
        let second_process = Arc::clone(&process);
        let second =
            tokio::spawn(async move { second_process.command(json!({"type": "second"})).await });

        assert_eq!(first.await.unwrap().unwrap()["command"], "first");
        assert_eq!(second.await.unwrap().unwrap()["command"], "second");

        let mut events = Vec::new();
        let mut diagnostics = Vec::new();
        while events.len() < 3 || diagnostics.len() < 2 {
            match tokio::time::timeout(Duration::from_secs(1), output.recv())
                .await
                .unwrap()
                .unwrap()
            {
                PiProcessOutput::Event(event) => events.push(event),
                PiProcessOutput::Diagnostic(diagnostic) => diagnostics.push(diagnostic),
                PiProcessOutput::Exit(exit) => panic!("Pi exited early: {exit:?}"),
            }
        }

        assert_eq!(events[0]["type"], "message_update");
        assert_eq!(events[1]["type"], "agent_settled");
        assert_eq!(events[2]["type"], "extension_event");
        assert!(diagnostics.contains(&PiDiagnostic {
            source: PiDiagnosticSource::Stderr,
            message: "fixture warning".to_owned(),
        }));
        assert!(diagnostics.iter().any(|diagnostic| {
            diagnostic.source == PiDiagnosticSource::Protocol
                && diagnostic.message.starts_with("invalid Pi JSONL record:")
        }));

        let exit = process.shutdown().await.unwrap();
        assert_eq!(exit.code, Some(0));
        assert!(exit.requested);
    }

    #[tokio::test]
    async fn reports_an_unexpected_exit_to_pending_commands() {
        let fixture = FakePi::new("read command\nexit 17\n");
        let process = fixture.start(PiShutdownTimeouts::default());

        let error = process
            .command(json!({"type": "get_state"}))
            .await
            .unwrap_err();

        match error {
            PiProcessError::Exited(exit) => {
                assert_eq!(exit.code, Some(17));
                assert!(!exit.requested);
            }
            other => panic!("expected process exit, got {other}"),
        }
    }

    #[tokio::test]
    async fn escalates_shutdown_from_interrupt_to_terminate() {
        let fixture = FakePi::new(
            r#"
trap 'printf "interrupt\n" >> "$PWD/signals"' INT
trap 'printf "terminate\n" >> "$PWD/signals"; exit 0' TERM
: > "$PWD/ready"
while :; do :; done
"#,
        );
        let signal_log = fixture.root.path().join("signals");
        let ready = fixture.root.path().join("ready");
        let process = fixture.start(PiShutdownTimeouts {
            protocol: Duration::from_millis(50),
            interrupt: Duration::from_millis(200),
            terminate: Duration::from_secs(2),
            kill: Duration::from_secs(1),
        });
        tokio::time::timeout(Duration::from_secs(1), async {
            while !ready.exists() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        let exit = process.shutdown().await.unwrap();

        assert_eq!(exit.code, Some(0));
        assert!(exit.requested);
        assert_eq!(
            fs::read_to_string(signal_log).unwrap(),
            "interrupt\nterminate\n"
        );
    }

    struct FakePi {
        root: TempDir,
        executable: PathBuf,
    }

    impl FakePi {
        fn new(body: &str) -> Self {
            let root = tempfile::tempdir().unwrap();
            let executable = root.path().join("fake pi");
            fs::write(
                &executable,
                format!(
                    "#!/bin/sh\n[ \"$1\" = '--mode' ] && [ \"$2\" = 'rpc' ] || exit 64\n{body}"
                ),
            )
            .unwrap();
            fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
            Self { root, executable }
        }

        fn start(&self, shutdown_timeouts: PiShutdownTimeouts) -> PiProcess {
            PiProcess::start(StartPiProcessOptions {
                executable_path: self.executable.clone(),
                working_directory: self.root.path().to_path_buf(),
                arguments: Vec::new(),
                environment: Vec::new(),
                shutdown_timeouts,
            })
            .unwrap()
        }
    }
}
