//! Agent processes that lead their own process group.
//!
//! An agent host starts its own children: Claude Code under the bridge, tools
//! and shells under Pi. Signalling only the host's PID leaves those children
//! running with no parent to stop them. Each host therefore leads a new
//! process group, and every stop signal goes to the whole group.

use std::{io, process::ExitStatus};

use tokio::process::{Child, Command};

/// Makes the command's child lead a new process group whose ID is its PID.
///
/// Call it before spawning, and pass the child to [`ProcessGroup::new`].
pub fn lead_process_group(command: &mut Command) -> &mut Command {
    #[cfg(unix)]
    command.process_group(0);
    command.kill_on_drop(true)
}

/// Sends `signal` to every process in the group that `process_id` leads.
///
/// A group that no longer exists is not an error. Neither is a group left
/// with only its exited, unreaped leader, which macOS refuses with `EPERM`.
/// Any other `EPERM` is returned: a running leader, a member owned by another
/// user, or an ID that is not this process's child. The caller must still own
/// the unreaped leader, or the ID may name another group.
#[cfg(unix)]
pub fn signal_process_group(process_id: u32, signal: i32) -> io::Result<()> {
    let group = libc::pid_t::try_from(process_id)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "process ID out of range"))?;
    // SAFETY: `killpg` has no memory-safety requirements.
    if unsafe { libc::killpg(group, signal) } == 0 {
        return Ok(());
    }
    let error = io::Error::last_os_error();
    if refusal_leaves_nothing_running(error.raw_os_error(), || leader_state(group)) {
        Ok(())
    } else {
        Err(error)
    }
}

/// What this process knows of a group's leader after `killpg` fails.
#[cfg(unix)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Leader {
    /// The ID is not an unreaped child of this process.
    NotOurs,
    /// The leader still runs.
    Running,
    /// The leader exited, and the group holds no other process.
    ExitedAlone,
    /// The leader exited, and other members remain or cannot be ruled out.
    ExitedWithMembers,
}

/// Whether a `killpg` failure with `errno` means no member of the group is
/// left running.
///
/// Only `EPERM` reads the leader, so the `waitid` and process listing run
/// just on that path.
#[cfg(unix)]
fn refusal_leaves_nothing_running(errno: Option<i32>, leader: impl FnOnce() -> Leader) -> bool {
    match errno {
        Some(libc::ESRCH) => true,
        Some(libc::EPERM) => leader() == Leader::ExitedAlone,
        _ => false,
    }
}

/// Reads the state of the group leader `group` without reaping it.
///
/// It peeks with `WNOWAIT`, so a zombie leader stays for its owner to reap.
/// `waitid` fails with `ECHILD` for an ID that is not this process's child,
/// which reads as [`Leader::NotOurs`].
#[cfg(unix)]
fn leader_state(group: libc::pid_t) -> Leader {
    // SAFETY: `siginfo_t` is plain data, and all zeros means no child.
    let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
    let flags = libc::WEXITED | libc::WNOHANG | libc::WNOWAIT;
    // SAFETY: `info` is a valid, writable `siginfo_t`.
    if unsafe { libc::waitid(libc::P_PID, group as libc::id_t, &mut info, flags) } != 0 {
        return Leader::NotOurs;
    }
    // SAFETY: `waitid` succeeded, so `info` holds the child's status, or
    // stays zeroed while the child runs.
    if unsafe { info.si_pid() } == 0 {
        Leader::Running
    } else if group_has_other_members(group) {
        Leader::ExitedWithMembers
    } else {
        Leader::ExitedAlone
    }
}

/// Whether the group `group` holds a process other than its leader.
///
/// Members owned by another user count, since they are the ones `killpg`
/// cannot signal.
#[cfg(target_os = "macos")]
fn group_has_other_members(group: libc::pid_t) -> bool {
    let mut members = [0 as libc::pid_t; 2];
    let size = std::mem::size_of_val(&members) as libc::c_int;
    // SAFETY: `members` is a writable buffer of `size` bytes.
    let count = unsafe { libc::proc_listpgrppids(group, members.as_mut_ptr().cast(), size) };
    match usize::try_from(count) {
        Ok(count) => members[..count.min(members.len())]
            .iter()
            .any(|&member| member != group),
        Err(_) => true,
    }
}

