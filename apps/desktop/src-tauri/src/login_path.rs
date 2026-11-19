//! Gives the app the operator's login shell `PATH` on macOS.
//!
//! An app opened from Finder, the Dock, or Spotlight inherits launchd's minimal
//! `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`), not the one the operator's shell
//! builds. Pi, Node.js, and the tools agents and terminals run then look
//! missing even though they work in a terminal. The first startup step asks
//! the login shell for its `PATH` once and puts it ahead of the inherited
//! entries, and the backend gives the result to every child process.
//!
//! An app that already inherits a shell-built `PATH`, as one started from a
//! terminal does, skips the lookup; [`inherits_shell_path`] decides which case
//! applies.

use std::{
    env,
    ffi::{OsStr, OsString},
    io::Read,
    os::unix::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc::{self, RecvTimeoutError},
    thread,
    time::{Duration, Instant},
};

use pau_agent::signal_process_group;

const MARKER: &str = "__PAU_LOGIN_PATH__";
/// An interactive shell can stall on prompts or slow plugins. Startup gives up
/// after this long and keeps the inherited `PATH`.
///
/// A shell that starts in under a second can take several times that on a
/// cold start or while the machine is busy, so the limit leaves room for that
/// and costs time only when the shell is slow.
pub const TIMEOUT: Duration = Duration::from_secs(10);

/// Why the login shell `PATH` could not be read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginPathError {
    /// The shell printed no `PATH` within the timeout and was stopped.
    TimedOut,
    /// The shell could not start, or printed no marked value.
    Unavailable,
}

/// The `PATH` launchd gives an app opened from Finder, the Dock or Spotlight.
const LAUNCHD_PATH: [&str; 4] = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];

/// Reports whether the inherited `PATH` already holds more than launchd's
/// default entries, so asking the login shell would add nothing.
///
/// The `PATH` itself is the signal, not how the app was started. A shell
/// always adds entries, such as `/usr/local/bin` from `path_helper`, so an app
/// opened from a terminal, directly or with `open`, skips the lookup. A bare
/// `PATH` always gets the lookup, even with `TERM` set: `open` from a script
/// with a scrubbed environment, from `ssh`, or after `launchctl setenv TERM`
/// passes on a `TERM` without the shell's `PATH`.
pub fn inherits_shell_path(path: &OsStr) -> bool {
    env::split_paths(path).any(|entry| {
        !entry.as_os_str().is_empty() && !LAUNCHD_PATH.iter().any(|known| entry == Path::new(known))
    })
}

/// Runs `shell` and returns its `PATH`, giving up after `timeout`.
///
/// The shell runs as a login and interactive shell so both profile and rc
/// files apply, which is where version managers and Homebrew usually extend
/// `PATH`. Markers separate the value from anything the rc files print.
///
/// The timeout covers reading the value, not only the shell's exit: a
/// background job that the rc files start inherits stdout and can hold it open
/// long after the shell exits. The shell leads its own process group, so when
/// time runs out the shell and everything it started are killed together.
pub fn shell_path(shell: &OsStr, timeout: Duration) -> Result<OsString, LoginPathError> {
    let deadline = Instant::now() + timeout;
    let mut child = Command::new(shell)
        .args(["-l", "-i", "-c"])
        .arg(format!("printf '{MARKER}%s{MARKER}' \"$PATH\""))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map_err(|_| LoginPathError::Unavailable)?;
    let mut stdout = child.stdout.take().ok_or(LoginPathError::Unavailable)?;
    let (sender, receiver) = mpsc::channel();
    // The reader stops at the closing marker. A job that keeps the pipe open
    // without printing one leaves this thread blocked until the job exits.
    thread::spawn(move || {
        let _ = sender.send(read_marked_path(&mut stdout));
    });
    let path = match receiver.recv_timeout(timeout) {
        Ok(path) => path.ok_or(LoginPathError::Unavailable),
        Err(RecvTimeoutError::Timeout) => Err(LoginPathError::TimedOut),
        Err(RecvTimeoutError::Disconnected) => Err(LoginPathError::Unavailable),
    };
    // Let the shell finish within the deadline, then stop its whole group.
    // The group is signalled only while the unreaped shell keeps its ID.
    loop {
        match child.try_wait() {
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            Ok(None) => {
                let _ = signal_process_group(child.id(), libc::SIGKILL);
                let _ = child.wait();
                break;
            }
            _ => break,
        }
    }
    path.map(OsString::from)
}

/// Reads the shell's output until the closing marker or the end of output and
/// returns the marked value.
fn read_marked_path(output: &mut impl Read) -> Option<String> {
    let mut buffer = Vec::new();
    let mut chunk = [0; 4096];
    loop {
        let read = match output.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(read) => read,
        };
        buffer.extend_from_slice(&chunk[..read]);
        // A chunk can end inside a multibyte character; the next read completes it.
        if let Some(path) = std::str::from_utf8(&buffer).ok().and_then(marked_path) {
            return Some(path.to_owned());
        }
    }
    std::str::from_utf8(&buffer)
        .ok()
        .and_then(marked_path)
        .map(str::to_owned)
}

/// Extracts the value between the first pair of markers.
fn marked_path(output: &str) -> Option<&str> {
    let start = output.find(MARKER)? + MARKER.len();
    let length = output[start..].find(MARKER)?;
    let path = &output[start..start + length];
    (!path.is_empty()).then_some(path)
}

