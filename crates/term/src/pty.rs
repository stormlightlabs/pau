//! PTY-backed terminal sessions.
//!
//! `portable-pty` reads, writes, and waits with blocking calls. Each terminal
//! therefore runs three dedicated OS threads: one reads output, one writes
//! input, and one waits for the child. Tokio code talks to them only through
//! bounded channels, so no blocking call runs on a runtime worker.

use std::{
    error::Error,
    fmt,
    io::{self, Read, Write},
    path::PathBuf,
    sync::Mutex,
    thread,
    time::Duration,
};

use pau_core::terminal::{TerminalSignal, TerminalSize, TerminalStatus};
use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use tokio::sync::{mpsc, watch};

/// Largest chunk the reader thread forwards at once.
const READ_CHUNK_BYTES: usize = 8 * 1024;
/// Output chunks buffered between the reader thread and the consumer.
///
/// With [`READ_CHUNK_BYTES`] this caps buffered output at 512 KiB per
/// terminal. A full buffer stops the reader, the kernel PTY buffer then fills,
/// and the child blocks on its next write instead of growing server memory.
const OUTPUT_CHANNEL_CHUNKS: usize = 64;
/// Input writes buffered before [`Terminal::write`] waits for the child.
const INPUT_CHANNEL_WRITES: usize = 64;

/// Program, arguments, directory, and size used to start a terminal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalCommand {
    /// Executable to run on the PTY.
    pub program: String,
    /// Arguments after the program name.
    pub args: Vec<String>,
    /// Working directory of the child.
    pub cwd: PathBuf,
    /// Initial dimensions.
    pub size: TerminalSize,
}

impl TerminalCommand {
    /// Runs the user's `$SHELL`, or `/bin/sh` when it is unset, in `cwd`.
    ///
    /// The shell starts without login arguments. It is interactive because its
    /// standard input is a terminal.
    pub fn shell(cwd: impl Into<PathBuf>, size: TerminalSize) -> Self {
        Self {
            program: std::env::var("SHELL")
                .ok()
                .filter(|shell| !shell.is_empty())
                .unwrap_or_else(|| "/bin/sh".to_owned()),
            args: Vec::new(),
            cwd: cwd.into(),
            size,
        }
    }
}

/// Errors returned by terminal operations.
#[derive(Debug)]
pub enum TerminalError {
    /// A dimension was zero.
    InvalidSize,
    /// The PTY could not be opened or the program could not start.
    Spawn(String),
    /// A PTY or signal system call failed.
    Io(io::Error),
    /// The terminal no longer accepts input because its writer stopped.
    Closed,
}

impl fmt::Display for TerminalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidSize => formatter.write_str("terminal rows and columns must be positive"),
            Self::Spawn(message) => write!(formatter, "could not start terminal: {message}"),
            Self::Io(error) => write!(formatter, "terminal operation failed: {error}"),
            Self::Closed => formatter.write_str("terminal input is closed"),
        }
    }
}

impl Error for TerminalError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<io::Error> for TerminalError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// Output bytes from a terminal, in the order the child wrote them.
///
/// The stream ends when no process holds the PTY open any longer. A
/// background descendant that keeps the terminal open can therefore extend
/// output past the shell's exit. Dropping this value discards later output and
/// stops the reader thread.
#[derive(Debug)]
pub struct TerminalOutput(mpsc::Receiver<Vec<u8>>);

impl TerminalOutput {
    /// Receives the next output chunk, or `None` at end of output.
    pub async fn recv(&mut self) -> Option<Vec<u8>> {
        self.0.recv().await
    }
}

/// Cloneable handle that observes a terminal's exit without owning the PTY.
#[derive(Debug, Clone)]
pub struct TerminalExit(watch::Receiver<TerminalStatus>);

impl TerminalExit {
    /// Returns the current status without waiting.
    pub fn status(&self) -> TerminalStatus {
        self.0.borrow().clone()
    }

    /// Waits until the child exits and returns its final status.
    pub async fn wait(&mut self) -> TerminalStatus {
        // The waiter thread sends exactly once and keeps no sender afterwards,
        // so an error here means the final status is already stored.
        let _ = self
            .0
            .wait_for(|status| matches!(status, TerminalStatus::Exited { .. }))
            .await;
        self.status()
    }
}

/// A child process running on a PTY owned by Pau.
///
/// Dropping a terminal whose child still runs sends `SIGKILL` to the child's
/// process group and the terminal's foreground process group. Prefer
/// [`Terminal::close`], which gives the child a chance to exit first.
pub struct Terminal {
    master: Mutex<Box<dyn MasterPty + Send>>,
    input: mpsc::Sender<Vec<u8>>,
    /// The child is a session leader, so this is also its process group ID.
    process_id: u32,
    size: Mutex<TerminalSize>,
    exit: TerminalExit,
}