/// Whether the group `group` holds a process other than its leader.
///
/// Other Unix systems signal a zombie leader without error, so `killpg`
/// answers `EPERM` only when a member refused it. There is no portable way
/// to list a group, so this assumes a member remains.
#[cfg(all(unix, not(target_os = "macos")))]
fn group_has_other_members(_group: libc::pid_t) -> bool {
    true
}

/// Whether `process_id`, an unreaped child of this process, has exited.
///
/// Tests use it to wait for a zombie leader. Any other ID reads as not
/// exited.
#[cfg(all(unix, any(test, feature = "test-support")))]
pub fn child_exited(process_id: u32) -> bool {
    libc::pid_t::try_from(process_id).is_ok_and(|group| {
        matches!(
            leader_state(group),
            Leader::ExitedAlone | Leader::ExitedWithMembers
        )
    })
}

/// Owns a child spawned after [`lead_process_group`] and kills its whole
/// group when killed or dropped before the leader exits.
///
/// The group is signalled only while the leader is unreaped, since its PID
/// keeps the group ID from naming anything else.
pub struct ProcessGroup {
    child: Child,
}

impl ProcessGroup {
    /// Takes ownership of a group leader.
    pub fn new(child: Child) -> Self {
        Self { child }
    }

    /// Waits for the leader to exit.
    pub async fn wait(&mut self) -> io::Result<ExitStatus> {
        self.child.wait().await
    }

    /// Kills every process in the group, then waits for the leader.
    pub async fn kill(&mut self) -> io::Result<ExitStatus> {
        self.kill_group();
        self.child.wait().await
    }

    fn kill_group(&mut self) {
        if !matches!(self.child.try_wait(), Ok(None)) {
            return;
        }
        #[cfg(unix)]
        if let Some(process_id) = self.child.id() {
            let _ = signal_process_group(process_id, libc::SIGKILL);
            return;
        }
        let _ = self.child.start_kill();
    }
}

impl Drop for ProcessGroup {
    fn drop(&mut self) {
        self.kill_group();
    }
}

#[cfg(all(test, unix))]
pub(crate) mod tests {
    use std::{os::unix::fs::PermissionsExt, path::Path, process::Stdio, time::Duration};

    use super::*;

    /// Writes a host stand-in that starts a grandchild in the background,
    /// records its PID and waits, as a bridge does with Claude Code.
    pub(crate) fn host_with_grandchild(directory: &Path) -> std::path::PathBuf {
        let host = directory.join("host");
        std::fs::write(
            &host,
            "#!/bin/sh\nsleep 600 &\necho $! > grandchild\nwait\n",
        )
        .unwrap();
        std::fs::set_permissions(&host, std::fs::Permissions::from_mode(0o755)).unwrap();
        host
    }

