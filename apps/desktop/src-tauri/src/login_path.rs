//! Gives the app the operator's login shell `PATH` on macOS.
//!
//! An app opened from Finder, the Dock, or Spotlight inherits launchd's minimal
//! `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`), not the one the operator's shell
//! builds. Pi, Node.js, and the tools agents and terminals run then look
//! missing even though they work in a terminal. Startup asks the login shell
//! for its `PATH` once and puts it ahead of the inherited entries.

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
const TIMEOUT: Duration = Duration::from_secs(3);

/// Runs the login shell and returns its `PATH`, or `None` when the shell fails,
/// times out, or prints no marked value.
///
/// The shell runs as a login and interactive shell so both profile and rc
/// files apply, which is where version managers and Homebrew usually extend
/// `PATH`. Markers separate the value from anything the rc files print.
pub fn login_shell_path() -> Option<OsString> {
    let shell = env::var_os("SHELL").unwrap_or_else(|| OsString::from("/bin/zsh"));
    let mut child = Command::new(shell)
        .args(["-l", "-i", "-c"])
        .arg(format!("printf '{MARKER}%s{MARKER}' \"$PATH\""))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < TIMEOUT => thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut output = String::new();
    child.stdout.take()?.read_to_string(&mut output).ok()?;
    marked_path(&output).map(OsString::from)
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
    use std::ffi::OsStr;

    use super::{MARKER, marked_path, merge_paths};

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
