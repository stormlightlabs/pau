//! The `pau-term` relay that a sandboxed terminal runs inside the sandbox on
//! Linux.
//!
//! sandbox-runtime starts Bubblewrap with `--new-session`, which detaches the
//! sandboxed command from Pau's PTY. A shell started directly on that PTY has
//! no job control, misses terminal interrupts and resizes, and could inject
//! keystrokes into the operator's PTY with `TIOCSTI`. The relay instead opens
//! its own PTY inside the sandbox, runs the shell on it, and copies bytes
//! between the two. The shell never receives a descriptor for Pau's PTY, so
//! anything it injects reaches only the inner PTY.
//!
//! Pau's PTY runs in raw mode, and every byte Pau writes to it is part of a
//! [`RelayFrame`]: input, a window size, a signal, or a hangup. Window sizes
//! and signals travel in this channel because a relay in its own session
//! receives neither `SIGWINCH` nor keyboard signals from Pau's PTY. Output
//! flows back unframed.
//!
//! When the shell exits, or when Pau hangs up, the relay stops every process
//! left in the shell's session before it exits with the shell's exit code.

use std::{
    ffi::{OsStr, OsString},
    io::{self, Read, Write},
    mem::MaybeUninit,
    sync::{Arc, Mutex, mpsc},
    thread,
    time::Duration,
};

use pau_core::terminal::{TerminalSignal, TerminalSize};
use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};

use crate::session::{session_processes, signal_session};

/// First argument that makes an executable run as the relay. The remaining
/// arguments are the shell program and its arguments.
///
/// The desktop app and `pau-server` both accept it through
/// [`run_if_requested`], so a sandboxed terminal can start the running
/// executable as its relay without shipping another binary.
pub const RELAY_ARGUMENT: &str = "--pau-term-relay";

/// Largest payload one frame carries.
const MAX_PAYLOAD: usize = u16::MAX as usize;
/// Frame header: a tag byte and a big-endian payload length.
const HEADER: usize = 3;

const TAG_INPUT: u8 = 1;
const TAG_RESIZE: u8 = 2;
const TAG_SIGNAL: u8 = 3;
const TAG_HANGUP: u8 = 4;

/// Time processes get to exit after `SIGHUP` before `SIGKILL`.
const HANGUP_GRACE: Duration = Duration::from_secs(2);
/// Time the relay keeps copying output after the shell's session is gone.
const DRAIN_LIMIT: Duration = Duration::from_secs(2);
/// Largest chunk copied at once in either direction.
const CHUNK_BYTES: usize = 8 * 1024;

/// One message from Pau to the relay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RelayFrame {
    /// Bytes for the inner PTY, at most [`MAX_PAYLOAD`] long.
    Input(Vec<u8>),
    /// New dimensions for the inner PTY.
    Resize(TerminalSize),
    /// A signal for the inner PTY's foreground process group.
    Signal(TerminalSignal),
    /// Pau closed the terminal. The relay stops the shell's session.
    Hangup,
}

impl RelayFrame {
    /// Appends the encoded frame to `out`.
    pub(crate) fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Self::Input(bytes) => push_frame(out, TAG_INPUT, bytes),
            Self::Resize(size) => {
                let [c0, c1] = size.cols.to_be_bytes();
                let [r0, r1] = size.rows.to_be_bytes();
                push_frame(out, TAG_RESIZE, &[c0, c1, r0, r1]);
            }
            Self::Signal(signal) => push_frame(out, TAG_SIGNAL, &[signal_code(*signal)]),
            Self::Hangup => push_frame(out, TAG_HANGUP, &[]),
        }
    }
}

fn push_frame(out: &mut Vec<u8>, tag: u8, payload: &[u8]) {
    debug_assert!(payload.len() <= MAX_PAYLOAD);
    out.push(tag);
    out.extend_from_slice(&(payload.len() as u16).to_be_bytes());
    out.extend_from_slice(payload);
}