impl fmt::Debug for Terminal {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Terminal")
            .field("process_id", &self.process_id)
            .field("size", &self.size())
            .field("status", &self.status())
            .finish_non_exhaustive()
    }
}

impl Terminal {
    /// Opens a PTY, starts `command` on it, and returns the terminal and its
    /// output stream.
    ///
    /// The child inherits the backend environment with `TERM` set to
    /// `xterm-256color`.
    pub fn spawn(command: TerminalCommand) -> Result<(Self, TerminalOutput), TerminalError> {
        let size = pty_size(command.size)?;
        let pair = NativePtySystem::default()
            .openpty(size)
            .map_err(|error| TerminalError::Spawn(error.to_string()))?;
        let mut builder = CommandBuilder::new(&command.program);
        builder.args(&command.args);
        builder.cwd(&command.cwd);
        builder.env("TERM", "xterm-256color");
        let mut child = pair
            .slave
            .spawn_command(builder)
            .map_err(|error| TerminalError::Spawn(error.to_string()))?;
        // The parent must not hold the slave open, or output never reaches
        // end of file after the child exits.
        drop(pair.slave);
        let process_id = child
            .process_id()
            .ok_or_else(|| TerminalError::Spawn("child has no process ID".to_owned()))?;

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| TerminalError::Spawn(error.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| TerminalError::Spawn(error.to_string()))?;

        let (output_sender, output_receiver) = mpsc::channel(OUTPUT_CHANNEL_CHUNKS);
        let (input_sender, input_receiver) = mpsc::channel(INPUT_CHANNEL_WRITES);
        let (status_sender, status_receiver) = watch::channel(TerminalStatus::Running);

        spawn_thread("pau-term-reader", move || {
            read_output(reader, output_sender)
        })?;
        spawn_thread("pau-term-writer", move || {
            write_input(writer, input_receiver)
        })?;
        spawn_thread("pau-term-waiter", move || {
            let status = match child.wait() {
                Ok(status) => TerminalStatus::Exited {
                    exit_code: status.exit_code(),
                    signal: status.signal().map(str::to_owned),
                },
                // A failed wait means the child can no longer be observed.
                Err(_) => TerminalStatus::Exited {
                    exit_code: 1,
                    signal: None,
                },
            };
            let _ = status_sender.send(status);
        })?;

        Ok((
            Self {
                master: Mutex::new(pair.master),
                input: input_sender,
                process_id,
                size: Mutex::new(command.size),
                exit: TerminalExit(status_receiver),
            },
            TerminalOutput(output_receiver),
        ))
    }

    /// Returns the child's operating-system process ID.
    pub fn process_id(&self) -> u32 {
        self.process_id
    }

    /// Returns the most recently applied dimensions.
    pub fn size(&self) -> TerminalSize {
        *self.size.lock().expect("terminal size lock poisoned")
    }

    /// Returns the current status without waiting.
    pub fn status(&self) -> TerminalStatus {
        self.exit.status()
    }

    /// Returns a handle that can wait for exit after the terminal moves.
    pub fn exit(&self) -> TerminalExit {
        self.exit.clone()
    }

    /// Queues raw input bytes for the child.
    ///
    /// Waits when the input buffer is full and fails with
    /// [`TerminalError::Closed`] once the PTY stops accepting writes.
    pub async fn write(&self, bytes: impl Into<Vec<u8>>) -> Result<(), TerminalError> {
        let bytes = bytes.into();
        if bytes.is_empty() {
            return Ok(());
        }
        self.input
            .send(bytes)
            .await
            .map_err(|_| TerminalError::Closed)
    }

    /// Applies new dimensions. The kernel sends `SIGWINCH` to the foreground
    /// process group.
    pub fn resize(&self, size: TerminalSize) -> Result<(), TerminalError> {
        let pty_size = pty_size(size)?;
        // Hold the size lock across the call so concurrent resizes leave the
        // recorded size equal to the size the PTY last received.
        let mut current = self.size.lock().expect("terminal size lock poisoned");
        self.master
            .lock()
            .expect("terminal master lock poisoned")
            .resize(pty_size)
            .map_err(|error| TerminalError::Io(io::Error::other(error.to_string())))?;
        *current = size;
        Ok(())
    }

