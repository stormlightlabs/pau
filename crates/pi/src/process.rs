use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::error::Error;
use std::ffi::OsString;
use std::fmt;
use std::future::Future;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStderr, ChildStdout, Command};
use tokio::sync::{Mutex, broadcast, mpsc, oneshot, watch};
use tokio::time::Instant;

#[cfg(unix)]
use pau_agent::signal_process_group;
use pau_agent::{ProcessGroup, lead_process_group};

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

/// How long Pau waits for Pi to answer an RPC command.
///
/// Most commands answer at once, so each gets [`Self::reply`] from the moment
/// Pau starts writing it. The commands in [`LONG_RUNNING_COMMANDS`] answer only
/// after work that can take minutes, such as a shell command or a compaction,
/// so they have no fixed limit. While one is pending, Pau waits for as long as
/// Pi keeps writing records. After [`Self::silence`] with no record, Pau sends
/// `get_state`, which Pi answers while other work runs. If that check gets no
/// answer within [`Self::reply`], the long-running command fails.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PiReplyTimeouts {
    /// Time for Pi to read a command and answer one that finishes at once.
    pub reply: Duration,
    /// Time Pi may stay silent during a long-running command before Pau checks
    /// that it still answers.
    pub silence: Duration,
}

impl Default for PiReplyTimeouts {
    fn default() -> Self {
        Self {
            reply: Duration::from_secs(30),
            silence: Duration::from_secs(30),
        }
    }
}

/// Commands that Pi answers only after work of unbounded length: `prompt`
/// after extension input handlers and any compaction before the turn, `abort`
/// after the run stops, `bash` after the shell command exits, `compact` after
/// the summary, `export_html` after rendering, and the session commands after
/// extension hooks, which can open dialogs that wait for the operator.
const LONG_RUNNING_COMMANDS: &[&str] = &[
    "prompt",
    "abort",
    "bash",
    "compact",
    "export_html",
    "new_session",
    "switch_session",
    "fork",
    "clone",
];

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
    /// Limits on waiting for Pi to answer a command.
    pub reply_timeouts: PiReplyTimeouts,
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
    /// Pi stopped answering commands, as [`PiProcessError::NotResponding`]
    /// describes. Sent when a command first fails this way, and again after
    /// [`Self::Responding`] if Pi stops answering once more.
    NotResponding,
    /// Pi wrote to stdout after [`Self::NotResponding`], so commands reach it
    /// again. Sent before the record that showed it.
    Responding,
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
    /// Pi did not read or answer a command within `limit`, as
    /// [`PiReplyTimeouts`] describes. When Pi did not read the whole command,
    /// Pau closes Pi's input, because a later record would be joined to the
    /// partial one.
    ///
    /// Pau then treats Pi as stuck: every later command and record fails at
    /// once with this same error, naming the command that first went
    /// unanswered. Only shutdown still reaches the process, until Pi writes
    /// to stdout again. Pau never recovers a Pi whose input it closed.
    NotResponding {
        /// The `type` of the command that went unanswered.
        command: String,
        /// How long Pau waited for an answer.
        limit: Duration,
        /// Whether the unanswered record was the check Pau sent during a
        /// long-running `command`, rather than `command` itself, whose own
        /// wait had no limit.
        during_check: bool,
    },
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
            Self::NotResponding {
                command,
                limit,
                during_check: false,
            } => write!(
                formatter,
                "Pi is not responding: it did not answer `{command}` within {limit:?}"
            ),
            Self::NotResponding {
                command,
                limit,
                during_check: true,
            } => write!(
                formatter,
                "Pi is not responding: it did not answer a check within {limit:?} during `{command}`"
            ),
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

/// Commands waiting for Pi's answer. Each response arrives with its stdout
/// position: its 1-based index among the JSON records Pi wrote to stdout.
type PendingCommands = Arc<Mutex<HashMap<String, oneshot::Sender<(u64, Value)>>>>;

/// The receiver of every Pi event paired with its stdout position, installed
/// by [`PiProcess::sequenced_events`].
type SequencedEvents = Arc<std::sync::OnceLock<mpsc::UnboundedSender<(u64, Value)>>>;

/// The command Pi left unanswered while Pau treats it as stuck, or `None`
/// while Pi answers.
///
/// Pau sets it and the stdout reader clears it only while holding the
/// [`PendingCommands`] lock. A record therefore either reaches its command
/// before Pau gives up, or arrives after the mark is set and clears it.
type Unanswered = Arc<std::sync::Mutex<Option<UnansweredCommand>>>;