    pub(crate) async fn grandchild(directory: &Path) -> i32 {
        let path = directory.join("grandchild");
        for _ in 0..100 {
            if let Ok(text) = std::fs::read_to_string(&path)
                && let Ok(pid) = text.trim().parse()
            {
                return pid;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("the host did not start its grandchild");
    }

    pub(crate) async fn assert_gone(pid: i32) {
        for _ in 0..100 {
            // SAFETY: signal 0 only checks that the process exists.
            if unsafe { libc::kill(pid, 0) } == -1 {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("process {pid} is still running");
    }

    async fn spawn_host(directory: &Path) -> (ProcessGroup, i32) {
        let mut command = Command::new(host_with_grandchild(directory));
        command.current_dir(directory).stdin(Stdio::null());
        let group = ProcessGroup::new(lead_process_group(&mut command).spawn().unwrap());
        let grandchild = grandchild(directory).await;
        (group, grandchild)
    }

    #[tokio::test]
    async fn kill_stops_the_grandchildren() {
        let directory = tempfile::tempdir().unwrap();
        let (mut group, grandchild) = spawn_host(directory.path()).await;
        group.kill().await.unwrap();
        assert_gone(grandchild).await;
    }

    /// Spawns a group leader that runs `script` and waits until it exits,
    /// leaving it unreaped.
    fn zombie_leader(directory: &Path, script: &str) -> std::process::Child {
        use std::os::unix::process::CommandExt;
        let mut leader = std::process::Command::new("/bin/sh")
            .arg("-c")
            .arg(script)
            .current_dir(directory)
            .process_group(0)
            .spawn()
            .unwrap();
        for _ in 0..250 {
            if child_exited(leader.id()) {
                return leader;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let _ = leader.kill();
        let _ = leader.wait();
        panic!("the leader did not exit");
    }

    #[test]
    fn signals_a_group_left_with_only_its_exited_leader() {
        let directory = tempfile::tempdir().unwrap();
        let mut leader = zombie_leader(directory.path(), "exit 0");

        signal_process_group(leader.id(), libc::SIGTERM).unwrap();

        assert!(leader.wait().unwrap().success());
    }

    #[tokio::test]
    async fn signals_the_members_an_exited_leader_left_behind() {
        let directory = tempfile::tempdir().unwrap();
        let mut leader =
            zombie_leader(directory.path(), "sleep 600 & echo $! > grandchild; exit 0");
        let grandchild = grandchild(directory.path()).await;

        signal_process_group(leader.id(), libc::SIGKILL).unwrap();

        assert_gone(grandchild).await;
        leader.wait().unwrap();
    }

    #[test]
    fn treats_a_refused_signal_as_done_only_for_a_lone_exited_leader() {
        use Leader::*;
        let cases = [
            (Some(libc::ESRCH), NotOurs, true),
            (Some(libc::EPERM), ExitedAlone, true),
            (Some(libc::EPERM), ExitedWithMembers, false),
            (Some(libc::EPERM), Running, false),
            (Some(libc::EPERM), NotOurs, false),
            (Some(libc::EINVAL), ExitedAlone, false),
            (None, ExitedAlone, false),
        ];
        for (errno, leader, done) in cases {
            assert_eq!(
                refusal_leaves_nothing_running(errno, || leader),
                done,
                "{errno:?} with {leader:?}"
            );
        }
    }

    #[test]
    fn reads_only_its_own_children_as_leaders() {
        assert_eq!(leader_state(1), Leader::NotOurs);
        assert!(!child_exited(1));
        // Root may signal init's group, so only another user sees the refusal.
        // SAFETY: `geteuid` has no requirements.
        if unsafe { libc::geteuid() } != 0 {
            assert!(signal_process_group(1, 0).is_err());
        }
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn tells_a_lone_exited_leader_from_one_with_members() {
        let directory = tempfile::tempdir().unwrap();
        let mut alone = zombie_leader(directory.path(), "exit 0");
        let mut with_member =
            zombie_leader(directory.path(), "sleep 600 & echo $! > grandchild; exit 0");
        let grandchild = grandchild(directory.path()).await;

        assert_eq!(leader_state(alone.id() as i32), Leader::ExitedAlone);
        assert_eq!(
            leader_state(with_member.id() as i32),
            Leader::ExitedWithMembers
        );

        signal_process_group(with_member.id(), libc::SIGKILL).unwrap();
        assert_gone(grandchild).await;
        alone.wait().unwrap();
        with_member.wait().unwrap();
    }

    #[test]
    fn a_running_leader_has_not_exited() {
        let mut leader = std::process::Command::new("sleep")
            .arg("600")
            .spawn()
            .unwrap();

        assert!(!child_exited(leader.id()));

        leader.kill().unwrap();
        leader.wait().unwrap();
    }

    #[tokio::test]
    async fn drop_stops_the_grandchildren() {
        let directory = tempfile::tempdir().unwrap();
        let (group, grandchild) = spawn_host(directory.path()).await;
        drop(group);
        assert_gone(grandchild).await;
    }
}
