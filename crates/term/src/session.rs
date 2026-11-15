//! Finding and stopping the processes of one terminal session.
//!
//! A terminal's program is a session leader, so its process ID is the session
//! ID. Background jobs sit in their own process groups but stay in the session
//! unless they call `setsid`.

#[cfg(target_os = "macos")]
use std::mem::MaybeUninit;
use std::{
    thread,
    time::{Duration, Instant},
};

/// Longest time [`kill_leftovers`] spends stopping a session's processes.
const FREEZE_LIMIT: Duration = Duration::from_secs(2);
/// Pause between freeze rounds, so a signalled process can stop.
const FREEZE_PAUSE: Duration = Duration::from_millis(1);
/// Longest time [`kill_leftovers`] waits for killed processes to go.
const KILL_LIMIT: Duration = Duration::from_secs(1);
/// Pause between kill rounds, so killed processes can be reaped.
const KILL_PAUSE: Duration = Duration::from_millis(10);

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

/// Lists the live processes whose session ID is `session`.
pub(crate) fn session_processes(session: libc::pid_t) -> Vec<libc::pid_t> {
    session_members(session)
        .into_iter()
        .filter(|(_, state)| *state != State::Exited)
        .map(|(pid, _)| pid)
        .collect()
}

/// Whether a process can still run code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Running,
    /// Stopped by a signal. A stopped process is outside any system call, so
    /// it cannot finish a `fork` either.
    Stopped,
    /// A zombie waiting to be reaped.
    Exited,
}

/// Lists the processes whose session ID is `session`, with their state.
///
/// Linux has no call that lists one session, so this reads every
/// `/proc/<pid>/stat`. Inside sandbox-runtime's PID namespace that is only
/// the sandbox's processes.
#[cfg(target_os = "linux")]
fn session_members(session: libc::pid_t) -> Vec<(libc::pid_t, State)> {
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    entries
        .filter_map(|entry| {
            let pid = entry
                .ok()?
                .file_name()
                .to_str()?
                .parse::<libc::pid_t>()
                .ok()?;
            let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
            // Fields after the parenthesized command name: state, parent,
            // process group, session.
            let mut fields = stat.rsplit_once(')')?.1.split_whitespace();
            let state = match fields.next()? {
                "T" | "t" => State::Stopped,
                "Z" | "X" => State::Exited,
                _ => State::Running,
            };
            let member = fields.nth(2)?.parse::<libc::pid_t>().ok()? == session;
            member.then_some((pid, state))
        })
        .collect()
}

/// Lists the processes whose session ID is `session`, with their state.
///
/// macOS has no session filter with a stable binding, so this takes the
/// kernel's list of every process, made under one lock, and asks each for
/// its session.
#[cfg(target_os = "macos")]
fn session_members(session: libc::pid_t) -> Vec<(libc::pid_t, State)> {
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
        .map(|pid| (pid, macos_state(pid)))
        .collect()
}

#[cfg(target_os = "macos")]
fn macos_state(pid: libc::pid_t) -> State {
    let mut info = MaybeUninit::<libc::proc_bsdshortinfo>::zeroed();
    let size = size_of::<libc::proc_bsdshortinfo>() as libc::c_int;
    // SAFETY: `info` holds `size` bytes.
    let read = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDT_SHORTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            size,
        )
    };
    if read != size {
        // A process that cannot be read has exited or is exiting.
        return State::Exited;
    }
    // SAFETY: `proc_pidinfo` filled all of `info`.
    match unsafe { info.assume_init() }.pbsi_status {
        libc::SSTOP => State::Stopped,
        libc::SZOMB => State::Exited,
        _ => State::Running,
    }
}

/// Stops every process left in a session whose leader has exited.
///
/// Killing a listed process ID cannot stop a chain that forks and exits
/// faster than the list is read: by the time `SIGKILL` arrives, the process
/// has a child that was not listed. So the sweep first freezes the session.
/// It sends `SIGSTOP` to every member that is not yet stopped, and lists the
/// session again, until every member is stopped or a zombie. A stopped
/// process cannot fork, so the set can no longer grow, and `SIGKILL` then
/// reaches all of it. The kernel continues a stopped process only when its
/// process group is orphaned, and the next round stops it again.
///
/// Freezing takes at most [`FREEZE_LIMIT`]. After that the sweep kills what
/// it can list until [`KILL_LIMIT`] passes, which leaves a chain that forks
/// faster than the kernel can stop it running. On Linux, sandbox-runtime's
/// PID namespace still ends that chain when the sandbox's first process
/// exits.
///
/// Only processes whose session ID matches are signalled. The leader's
/// process group is not, because a reaped leader's process ID can be reused.
pub(crate) fn kill_leftovers(session: libc::pid_t) {
    let freeze_until = Instant::now() + FREEZE_LIMIT;
    loop {
        let running: Vec<_> = session_members(session)
            .into_iter()
            .filter(|(_, state)| *state == State::Running)
            .collect();
        if running.is_empty() || Instant::now() >= freeze_until {
            break;
        }
        for (pid, _) in running {
            // SAFETY: `kill` has no memory-safety requirements.
            unsafe { libc::kill(pid, libc::SIGSTOP) };
        }
        thread::sleep(FREEZE_PAUSE);
    }
    let kill_until = Instant::now() + KILL_LIMIT;
    loop {
        let members = session_processes(session);
        if members.is_empty() || Instant::now() >= kill_until {
            return;
        }
        for pid in members {
            // SAFETY: `kill` has no memory-safety requirements.
            unsafe { libc::kill(pid, libc::SIGKILL) };
        }
        thread::sleep(KILL_PAUSE);
    }
}