/// The first command that went unanswered since Pi last answered.
#[derive(Clone, Debug)]
struct UnansweredCommand {
    /// The command's `type`.
    command: String,
    /// Whether the check Pau sent during `command` went unanswered.
    during_check: bool,
    /// Whether Pau closed Pi's input after a cut-off write. Commands can no
    /// longer reach Pi, so later output does not clear the mark.
    input_closed: bool,
}

/// Owns one supervised `pi --mode rpc` child process.
pub struct PiProcess {
    stdin: Mutex<Option<tokio::process::ChildStdin>>,
    pending: PendingCommands,
    output: broadcast::Sender<PiProcessOutput>,
    sequenced_events: SequencedEvents,
    exit: watch::Receiver<Option<PiProcessExit>>,
    /// Counts the lines Pi has written to stdout, so a long-running command
    /// can tell that Pi is still working.
    activity: watch::Receiver<u64>,
    kill: tokio::sync::mpsc::Sender<()>,
    next_command_id: AtomicU64,
    process_id: u32,
    shutdown_timeouts: PiShutdownTimeouts,
    reply_timeouts: PiReplyTimeouts,
    /// The command Pi left unanswered while Pau treats it as stuck.
    not_responding: Unanswered,
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
            .stderr(Stdio::piped());
        lead_process_group(&mut command);

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
        let sequenced_events = SequencedEvents::default();
        let (exit_sender, exit) = watch::channel(None);
        let (activity_sender, activity) = watch::channel(0);
        let (kill_sender, mut kill_receiver) = tokio::sync::mpsc::channel(1);
        let shutdown_requested = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let not_responding = Unanswered::default();

        tokio::spawn(read_stdout(StdoutReader {
            stdout,
            activity: activity_sender,
            pending: Arc::clone(&pending),
            output: output.clone(),
            sequenced_events: Arc::clone(&sequenced_events),
            not_responding: Arc::clone(&not_responding),
        }));
        tokio::spawn(read_stderr(stderr, output.clone()));

