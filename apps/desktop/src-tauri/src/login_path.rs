//! Gives the app the operator's login shell `PATH` on macOS.
//!
//! An app opened from Finder, the Dock, or Spotlight inherits launchd's minimal
//! `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`), not the one the operator's shell
//! builds. Pi, Node.js, and the tools agents and terminals run then look
//! missing even though they work in a terminal. The first startup step asks
//! the login shell for its `PATH` once and puts it ahead of the inherited
//! entries, and the backend gives the result to every child process.

use std::{
    env,
    ffi::{OsStr, OsString},
    io::Read,
    path::PathBuf,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const MARKER: &str = "__PAU_LOGIN_PATH__";
/// An interactive shell can stall on prompts or slow plugins. Startup gives up
/// after this long and keeps the inherited `PATH`.
pub const TIMEOUT: Duration = Duration::from_secs(3);

/// Why the login shell `PATH` could not be read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginPathError {
    /// The shell did not finish within the timeout and was stopped.
    TimedOut,
    /// The shell could not start, or printed no marked value.
    Unavailable,
}

/// Runs `shell` and returns its `PATH`, stopping the shell after `timeout`.
///
/// The shell runs as a login and interactive shell so both profile and rc
/// files apply, which is where version managers and Homebrew usually extend
/// `PATH`. Markers separate the value from anything the rc files print.
pub fn shell_path(shell: &OsStr, timeout: Duration) -> Result<OsString, LoginPathError> {
    let mut child = Command::new(shell)
        .args(["-l", "-i", "-c"])
        .arg(format!("printf '{MARKER}%s{MARKER}' \"$PATH\""))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| LoginPathError::Unavailable)?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(20)),
            waited => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(if waited.is_ok() {
                    LoginPathError::TimedOut
                } else {
                    LoginPathError::Unavailable
                });
            }
        }
    }
    let mut output = String::new();
    child
        .stdout
        .take()
        .ok_or(LoginPathError::Unavailable)?
        .read_to_string(&mut output)
        .map_err(|_| LoginPathError::Unavailable)?;
    marked_path(&output)
        .map(OsString::from)
        .ok_or(LoginPathError::Unavailable)
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
        time::{Duration, Instant},
    };

    use super::{LoginPathError, MARKER, marked_path, merge_paths, shell_path};

    /// Writes an executable script that stands in for the login shell.
    fn fake_shell(directory: &Path, name: &str, body: &str) -> PathBuf {
        let path = directory.join(name);
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[test]
    fn stops_a_slow_login_shell_at_the_timeout() {
        let directory = tempfile::tempdir().unwrap();
        let shell = fake_shell(directory.path(), "slow", "sleep 10");
        let started = Instant::now();

        let result = shell_path(shell.as_os_str(), Duration::from_millis(200));

        assert_eq!(result, Err(LoginPathError::TimedOut));
        assert!(started.elapsed() < Duration::from_secs(5));
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