/// Encodes input bytes as as many input frames as their length needs.
pub(crate) fn encode_input(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len() + HEADER * bytes.len().div_ceil(MAX_PAYLOAD));
    for chunk in bytes.chunks(MAX_PAYLOAD) {
        push_frame(&mut out, TAG_INPUT, chunk);
    }
    out
}

/// Encodes one control frame.
pub(crate) fn encode(frame: &RelayFrame) -> Vec<u8> {
    let mut out = Vec::new();
    frame.encode(&mut out);
    out
}

/// Splits a byte stream into frames, whatever the read boundaries.
///
/// A frame with an unknown tag, or a resize or signal frame with a malformed
/// payload, is skipped, so a newer Pau can add frames an older relay ignores.
#[derive(Debug, Default)]
pub(crate) struct RelayDecoder {
    pending: Vec<u8>,
}

impl RelayDecoder {
    /// Adds `bytes` and appends each frame they complete to `frames`.
    pub(crate) fn push(&mut self, bytes: &[u8], frames: &mut Vec<RelayFrame>) {
        self.pending.extend_from_slice(bytes);
        let mut start = 0;
        while let Some(header) = self.pending.get(start..start + HEADER) {
            let length = usize::from(u16::from_be_bytes([header[1], header[2]]));
            let tag = header[0];
            let Some(payload) = self.pending.get(start + HEADER..start + HEADER + length) else {
                break;
            };
            if let Some(frame) = decode(tag, payload) {
                frames.push(frame);
            }
            start += HEADER + length;
        }
        self.pending.drain(..start);
    }
}

fn decode(tag: u8, payload: &[u8]) -> Option<RelayFrame> {
    match (tag, payload) {
        (TAG_INPUT, bytes) => Some(RelayFrame::Input(bytes.to_vec())),
        (TAG_RESIZE, [c0, c1, r0, r1]) => Some(RelayFrame::Resize(TerminalSize {
            cols: u16::from_be_bytes([*c0, *c1]),
            rows: u16::from_be_bytes([*r0, *r1]),
        })),
        (TAG_SIGNAL, [code]) => signal_from_code(*code).map(RelayFrame::Signal),
        (TAG_HANGUP, []) => Some(RelayFrame::Hangup),
        _ => None,
    }
}

const SIGNALS: [TerminalSignal; 7] = [
    TerminalSignal::Interrupt,
    TerminalSignal::Quit,
    TerminalSignal::Suspend,
    TerminalSignal::Continue,
    TerminalSignal::Hangup,
    TerminalSignal::Terminate,
    TerminalSignal::Kill,
];

fn signal_code(signal: TerminalSignal) -> u8 {
    SIGNALS
        .iter()
        .position(|candidate| *candidate == signal)
        .expect("every signal is listed") as u8
}

fn signal_from_code(code: u8) -> Option<TerminalSignal> {
    SIGNALS.get(usize::from(code)).copied()
}

/// Runs the relay and exits the process when the first argument is
/// [`RELAY_ARGUMENT`]. Returns otherwise.
///
/// Call it first in `main`, before any thread starts.
pub fn run_if_requested() {
    let mut arguments = std::env::args_os().skip(1);
    if arguments.next().as_deref() != Some(OsStr::new(RELAY_ARGUMENT)) {
        return;
    }
    let command: Vec<OsString> = arguments.collect();
    let code = match command.split_first() {
        Some((program, args)) => run(program, args).unwrap_or_else(|error| {
            eprintln!("pau-term: {error}");
            1
        }),
        None => {
            eprintln!("pau-term: {RELAY_ARGUMENT} needs a program to run");
            2
        }
    };
    std::process::exit(code);
}

enum Event {
    ShellExited(i32),
    Hangup,
}