        let watcher_output = output.clone();
        let watcher_pending = Arc::clone(&pending);
        let watcher_shutdown = Arc::clone(&shutdown_requested);
        let mut group = ProcessGroup::new(child);
        tokio::spawn(async move {
            let status = tokio::select! {
                status = group.wait() => status,
                _ = kill_receiver.recv() => group.kill().await,
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
            sequenced_events,
            exit,
            activity,
            kill: kill_sender,
            next_command_id: AtomicU64::new(1),
            process_id,
            shutdown_timeouts: options.shutdown_timeouts,
            reply_timeouts: options.reply_timeouts,
            not_responding,
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

    /// Returns every later Pi event paired with its stdout position.
    ///
    /// Broadcast subscribers see events in order, but not in order with the
    /// responses that [`Self::command`] returns, because each side runs on its
    /// own task. Comparing these positions with the one from
    /// [`Self::command_at`] tells which of an event and a response Pi wrote
    /// first. Only the first caller gets a receiver.
    pub(crate) fn sequenced_events(&self) -> Option<mpsc::UnboundedReceiver<(u64, Value)>> {
        let (sender, receiver) = mpsc::unbounded_channel();
        self.sequenced_events.set(sender).ok().map(|()| receiver)
    }

    /// Allocates a command ID that no other command to this process uses.
    ///
    /// Pass it to [`Self::command_with_id`] when the caller must know the ID
    /// before Pi answers, such as to match the events a `bash` command streams.
    pub fn next_command_id(&self) -> String {
        format!(
            "pau-{}",
            self.next_command_id.fetch_add(1, Ordering::Relaxed)
        )
    }

    /// Sends one command and resolves it with the response bearing the same ID.
    pub async fn command(&self, command: Value) -> Result<Value, PiProcessError> {
        self.command_with_id(self.next_command_id(), command).await
    }

    /// Sends one command under an ID from [`Self::next_command_id`] and
    /// resolves it with the response bearing that ID.
    pub async fn command_with_id(
        &self,
        id: String,
        command: Value,
    ) -> Result<Value, PiProcessError> {
        let (_, response) = self.command_at(id, command).await?;
        Ok(response)
    }

    /// Sends one command like [`Self::command_with_id`] and also returns the
    /// response's stdout position for comparison with
    /// [`Self::sequenced_events`].
    ///
    /// The wait is bounded as [`PiReplyTimeouts`] describes.
    pub(crate) async fn command_at(
        &self,
        id: String,
        command: Value,
    ) -> Result<(u64, Value), PiProcessError> {
        let deadline = Instant::now() + self.reply_timeouts.reply;
        let mut activity = self.activity.clone();
        activity.borrow_and_update();
        let (command_type, mut response) = self.send_command(id.clone(), command, deadline).await?;
        let long_running = LONG_RUNNING_COMMANDS.contains(&command_type.as_str());

        loop {
            let outcome = if long_running {
                wait_while_alive(
                    &mut response,
                    &mut activity,
                    self.reply_timeouts.silence,
                    || self.answers_probe(),
                )
                .await
            } else {
                tokio::time::timeout_at(deadline, &mut response).await.ok()
            };
            return match outcome {
                Some(Ok(response)) => Ok(response),
                Some(Err(_)) => Err(self.exited().await),
                None => {
                    let mut pending = self.pending.lock().await;
                    // Pi wrote records while the check waited, so it is still
                    // working.
                    if long_running && activity.has_changed().unwrap_or(false) {
                        continue;
                    }
                    pending.remove(&id);
                    // The answer may have arrived after the wait ended.
                    if let Ok(response) = response.try_recv() {
                        return Ok(response);
                    }
                    Err(self.give_up(&command_type, long_running, false))
                }
            };
        }
    }

    /// Returns the [`PiProcessError::Exited`] error once Pi's exit is known.
    async fn exited(&self) -> PiProcessError {
        let exit = wait_for_exit(self.exit.clone())
            .await
            .unwrap_or(PiProcessExit {
                code: None,
                signal: None,
                requested: false,
            });
        PiProcessError::Exited(exit)
    }

    /// Records that Pi left `command` unanswered, announces it on the output
    /// stream unless Pau already treats Pi as stuck, and returns the error
    /// every later command gets until Pi writes again.
    ///
    /// Callers that remove a pending command hold the [`PendingCommands`]
    /// lock, as [`Unanswered`] requires.
    fn give_up(&self, command: &str, during_check: bool, input_closed: bool) -> PiProcessError {
        let mut unanswered = self
            .not_responding
            .lock()
            .expect("the unanswered command lock is never poisoned");
        match unanswered.as_mut() {
            Some(first) => first.input_closed |= input_closed,
            None => {
                *unanswered = Some(UnansweredCommand {
                    command: command.to_owned(),
                    during_check,
                    input_closed,
                });
                let _ = self.output.send(PiProcessOutput::NotResponding);
            }
        }
        drop(unanswered);
        self.not_responding()
            .expect("the unanswered command was just recorded")
    }

    /// Returns the [`PiProcessError::NotResponding`] error while Pau treats Pi
    /// as stuck.
    pub(crate) fn not_responding(&self) -> Option<PiProcessError> {
        self.not_responding
            .lock()
            .expect("the unanswered command lock is never poisoned")
            .as_ref()
            .map(|unanswered| PiProcessError::NotResponding {
                command: unanswered.command.clone(),
                limit: self.reply_timeouts.reply,
                during_check: unanswered.during_check,
            })
    }

    /// Registers `command` under `id` and writes it to Pi, returning its
    /// `type` and the receiver of its response.
    async fn send_command(
        &self,
        id: String,
        command: Value,
        deadline: Instant,
    ) -> Result<(String, oneshot::Receiver<(u64, Value)>), PiProcessError> {
        let (command_type, mut command) = record_object(command)?;
        if let Some(exit) = self.exit.borrow().clone() {
            return Err(PiProcessError::Exited(exit));
        }
        if let Some(error) = self.not_responding() {
            return Err(error);
        }

        command.insert("id".to_owned(), Value::String(id.clone()));
        let encoded = encode_record(command);
        let (response_sender, response_receiver) = oneshot::channel();
        self.pending
            .lock()
            .await
            .insert(id.clone(), response_sender);

        if let Err(error) = self.write_record(&command_type, &encoded, deadline).await {
            self.pending.lock().await.remove(&id);
            return Err(error);
        }
        Ok((command_type, response_receiver))
    }

    /// Whether Pi answers `get_state` within the reply limit, or has exited,
    /// in which case the caller's response channel closes on its own.
    ///
    /// Once shutdown starts, Pi's input is closed and it may never answer, so
    /// the check passes without asking and the caller waits for the exit.
    async fn answers_probe(&self) -> bool {
        let shutting_down = || self.shutdown_requested.load(Ordering::SeqCst);
        if shutting_down() {
            return true;
        }
        let deadline = Instant::now() + self.reply_timeouts.reply;
        let id = self.next_command_id();
        let response = match self
            .send_command(id.clone(), json!({"type": "get_state"}), deadline)
            .await
        {
            Ok((_, response)) => response,
            Err(error) => return matches!(error, PiProcessError::Exited(_)) || shutting_down(),
        };
        match tokio::time::timeout_at(deadline, response).await {
            Ok(_) => true,
            Err(_) => {
                self.pending.lock().await.remove(&id);
                shutting_down()
            }
        }
    }

    /// Writes one encoded record to Pi's stdin by `deadline`.
    ///
    /// When the deadline passes during the write, Pi may hold part of the
    /// record, so this closes Pi's input rather than let the next record be
    /// joined to it.
    async fn write_record(
        &self,
        command_type: &str,
        encoded: &[u8],
        deadline: Instant,
    ) -> Result<(), PiProcessError> {
        let mut stdin = tokio::time::timeout_at(deadline, self.stdin.lock())
            .await
            .map_err(|_| self.give_up(command_type, false, false))?;
        let pipe = stdin.as_mut().ok_or_else(|| {
            PiProcessError::Write(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "Pi stdin is closed",
            ))
        })?;
        let write = async {
            pipe.write_all(encoded).await?;
            pipe.flush().await
        };
        match tokio::time::timeout_at(deadline, write).await {
            Ok(result) => result.map_err(PiProcessError::Write),
            Err(_) => {
                stdin.take();
                Err(self.give_up(command_type, false, true))
            }
        }
    }

    /// Writes an extension UI response without creating a command correlation entry.
    pub(crate) async fn send_record(&self, record: Value) -> Result<(), PiProcessError> {
        let (record_type, record) = record_object(record)?;
        if let Some(exit) = self.exit.borrow().clone() {
            return Err(PiProcessError::Exited(exit));
        }
        if let Some(error) = self.not_responding() {
            return Err(error);
        }
        let deadline = Instant::now() + self.reply_timeouts.reply;
        self.write_record(&record_type, &encode_record(record), deadline)
            .await
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

    /// Kills Pi's whole process group now, without waiting.
    ///
    /// A [`shutdown`](Self::shutdown) in progress then returns with the
    /// killed process's exit. Does nothing once Pi has exited.
    pub fn kill(&self) {
        let _ = self.kill.try_send(());
    }

    #[cfg(unix)]
    async fn send_signal(&self, signal: i32) -> Result<(), PiProcessError> {
        signal_process_group(self.process_id, signal).map_err(PiProcessError::Signal)
    }

    #[cfg(not(unix))]
    async fn send_signal(&self, _signal: i32) -> Result<(), PiProcessError> {
        let _ = self.kill.send(()).await;
        Ok(())
    }
}

/// Waits for a long-running command's `response` while Pi shows it is alive.
///
/// Each line Pi writes, which `activity` counts, restarts the `silence`
/// clock. When the clock runs out, `probe` checks that Pi still answers.
/// Returns `None` when the check fails. Lines Pi writes while the check waits
/// stay unseen in `activity`.
async fn wait_while_alive<P, F>(
    response: &mut oneshot::Receiver<(u64, Value)>,
    activity: &mut watch::Receiver<u64>,
    silence: Duration,
    mut probe: P,
) -> Option<Result<(u64, Value), oneshot::error::RecvError>>
where
    P: FnMut() -> F,
    F: Future<Output = bool>,
{
    // Stdout closes before Pi exits; after that only the probe shows whether
    // Pi still runs.
    let mut stdout_open = true;
    loop {
        tokio::select! {
            result = &mut *response => return Some(result),
            changed = activity.changed(), if stdout_open => {
                stdout_open = changed.is_ok();
            }
            () = tokio::time::sleep(silence) => {
                if !probe().await {
                    return None;
                }
            }
        }
    }
}

/// Returns a record's `type` and fields, or an error unless it is a JSON
/// object with a string `type`.
fn record_object(record: Value) -> Result<(String, Map<String, Value>), PiProcessError> {
    match record {
        Value::Object(record) => match record.get("type").and_then(Value::as_str) {
            Some(record_type) => Ok((record_type.to_owned(), record)),
            None => Err(PiProcessError::InvalidCommand),
        },
        _ => Err(PiProcessError::InvalidCommand),
    }
}

fn encode_record(mut command: Map<String, Value>) -> Vec<u8> {
    let mut encoded = serde_json::to_vec(&Value::Object(std::mem::take(&mut command)))
        .expect("JSON values always serialize");
    encoded.push(b'\n');
    encoded
}

/// What the stdout reader task shares with [`PiProcess`].
struct StdoutReader {
    stdout: ChildStdout,
    activity: watch::Sender<u64>,
    pending: PendingCommands,
    output: broadcast::Sender<PiProcessOutput>,
    sequenced_events: SequencedEvents,
    not_responding: Unanswered,
}

/// Reads Pi's stdout records and routes each one. Any line shows that Pi
/// runs again, so it first clears a not-responding mark, as [`Unanswered`]
/// describes.
async fn read_stdout(reader: StdoutReader) {
    let StdoutReader {
        stdout,
        activity,
        pending,
        output,
        sequenced_events,
        not_responding,
    } = reader;
    let mut reader = BufReader::new(stdout);
    let mut bytes = Vec::new();
    let mut position = 0;
    loop {
        bytes.clear();
        match reader.read_until(b'\n', &mut bytes).await {
            Ok(0) => break,
            Ok(_) => {
                activity.send_modify(|lines| *lines += 1);
                trim_record_ending(&mut bytes);
                let mut pending = pending.lock().await;
                {
                    let mut unanswered = not_responding
                        .lock()
                        .expect("the unanswered command lock is never poisoned");
                    if unanswered.as_ref().is_some_and(|first| !first.input_closed) {
                        *unanswered = None;
                        let _ = output.send(PiProcessOutput::Responding);
                    }
                }
                match serde_json::from_slice::<Value>(&bytes) {
                    Ok(record) => {
                        position += 1;
                        route_record(record, position, &mut pending, &output, &sequenced_events);
                    }
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

fn route_record(
    record: Value,
    position: u64,
    pending: &mut HashMap<String, oneshot::Sender<(u64, Value)>>,
    output: &broadcast::Sender<PiProcessOutput>,
    sequenced_events: &SequencedEvents,
) {
    let is_response = record.get("type").and_then(Value::as_str) == Some("response");
    let id = record.get("id").and_then(Value::as_str);
    if is_response
        && let Some(id) = id
        && let Some(sender) = pending.remove(id)
    {
        let _ = sender.send((position, record));
        return;
    }

    if is_response {
        let _ = output.send(PiProcessOutput::Diagnostic(PiDiagnostic {
            source: PiDiagnosticSource::Protocol,
            message: "Pi returned a response without a matching command ID".to_owned(),
        }));
    } else {
        if let Some(events) = sequenced_events.get() {
            let _ = events.send((position, record.clone()));
        }
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
                other => panic!("unexpected output: {other:?}"),
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

    /// A fake Pi that reads every command and answers none. A shell loop
    /// keeps Pi's stdout open, where `exec cat` would close it.
    const SILENT_PI: &str = "while read -r line; do :; done\n";

    // These tests resume the clock before shutting Pi down. A paused clock
    // would run through every shutdown stage before the reaper sees Pi exit.
    #[tokio::test(start_paused = true)]
    async fn fails_a_command_that_pi_reads_but_never_answers() {
        let fixture = FakePi::new(SILENT_PI);
        let process = fixture.start(PiShutdownTimeouts::default());
        let mut output = process.subscribe();
        let started = Instant::now();

        let error = process
            .command(json!({"type": "get_state"}))
            .await
            .unwrap_err();

        assert_eq!(started.elapsed(), Duration::from_secs(30));
        let message = "Pi is not responding: it did not answer `get_state` within 30s";
        assert_eq!(error.to_string(), message);
        assert!(process.pending.lock().await.is_empty());
        assert_eq!(output.recv().await.unwrap(), PiProcessOutput::NotResponding);

        // Pau has given up on this Pi, so later commands and records fail at
        // once with the first error and announce nothing new.
        let later = Instant::now();
        let command = process.command(json!({"type": "prompt"})).await;
        let record = process.send_record(json!({"type": "extension_ui_response"}));
        assert_eq!(command.unwrap_err().to_string(), message);
        assert_eq!(record.await.unwrap_err().to_string(), message);
        assert_eq!(later.elapsed(), Duration::ZERO);
        assert!(output.try_recv().is_err());

        tokio::time::resume();
        assert!(process.shutdown().await.unwrap().requested);
    }

    #[tokio::test(start_paused = true)]
    async fn fails_a_long_running_command_once_pi_stops_answering_checks() {
        let fixture = FakePi::new(SILENT_PI);
        let process = fixture.start(PiShutdownTimeouts::default());
        let started = Instant::now();

        let error = process
            .command(json!({"type": "bash", "command": "make"}))
            .await
            .unwrap_err();

        // 30 seconds of silence, then 30 for the unanswered check. The paused
        // clock can also move while the command is written, which the write's
        // own 30-second limit bounds.
        let elapsed = started.elapsed();
        assert!(
            (Duration::from_secs(60)..=Duration::from_secs(90)).contains(&elapsed),
            "waited {elapsed:?}"
        );
        assert_eq!(
            error.to_string(),
            "Pi is not responding: it did not answer a check within 30s during `bash`"
        );
        // `bash` took the first ID and the check the second.
        assert_eq!(process.next_command_id(), "pau-3");
        assert!(process.pending.lock().await.is_empty());

        tokio::time::resume();
        assert!(process.shutdown().await.unwrap().requested);
    }

    /// Answers `id` while holding the pending lock, as the stdout reader
    /// does when it routes a response.
    fn answer(pending: &mut HashMap<String, oneshot::Sender<(u64, Value)>>, id: &str) {
        let sender = pending.remove(id).expect("the command is still pending");
        sender
            .send((1, json!({"id": id, "type": "response", "success": true})))
            .unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_an_answer_that_arrives_as_the_deadline_passes() {
        let fixture = FakePi::new(SILENT_PI);
        let process = Arc::new(fixture.start(PiShutdownTimeouts::default()));
        let waiting = Arc::clone(&process);
        let command =
            tokio::spawn(async move { waiting.command(json!({"type": "get_state"})).await });

        // Hold the lock across the deadline, so the answer reaches the
        // command after its wait has ended.
        tokio::time::sleep(Duration::from_secs(29)).await;
        let mut pending = process.pending.lock().await;
        tokio::time::sleep(Duration::from_secs(2)).await;
        answer(&mut pending, "pau-1");
        drop(pending);

        assert_eq!(command.await.unwrap().unwrap()["id"], "pau-1");
        assert!(process.not_responding().is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_an_answer_that_arrives_as_a_check_fails() {
        let fixture = FakePi::new(SILENT_PI);
        let process = Arc::new(fixture.start(PiShutdownTimeouts::default()));
        let waiting = Arc::clone(&process);
        let command = tokio::spawn(async move {
            waiting
                .command(json!({"type": "bash", "command": "make"}))
                .await
        });

        // Wait for the check, then hold the lock until it has failed.
        while !process.pending.lock().await.contains_key("pau-2") {
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        let pending = process.pending.lock().await;
        tokio::time::sleep(Duration::from_secs(31)).await;
        drop(pending);
        // The mutex is fair: the failed check takes the lock next, then this
        // task, which answers `bash` before the command can give up on it.
        let mut pending = process.pending.lock().await;
        assert!(!pending.contains_key("pau-2"));
        answer(&mut pending, "pau-1");
        drop(pending);

        assert_eq!(command.await.unwrap().unwrap()["id"], "pau-1");
        assert!(process.not_responding().is_none());
    }

    /// Stop closes Pi's input during a silent `bash`, so a check written
    /// afterwards would fail. The command must end with Pi's exit instead.
    #[tokio::test(start_paused = true)]
    async fn waits_for_the_exit_when_stopped_during_a_silent_command() {
        let fixture = FakePi::new("while read -r line; do :; done\nexec sleep 1000\n");
        let process = Arc::new(fixture.start(PiShutdownTimeouts {
            protocol: Duration::from_secs(45),
            ..PiShutdownTimeouts::default()
        }));
        let mut output = process.subscribe();
        let running = Arc::clone(&process);
        let command = tokio::spawn(async move {
            running
                .command(json!({"type": "bash", "command": "make"}))
                .await
        });

        tokio::time::sleep(Duration::from_secs(1)).await;
        let stopping = Arc::clone(&process);
        tokio::spawn(async move { stopping.shutdown().await });

        let error = command.await.unwrap().unwrap_err();
        assert!(
            matches!(
                error,
                PiProcessError::Exited(PiProcessExit {
                    requested: true,
                    ..
                })
            ),
            "{error}"
        );
        assert!(process.not_responding().is_none());
        while let Ok(record) = output.try_recv() {
            assert_ne!(record, PiProcessOutput::NotResponding);
        }
    }

    /// Pi goes quiet past the reply limit, then writes its late answer and
    /// answers every later command.
    #[tokio::test]
    async fn answers_again_once_a_quiet_pi_writes() {
        let fixture = FakePi::new(
            r#"read -r line
while [ ! -e answer ]; do sleep 0.05; done
printf '{"id":"pau-1","type":"response","command":"get_state","success":true}\n'
while read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
  printf '{"id":"%s","type":"response","command":"get_state","success":true}\n' "$id"
done
"#,
        );
        let process = fixture.start(PiShutdownTimeouts::default());
        let mut output = process.subscribe();

        tokio::time::pause();
        let error = process.command(json!({"type": "get_state"})).await;
        tokio::time::resume();
        assert!(matches!(error, Err(PiProcessError::NotResponding { .. })));
        assert_eq!(output.recv().await.unwrap(), PiProcessOutput::NotResponding);

        fs::write(fixture.root.path().join("answer"), "").unwrap();
        let recovered = tokio::time::timeout(Duration::from_secs(5), output.recv()).await;
        assert_eq!(recovered.unwrap().unwrap(), PiProcessOutput::Responding);
        assert!(process.not_responding().is_none());
        let response = process.command(json!({"type": "get_state"})).await;
        assert_eq!(response.unwrap()["id"], "pau-2");
        process.shutdown().await.unwrap();
    }

    /// Streams events for well past the silence limit while ignoring every
    /// `get_state` check, then answers `prompt`. The records it writes must
    /// keep the command alive; without them the first check fails it.
    #[tokio::test]
    async fn keeps_a_command_alive_while_pi_writes_events() {
        let fixture = FakePi::new(
            r#"read -r command
i=0
while [ "$i" -lt 30 ]; do
  printf '{"type":"message_update"}\n'
  sleep 0.1
  i=$((i + 1))
done
printf '{"id":"pau-1","type":"response","command":"prompt","success":true}\n'
cat >/dev/null
"#,
        );
        // Without the events, the command would fail after the silence and
        // the check's wait, two seconds, well before Pi answers at three.
        let silence = Duration::from_secs(1);
        let process = fixture.start_with(
            PiShutdownTimeouts::default(),
            PiReplyTimeouts {
                reply: silence,
                silence,
            },
        );
        let started = Instant::now();

        let response = process
            .command(json!({"type": "prompt", "message": "hi"}))
            .await
            .unwrap();

        assert_eq!(response["command"], "prompt");
        assert!(
            started.elapsed() > silence * 2,
            "Pi streamed for too short a time"
        );
        assert!(process.not_responding().is_none());
        process.shutdown().await.unwrap();
    }

    /// Runs [`wait_while_alive`] against an in-memory Pi whose `script` gets
    /// the activity and response senders, and counts the liveness checks.
    async fn wait_with<S, F>(
        check_answers: bool,
        script: S,
    ) -> (
        Option<Result<(u64, Value), oneshot::error::RecvError>>,
        usize,
    )
    where
        S: FnOnce(watch::Sender<u64>, oneshot::Sender<(u64, Value)>) -> F,
        F: Future<Output = ()> + Send + 'static,
    {
        let (activity_sender, mut activity) = watch::channel(0);
        let (response_sender, mut response) = oneshot::channel();
        tokio::spawn(script(activity_sender, response_sender));
        let checks = std::sync::atomic::AtomicUsize::new(0);
        let outcome = wait_while_alive(
            &mut response,
            &mut activity,
            Duration::from_secs(30),
            || {
                checks.fetch_add(1, Ordering::SeqCst);
                async move {
                    if !check_answers {
                        tokio::time::sleep(Duration::from_secs(30)).await;
                    }
                    check_answers
                }
            },
        )
        .await;
        (outcome, checks.into_inner())
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_waiting_while_pi_streams_events() {
        let (outcome, checks) = wait_with(false, |activity, response| async move {
            for _ in 0..60 {
                tokio::time::sleep(Duration::from_secs(10)).await;
                activity.send_modify(|lines| *lines += 1);
            }
            let _ = response.send((61, json!({"type": "response"})));
        })
        .await;

        assert!(matches!(outcome, Some(Ok((61, _)))));
        assert_eq!(checks, 0);
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_waiting_while_a_silent_pi_answers_checks() {
        let (outcome, checks) = wait_with(true, |_activity, response| async move {
            tokio::time::sleep(Duration::from_secs(310)).await;
            let _ = response.send((1, json!({"type": "response"})));
        })
        .await;

        assert!(matches!(outcome, Some(Ok((1, _)))));
        assert_eq!(checks, 10);
    }

    #[tokio::test(start_paused = true)]
    async fn stops_waiting_when_events_stop_and_pi_does_not_answer() {
        let started = Instant::now();
        let (outcome, checks) = wait_with(false, |activity, response| async move {
            for _ in 0..12 {
                tokio::time::sleep(Duration::from_secs(10)).await;
                activity.send_modify(|lines| *lines += 1);
            }
            // Pi hangs: it keeps the command open but writes nothing more.
            std::future::pending::<()>().await;
            drop(response);
        })
        .await;

        assert!(outcome.is_none());
        assert_eq!(checks, 1);
        assert_eq!(started.elapsed(), Duration::from_secs(120 + 30 + 30));
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
        // The limit only stops a hung start. Under a full parallel test run the
        // shell can take more than a second to write `ready`. The poll sleeps
        // so that it does not hold a core the shell needs to start.
        tokio::time::timeout(Duration::from_secs(5), async {
            while !ready.exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
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

    /// Pi exits just as the protocol stage runs out, so the interrupt reaches
    /// a group whose only member is Pi's unreaped leader. macOS refuses that
    /// signal with `EPERM`. The leader becomes a zombie before shutdown
    /// starts, and the paused clock ends the zero-length protocol stage
    /// before the reaper task runs.
    #[tokio::test(start_paused = true)]
    async fn shutdown_succeeds_when_pi_exits_as_the_protocol_stage_ends() {
        let fixture = FakePi::new("exit 3\n");
        let process = fixture.start(PiShutdownTimeouts {
            protocol: Duration::ZERO,
            ..PiShutdownTimeouts::default()
        });
        // Block the runtime thread, so that the reaper cannot run first.
        let started = std::time::Instant::now();
        while !pau_agent::group_leader_exited(process.process_id()) {
            assert!(
                started.elapsed() < Duration::from_secs(5),
                "Pi did not exit"
            );
            std::thread::sleep(Duration::from_millis(5));
        }

        let exit = process.shutdown().await.unwrap();

        assert_eq!(exit.code, Some(3));
        assert!(exit.requested);
    }

    #[tokio::test]
    async fn shutdown_stops_the_processes_pi_started() {
        let fixture =
            FakePi::new("sleep 600 &\necho $! > \"$PWD/grandchild\"\ntrap '' INT TERM\nwait\n");
        let grandchild_path = fixture.root.path().join("grandchild");
        let process = fixture.start(PiShutdownTimeouts {
            protocol: Duration::from_millis(50),
            interrupt: Duration::from_millis(50),
            terminate: Duration::from_millis(50),
            kill: Duration::from_secs(2),
        });
        let grandchild: i32 = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if let Ok(text) = fs::read_to_string(&grandchild_path)
                    && let Ok(pid) = text.trim().parse()
                {
                    return pid;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();

        process.shutdown().await.unwrap();

        tokio::time::timeout(Duration::from_secs(2), async {
            // SAFETY: signal 0 only checks that the process exists.
            while unsafe { libc::kill(grandchild, 0) } == 0 {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("the process Pi started is still running");
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
            self.start_with(shutdown_timeouts, PiReplyTimeouts::default())
        }

        fn start_with(
            &self,
            shutdown_timeouts: PiShutdownTimeouts,
            reply_timeouts: PiReplyTimeouts,
        ) -> PiProcess {
            PiProcess::start(StartPiProcessOptions {
                executable_path: self.executable.clone(),
                working_directory: self.root.path().to_path_buf(),
                arguments: Vec::new(),
                environment: Vec::new(),
                shutdown_timeouts,
                reply_timeouts,
            })
            .unwrap()
        }
    }
}