/// Puts the login shell's entries first, then the inherited entries it lacks.
pub fn merge_paths(login: &OsStr, inherited: &OsStr) -> Option<OsString> {
    let mut entries: Vec<PathBuf> = Vec::new();
    for entry in env::split_paths(login).chain(env::split_paths(inherited)) {
        if !entry.as_os_str().is_empty() && !entries.contains(&entry) {
            entries.push(entry);
        }
    }
    env::join_paths(entries).ok()
}

#[cfg(test)]
mod tests {
    use std::{
        ffi::OsStr,
        fs,
        os::unix::fs::PermissionsExt,
        path::{Path, PathBuf},
        thread,
        time::{Duration, Instant},
    };

    use super::{
        LoginPathError, MARKER, inherits_shell_path, marked_path, merge_paths, shell_path,
    };

    /// Writes an executable script that stands in for the login shell.
    fn fake_shell(directory: &Path, name: &str, body: &str) -> PathBuf {
        let path = directory.join(name);
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    /// Polls until `pid` no longer exists, failing after two seconds.
    fn assert_gone(pid: i32) {
        for _ in 0..100 {
            // SAFETY: signal 0 only checks that the process exists.
            if unsafe { libc::kill(pid, 0) } == -1 {
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
        panic!("process {pid} is still running");
    }

    fn recorded_pid(path: &Path) -> i32 {
        fs::read_to_string(path).unwrap().trim().parse().unwrap()
    }

    #[test]
    fn stops_a_slow_login_shell_and_its_children_at_the_timeout() {
        let directory = tempfile::tempdir().unwrap();
        let record = directory.path().join("child");
        let shell = fake_shell(
            directory.path(),
            "slow",
            &format!("sleep 600 &\necho $! > '{}'\nwait", record.display()),
        );
        let started = Instant::now();

        let result = shell_path(shell.as_os_str(), Duration::from_millis(1500));

        assert_eq!(result, Err(LoginPathError::TimedOut));
        assert!(started.elapsed() < Duration::from_secs(4));
        assert_gone(recorded_pid(&record));
    }

    #[test]
    fn reads_the_path_while_a_background_job_holds_the_output_open() {
        let directory = tempfile::tempdir().unwrap();
        let record = directory.path().join("job");
        let shell = fake_shell(
            directory.path(),
            "daemon",
            &format!(
                "sleep 600 &\necho $! > '{}'\nprintf '{MARKER}/opt/bin{MARKER}'",
                record.display()
            ),
        );
        let started = Instant::now();

        let result = shell_path(shell.as_os_str(), Duration::from_secs(5));

        assert_eq!(result, Ok("/opt/bin".into()));
        assert!(started.elapsed() < Duration::from_secs(4));
        // SAFETY: the PID belongs to the job this test started.
        unsafe { libc::kill(recorded_pid(&record), libc::SIGKILL) };
    }

    #[test]
    fn times_out_when_a_background_job_holds_the_output_open_without_a_path() {
        let directory = tempfile::tempdir().unwrap();
        let record = directory.path().join("job");
        let shell = fake_shell(
            directory.path(),
            "mute",
            &format!("sleep 600 &\necho $! > '{}'", record.display()),
        );
        let started = Instant::now();

        let result = shell_path(shell.as_os_str(), Duration::from_millis(1500));

        assert_eq!(result, Err(LoginPathError::TimedOut));
        assert!(started.elapsed() < Duration::from_secs(4));
        // SAFETY: the PID belongs to the job this test started.
        unsafe { libc::kill(recorded_pid(&record), libc::SIGKILL) };
    }

    #[test]
    fn reads_the_path_a_login_shell_prints() {
        let directory = tempfile::tempdir().unwrap();
        let shell = fake_shell(
            directory.path(),
            "chatty",
            &format!("echo welcome; printf '{MARKER}/opt/bin:/usr/bin{MARKER}'"),
        );
        let silent = fake_shell(directory.path(), "silent", "exit 0");

        assert_eq!(
            shell_path(shell.as_os_str(), Duration::from_secs(5)),
            Ok("/opt/bin:/usr/bin".into())
        );
        assert_eq!(
            shell_path(silent.as_os_str(), Duration::from_secs(5)),
            Err(LoginPathError::Unavailable)
        );
    }

    #[test]
    fn looks_up_the_login_path_only_for_launchd_defaults() {
        let cases = [
            ("", false),
            ("/usr/bin:/bin", false),
            ("/usr/bin:/bin:/usr/sbin:/sbin", false),
            ("/sbin::/usr/bin/", false),
            ("/opt/homebrew/bin:/usr/bin:/bin", true),
            ("/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", true),
        ];
        for (path, inherited) in cases {
            assert_eq!(inherits_shell_path(OsStr::new(path)), inherited, "{path:?}");
        }
    }

    #[test]
    fn reads_the_marked_value_past_rc_file_output() {
        let output = format!("Welcome back\n{MARKER}/opt/homebrew/bin:/usr/bin{MARKER}");
        assert_eq!(marked_path(&output), Some("/opt/homebrew/bin:/usr/bin"));
        assert_eq!(marked_path("no markers here"), None);
        assert_eq!(marked_path(&format!("{MARKER}{MARKER}")), None);
    }

    #[test]
    fn puts_login_entries_first_without_duplicates() {
        let merged = merge_paths(
            OsStr::new("/Users/me/.local/bin:/opt/homebrew/bin:/usr/bin"),
            OsStr::new("/usr/bin:/bin:/usr/sbin:/sbin"),
        )
        .unwrap();
        assert_eq!(
            merged,
            "/Users/me/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        );
    }
}