/// Runs `program` on a new PTY and relays it to standard input and output.
/// Returns the shell's exit code.
fn run(program: &OsStr, args: &[OsString]) -> io::Result<i32> {
    // Signals that end the relay are handled by one thread through
    // `sigwait`, so they must be blocked before any other thread starts.
    // portable-pty clears the mask in the shell.
    let stop_signals = signal_set(&[libc::SIGHUP, libc::SIGINT, libc::SIGTERM]);
    // SAFETY: `stop_signals` is an initialized signal set.
    let result =
        unsafe { libc::pthread_sigmask(libc::SIG_BLOCK, &stop_signals, std::ptr::null_mut()) };
    if result != 0 {
        return Err(io::Error::from_raw_os_error(result));
    }

    let saved = RawMode::enter(libc::STDIN_FILENO);
    let size = window_size(libc::STDIN_FILENO).unwrap_or(TerminalSize { cols: 80, rows: 24 });
    let pair = NativePtySystem::default()
        .openpty(pty_size(size))
        .map_err(io::Error::other)?;
    let mut builder = CommandBuilder::new(program);
    builder.args(args);
    builder.cwd(std::env::current_dir()?);
    let mut child = pair
        .slave
        .spawn_command(builder)
        .map_err(io::Error::other)?;
    drop(pair.slave);
    let session = child
        .process_id()
        .ok_or_else(|| io::Error::other("the shell has no process ID"))?
        as libc::pid_t;

    let reader = pair.master.try_clone_reader().map_err(io::Error::other)?;
    let writer = pair.master.take_writer().map_err(io::Error::other)?;
    let master = Arc::new(Mutex::new(pair.master));
    let (events, receiver) = mpsc::channel();
    let (output_done, output_ended) = mpsc::channel();

    thread::spawn(move || {
        copy_output(reader);
        let _ = output_done.send(());
    });
    {
        let events = events.clone();
        let master = Arc::clone(&master);
        thread::spawn(move || {
            relay_input(writer, &master);
            let _ = events.send(Event::Hangup);
        });
    }
    {
        let events = events.clone();
        thread::spawn(move || {
            let mut signal = 0;
            // SAFETY: `stop_signals` is initialized and blocked in every thread.
            if unsafe { libc::sigwait(&stop_signals, &mut signal) } == 0 {
                let _ = events.send(Event::Hangup);
            }
        });
    }
    thread::spawn(move || {
        let code = child
            .wait()
            .map(|status| status.exit_code() as i32)
            .unwrap_or(1);
        let _ = events.send(Event::ShellExited(code));
    });

    let code = match receiver.recv() {
        Ok(Event::ShellExited(code)) => code,
        Ok(Event::Hangup) | Err(_) => {
            signal_session(session, &[libc::SIGHUP, libc::SIGCONT]);
            let exited = wait_for_exit(&receiver, HANGUP_GRACE);
            signal_session(session, &[libc::SIGKILL]);
            match exited {
                Some(code) => code,
                None => wait_for_exit(&receiver, HANGUP_GRACE).unwrap_or(1),
            }
        }
    };
    // Background jobs that outlive the shell would otherwise keep running
    // inside the sandbox with nothing left to stop them.
    signal_session(session, &[libc::SIGHUP, libc::SIGCONT]);
    if !session_processes(session).is_empty() {
        thread::sleep(Duration::from_millis(100));
    }
    signal_session(session, &[libc::SIGKILL]);
    let _ = output_ended.recv_timeout(DRAIN_LIMIT);
    drop(saved);
    Ok(code)
}

fn wait_for_exit(receiver: &mpsc::Receiver<Event>, limit: Duration) -> Option<i32> {
    let deadline = std::time::Instant::now() + limit;
    loop {
        let remaining = deadline.checked_duration_since(std::time::Instant::now())?;
        match receiver.recv_timeout(remaining) {
            Ok(Event::ShellExited(code)) => return Some(code),
            Ok(Event::Hangup) => {}
            Err(_) => return None,
        }
    }
}

/// Copies inner PTY output to standard output until end of file.
fn copy_output(mut reader: Box<dyn Read + Send>) {
    let mut buffer = vec![0_u8; CHUNK_BYTES];
    let mut stdout = io::stdout().lock();
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => return,
            Ok(count) => {
                if stdout
                    .write_all(&buffer[..count])
                    .and_then(|()| stdout.flush())
                    .is_err()
                {
                    return;
                }
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(_) => return,
        }
    }
}

