//! Finding and stopping the processes of one terminal session.
//!
//! A terminal's program is a session leader, so its process ID is the session
//! ID. Background jobs sit in their own process groups but stay in the session
//! unless they call `setsid`.

use std::{thread, time::Duration};

/// Rounds [`kill_leftovers`] makes before it gives up on processes that keep
/// forking.
const SWEEP_ROUNDS: usize = 50;
/// Pause between sweep rounds, so killed processes can be reaped.
const SWEEP_PAUSE: Duration = Duration::from_millis(20);

/// Sends each signal to every process in the shell's session.
///
/// The shell is the session leader, so its process ID is the session ID.
/// Background jobs sit in their own process groups but stay in the session
/// unless they call `setsid`.
pub(crate) fn signal_session(session: libc::pid_t, signals: &[i32]) {
    let members = session_processes(session);
    for signal in signals {
        // SAFETY: `kill` and `killpg` have no memory-safety requirements.
        unsafe {
            libc::killpg(session, *signal);
            for pid in &members {
                libc::kill(*pid, *signal);
            }
        }
    }
}

/// Lists the processes whose session ID is `session`.
#[cfg(target_os = "linux")]
pub(crate) fn session_processes(session: libc::pid_t) -> Vec<libc::pid_t> {
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    entries
        .filter_map(|entry| {
            entry
                .ok()?
                .file_name()
                .to_str()?
                .parse::<libc::pid_t>()
                .ok()
        })
        .filter(|pid| {
            // Fields after the parenthesized command name: state, parent,
            // process group, session.
            std::fs::read_to_string(format!("/proc/{pid}/stat"))
                .ok()
                .and_then(|stat| {
                    let fields = stat.rsplit_once(')')?.1;
                    fields
                        .split_whitespace()
                        .nth(3)?
                        .parse::<libc::pid_t>()
                        .ok()
                })
                == Some(session)
        })
        .collect()
}

/// Lists the processes whose session ID is `session`.
#[cfg(target_os = "macos")]
pub(crate) fn session_processes(session: libc::pid_t) -> Vec<libc::pid_t> {
    // SAFETY: a null buffer asks only for the current process count.
    let count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
    if count <= 0 {
        return Vec::new();
    }
    // Room for processes that start between the two calls.
    let mut pids = vec![0 as libc::pid_t; count as usize + 64];
    let bytes = (pids.len() * size_of::<libc::pid_t>()) as libc::c_int;
    // SAFETY: `pids` holds `bytes` bytes.
    let count = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), bytes) };
    pids.truncate(count.max(0) as usize);
    pids.into_iter()
        // SAFETY: `getsid` has no memory-safety requirements.
        .filter(|pid| *pid > 0 && unsafe { libc::getsid(*pid) } == session)
        .collect()
}

/// Sends `SIGKILL` to every process left in a session whose leader has
/// exited, until none is left or [`SWEEP_ROUNDS`] pass.
///
/// Only processes whose session ID matches are signalled. The leader's
/// process group is not, because a reaped leader's process ID can be reused.
pub(crate) fn kill_leftovers(session: libc::pid_t) {
    for _ in 0..SWEEP_ROUNDS {
        let members = session_processes(session);
        if members.is_empty() {
            return;
        }
        for pid in members {
            // SAFETY: `kill` has no memory-safety requirements.
            unsafe { libc::kill(pid, libc::SIGKILL) };
        }
        thread::sleep(SWEEP_PAUSE);
    }
}