    /// Sends `signal` to the terminal's foreground process group, as a
    /// keyboard-generated signal would be delivered.
    ///
    /// Does nothing once the child has exited, so a reused process ID cannot
    /// receive the signal.
    pub fn signal(&self, signal: TerminalSignal) -> Result<(), TerminalError> {
        if !self.is_running() {
            return Ok(());
        }
        let group = self.foreground_group().unwrap_or(self.process_id as i32);
        kill_group(group, signal_number(signal))
    }

    /// Stops the child and waits for it to exit.
    ///
    /// Sends `SIGHUP` and `SIGCONT` to the shell's process group and the
    /// foreground process group, as a closed terminal window would. If the
    /// child has not exited after `grace`, sends `SIGKILL` to both groups.
    pub async fn close(&self, grace: Duration) -> TerminalStatus {
        if !self.is_running() {
            return self.status();
        }
        self.signal_session(libc::SIGHUP);
        self.signal_session(libc::SIGCONT);
        let mut exit = self.exit();
        if let Ok(status) = tokio::time::timeout(grace, exit.wait()).await {
            return status;
        }
        self.signal_session(libc::SIGKILL);
        exit.wait().await
    }

    fn is_running(&self) -> bool {
        matches!(self.status(), TerminalStatus::Running)
    }

    fn foreground_group(&self) -> Option<i32> {
        self.master
            .lock()
            .expect("terminal master lock poisoned")
            .process_group_leader()
            .filter(|group| *group > 0)
    }

    /// Signals the shell's group and the foreground group, ignoring groups
    /// that have already gone.
    fn signal_session(&self, signal: i32) {
        let shell = self.process_id as i32;
        let _ = kill_group(shell, signal);
        if let Some(foreground) = self.foreground_group().filter(|group| *group != shell) {
            let _ = kill_group(foreground, signal);
        }
    }
}

impl Drop for Terminal {
    fn drop(&mut self) {
        if self.is_running() {
            self.signal_session(libc::SIGKILL);
        }
    }
}

fn pty_size(size: TerminalSize) -> Result<PtySize, TerminalError> {
    if size.cols == 0 || size.rows == 0 {
        return Err(TerminalError::InvalidSize);
    }
    Ok(PtySize {
        rows: size.rows,
        cols: size.cols,
        pixel_width: 0,
        pixel_height: 0,
    })
}

fn spawn_thread(name: &str, body: impl FnOnce() + Send + 'static) -> Result<(), TerminalError> {
    thread::Builder::new()
        .name(name.to_owned())
        .spawn(body)
        .map(drop)
        .map_err(|error| TerminalError::Spawn(error.to_string()))
}

/// Forwards PTY output until end of file, a read error, or a dropped consumer.
///
/// Linux reports `EIO` instead of end of file when the last slave closes, so
/// every read error ends the stream.
fn read_output(mut reader: Box<dyn Read + Send>, output: mpsc::Sender<Vec<u8>>) {
    let mut buffer = vec![0_u8; READ_CHUNK_BYTES];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => return,
            Ok(count) => {
                if output.blocking_send(buffer[..count].to_vec()).is_err() {
                    return;
                }
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(_) => return,
        }
    }
}

/// Writes queued input until the terminal is dropped or a write fails.
fn write_input(mut writer: Box<dyn Write + Send>, mut input: mpsc::Receiver<Vec<u8>>) {
    while let Some(bytes) = input.blocking_recv() {
        if writer
            .write_all(&bytes)
            .and_then(|()| writer.flush())
            .is_err()
        {
            return;
        }
    }
}

fn signal_number(signal: TerminalSignal) -> i32 {
    match signal {
        TerminalSignal::Interrupt => libc::SIGINT,
        TerminalSignal::Quit => libc::SIGQUIT,
        TerminalSignal::Suspend => libc::SIGTSTP,
        TerminalSignal::Continue => libc::SIGCONT,
        TerminalSignal::Hangup => libc::SIGHUP,
        TerminalSignal::Terminate => libc::SIGTERM,
        TerminalSignal::Kill => libc::SIGKILL,
    }
}

fn kill_group(group: i32, signal: i32) -> Result<(), TerminalError> {
    // A group of 0 means the caller's own group and 1 contains init.
    if group <= 1 {
        return Err(TerminalError::Io(io::Error::from(
            io::ErrorKind::InvalidInput,
        )));
    }
    // SAFETY: `killpg` has no memory-safety requirements.
    let result = unsafe { libc::killpg(group, signal) };
    if result == 0 {
        return Ok(());
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        return Ok(());
    }
    Err(TerminalError::Io(error))
}
