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
/// A group that no longer exists is not an error. The caller must still own
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
    if error.raw_os_error() == Some(libc::ESRCH) {
        Ok(())
    } else {
        Err(error)
    }
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

    #[tokio::test]
    async fn drop_stops_the_grandchildren() {
        let directory = tempfile::tempdir().unwrap();
        let (group, grandchild) = spawn_host(directory.path()).await;
        drop(group);
        assert_gone(grandchild).await;
    }
}