/// Applies frames from standard input until Pau hangs up or closes it.
fn relay_input(mut writer: Box<dyn Write + Send>, master: &Mutex<Box<dyn MasterPty + Send>>) {
    let mut decoder = RelayDecoder::default();
    let mut frames = Vec::new();
    let mut buffer = vec![0_u8; CHUNK_BYTES];
    let mut stdin = io::stdin().lock();
    loop {
        let count = match stdin.read(&mut buffer) {
            Ok(0) => return,
            Ok(count) => count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => return,
        };
        decoder.push(&buffer[..count], &mut frames);
        for frame in frames.drain(..) {
            let master = master.lock().expect("relay master lock poisoned");
            match frame {
                RelayFrame::Input(bytes) => {
                    drop(master);
                    // A failed write means the shell's side has closed; the
                    // waiter thread reports the exit.
                    let _ = writer.write_all(&bytes).and_then(|()| writer.flush());
                }
                RelayFrame::Resize(size) if size.cols > 0 && size.rows > 0 => {
                    let _ = master.resize(pty_size(size));
                }
                RelayFrame::Resize(_) => {}
                RelayFrame::Signal(signal) => {
                    if let Some(group) = master.process_group_leader().filter(|group| *group > 1) {
                        // SAFETY: `killpg` has no memory-safety requirements.
                        unsafe { libc::killpg(group, signal_number(signal)) };
                    }
                }
                RelayFrame::Hangup => return,
            }
        }
    }
}

fn pty_size(size: TerminalSize) -> PtySize {
    PtySize {
        rows: size.rows,
        cols: size.cols,
        pixel_width: 0,
        pixel_height: 0,
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

fn signal_set(signals: &[i32]) -> libc::sigset_t {
    let mut set = MaybeUninit::<libc::sigset_t>::uninit();
    // SAFETY: `sigemptyset` initializes the set before `sigaddset` reads it.
    unsafe {
        libc::sigemptyset(set.as_mut_ptr());
        for signal in signals {
            libc::sigaddset(set.as_mut_ptr(), *signal);
        }
        set.assume_init()
    }
}

/// Reads the window size of the terminal on `fd`.
fn window_size(fd: i32) -> Option<TerminalSize> {
    let mut size = MaybeUninit::<libc::winsize>::zeroed();
    // SAFETY: `TIOCGWINSZ` writes one `winsize` into the pointer.
    let result = unsafe { libc::ioctl(fd, libc::TIOCGWINSZ, size.as_mut_ptr()) };
    if result != 0 {
        return None;
    }
    // SAFETY: the ioctl succeeded and filled the value.
    let size = unsafe { size.assume_init() };
    (size.ws_col > 0 && size.ws_row > 0).then_some(TerminalSize {
        cols: size.ws_col,
        rows: size.ws_row,
    })
}

/// Puts the terminal on `fd` in raw mode and returns its earlier settings.
/// Returns `None` and changes nothing when `fd` is not a terminal.
pub(crate) fn set_raw_mode(fd: i32) -> Option<libc::termios> {
    let mut termios = MaybeUninit::<libc::termios>::uninit();
    // SAFETY: `tcgetattr` fills the value when it succeeds.
    if unsafe { libc::tcgetattr(fd, termios.as_mut_ptr()) } != 0 {
        return None;
    }
    // SAFETY: the call succeeded.
    let original = unsafe { termios.assume_init() };
    let mut raw = original;
    // SAFETY: `raw` is an initialized `termios`.
    unsafe {
        libc::cfmakeraw(&mut raw);
        libc::tcsetattr(fd, libc::TCSANOW, &raw);
    }
    Some(original)
}

/// Raw mode on the relay's standard input, restored when dropped.
///
/// Pau already puts its PTY in raw mode before the relay starts. Setting it
/// here again covers a relay started on another terminal, whose line
/// discipline would otherwise echo frames and turn their bytes into signals.
struct RawMode {
    fd: i32,
    original: Option<libc::termios>,
}

impl RawMode {
    fn enter(fd: i32) -> Self {
        Self {
            fd,
            original: set_raw_mode(fd),
        }
    }
}

impl Drop for RawMode {
    fn drop(&mut self) {
        if let Some(original) = &self.original {
            // SAFETY: `original` is the value `tcgetattr` returned.
            unsafe { libc::tcsetattr(self.fd, libc::TCSANOW, original) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Vec<RelayFrame> {
        vec![
            RelayFrame::Input(b"ls\r".to_vec()),
            RelayFrame::Resize(TerminalSize { cols: 300, rows: 2 }),
            RelayFrame::Input(Vec::new()),
            RelayFrame::Signal(TerminalSignal::Interrupt),
            RelayFrame::Signal(TerminalSignal::Kill),
            RelayFrame::Input(vec![TAG_HANGUP, 0, 0, 0xff]),
            RelayFrame::Hangup,
        ]
    }

    fn encoded(frames: &[RelayFrame]) -> Vec<u8> {
        let mut out = Vec::new();
        for frame in frames {
            frame.encode(&mut out);
        }
        out
    }

    #[test]
    fn decodes_frames_across_every_split_point() {
        let frames = sample();
        let bytes = encoded(&frames);
        for split in 0..=bytes.len() {
            let mut decoder = RelayDecoder::default();
            let mut decoded = Vec::new();
            decoder.push(&bytes[..split], &mut decoded);
            decoder.push(&bytes[split..], &mut decoded);
            assert_eq!(decoded, frames, "split at {split}");
            assert!(decoder.pending.is_empty());
        }
    }

    #[test]
    fn decodes_frames_one_byte_at_a_time() {
        let frames = sample();
        let mut decoder = RelayDecoder::default();
        let mut decoded = Vec::new();
        for byte in encoded(&frames) {
            decoder.push(&[byte], &mut decoded);
        }
        assert_eq!(decoded, frames);
    }

    #[test]
    fn splits_oversized_input_into_full_frames() {
        let input: Vec<u8> = (0..MAX_PAYLOAD * 2 + 10).map(|index| index as u8).collect();
        let bytes = encode_input(&input);
        assert_eq!(bytes.len(), input.len() + 3 * HEADER);
        let mut decoder = RelayDecoder::default();
        let mut decoded = Vec::new();
        decoder.push(&bytes, &mut decoded);
        let lengths: Vec<_> = decoded
            .iter()
            .map(|frame| match frame {
                RelayFrame::Input(bytes) => bytes.len(),
                other => panic!("unexpected {other:?}"),
            })
            .collect();
        assert_eq!(lengths, [MAX_PAYLOAD, MAX_PAYLOAD, 10]);
        let joined: Vec<u8> = decoded
            .into_iter()
            .flat_map(|frame| match frame {
                RelayFrame::Input(bytes) => bytes,
                _ => unreachable!(),
            })
            .collect();
        assert_eq!(joined, input);
        assert!(encode_input(&[]).is_empty());
    }

    #[test]
    fn skips_unknown_and_malformed_frames() {
        let mut bytes = Vec::new();
        push_frame(&mut bytes, 99, b"future");
        push_frame(&mut bytes, TAG_RESIZE, &[0, 80]);
        push_frame(&mut bytes, TAG_SIGNAL, &[200]);
        push_frame(&mut bytes, TAG_HANGUP, b"x");
        RelayFrame::Input(b"kept".to_vec()).encode(&mut bytes);
        let mut decoder = RelayDecoder::default();
        let mut decoded = Vec::new();
        decoder.push(&bytes, &mut decoded);
        assert_eq!(decoded, [RelayFrame::Input(b"kept".to_vec())]);
    }

    #[test]
    fn round_trips_every_signal() {
        for signal in SIGNALS {
            assert_eq!(signal_from_code(signal_code(signal)), Some(signal));
        }
    }
}
