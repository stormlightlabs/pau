//! The `pau-term` relay without a sandbox. Each test runs the relay binary on
//! a PTY owned by [`Terminal`], as a sandboxed terminal does inside the
//! sandbox, with real shells on the relay's own PTY.

use std::{path::Path, time::Duration};

use pau_term::{
    Terminal, TerminalCommand, TerminalOutput, TerminalSignal, TerminalSize, TerminalStatus,
    relay::RELAY_ARGUMENT,
};
use tokio::time::{sleep, timeout};

/// Upper bound for one real-process step. It only turns a hang into a failure.
const STEP_LIMIT: Duration = Duration::from_secs(15);

const SIZE: TerminalSize = TerminalSize { cols: 80, rows: 24 };

const RELAY: &str = env!("CARGO_BIN_EXE_pau-term");

/// Starts `program` under the relay. The relay receives only `PATH`, `HOME`,
/// and `TERM`, as it would from a sandbox policy.
fn relayed(program: &str, args: &[&str]) -> (Terminal, TerminalOutput) {
    let mut command = vec![RELAY_ARGUMENT.to_owned(), program.to_owned()];
    command.extend(args.iter().map(|arg| (*arg).to_owned()));
    Terminal::spawn(TerminalCommand {
        program: RELAY.to_owned(),
        args: command,
        cwd: std::env::temp_dir(),
        environment: vec![
            ("PATH".into(), "/usr/bin:/bin:/usr/sbin:/sbin".into()),
            ("HOME".into(), std::env::temp_dir().into()),
            ("PS1".into(), "$ ".into()),
        ],
        size: SIZE,
        relay: true,
    })
    .unwrap()
}

/// An interactive bash without startup files, so job control is on.
fn bash() -> (Terminal, TerminalOutput) {
    relayed("/bin/bash", &["--noprofile", "--norc", "+H", "-i"])
}

/// Reads output until it contains `needle` and returns everything read.
async fn read_until(output: &mut TerminalOutput, needle: &str) -> String {
    let mut seen = Vec::new();
    timeout(STEP_LIMIT, async {
        while !String::from_utf8_lossy(&seen).contains(needle) {
            let chunk = output
                .recv()
                .await
                .unwrap_or_else(|| panic!("output ended before {needle:?}: {seen:?}"));
            seen.extend_from_slice(&chunk);
        }
    })
    .await
    .unwrap_or_else(|_| {
        panic!(
            "timed out waiting for {needle:?} in {:?}",
            String::from_utf8_lossy(&seen)
        )
    });
    String::from_utf8_lossy(&seen).into_owned()
}

async fn exit_status(terminal: &Terminal) -> TerminalStatus {
    timeout(STEP_LIMIT, terminal.exit().wait()).await.unwrap()
}

fn exited(exit_code: u32) -> TerminalStatus {
    TerminalStatus::Exited {
        exit_code,
        signal: None,
    }
}

fn is_alive(pid: i32) -> bool {
    // SAFETY: signal 0 only checks that the process exists.
    unsafe { libc::kill(pid, 0) == 0 }
}

/// Waits until `pid` no longer exists.
async fn wait_gone(pid: i32) {
    timeout(STEP_LIMIT, async {
        while is_alive(pid) {
            sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("process {pid} is still running"));
}

/// Reads output until a line `<label>=<pid>` has arrived for every label and
/// returns the pids in label order. The terminal echoes the command that
/// prints them, so only digits count.
async fn read_pids<const N: usize>(output: &mut TerminalOutput, labels: [&str; N]) -> [i32; N] {
    let find = |seen: &str, label: &str| {
        let marker = format!("{label}=");
        seen.match_indices(&marker).find_map(|(index, _)| {
            let rest = &seen[index + marker.len()..];
            let digits = rest.len() - rest.trim_start_matches(|c: char| c.is_ascii_digit()).len();
            (digits > 0 && rest[digits..].starts_with(['\r', '\n']))
                .then(|| rest[..digits].parse().unwrap())
        })
    };
    let mut seen = String::new();
    timeout(STEP_LIMIT, async {
        loop {
            let found = labels.map(|label| find(&seen, label));
            if found.iter().all(Option::is_some) {
                return found.map(Option::unwrap);
            }
            let chunk = output.recv().await.expect("output ended");
            seen.push_str(&String::from_utf8_lossy(&chunk));
        }
    })
    .await
    .unwrap_or_else(|_| panic!("missing {labels:?} lines in {seen:?}"))
}

#[tokio::test]
async fn relays_input_output_and_the_shell_exit_code() {
    let (terminal, mut output) =
        relayed("/bin/sh", &["-c", "read line; echo \"got:$line\"; exit 4"]);

    terminal.write("hello relay\r").await.unwrap();

    read_until(&mut output, "got:hello relay").await;
    assert_eq!(exit_status(&terminal).await, exited(4));
}

#[tokio::test]
async fn control_c_interrupts_the_foreground_job_only() {
    let (terminal, mut output) = bash();
    read_until(&mut output, "$ ").await;

    // The step limit is shorter than the sleep, so each prompt that returns
    // shows the interrupt ended the job while the shell kept running.
    terminal.write("sleep 30\r").await.unwrap();
    sleep(Duration::from_millis(300)).await;
    terminal.write([0x03]).await.unwrap();
    terminal.write("echo alive:$((6 * 7))\r").await.unwrap();
    read_until(&mut output, "alive:42").await;
    assert_eq!(terminal.status(), TerminalStatus::Running);

    // A signal from the API reaches the inner foreground job the same way.
    terminal.write("sleep 30\r").await.unwrap();
    sleep(Duration::from_millis(300)).await;
    terminal.signal(TerminalSignal::Interrupt).await.unwrap();
    terminal.write("echo still:$((2 + 2))\r").await.unwrap();
    read_until(&mut output, "still:4").await;

    terminal.write("exit 0\r").await.unwrap();
    assert_eq!(exit_status(&terminal).await, exited(0));
}

#[tokio::test]
async fn control_z_fg_and_bg_manage_jobs() {
    let (terminal, mut output) = bash();
    read_until(&mut output, "$ ").await;
    terminal.write("set -o | grep '^monitor'\r").await.unwrap();
    read_until(&mut output, "on").await;

    terminal.write("sleep 30\r").await.unwrap();
    sleep(Duration::from_millis(300)).await;
    terminal.write([0x1a]).await.unwrap();
    read_until(&mut output, "Stopped").await;

    terminal.write("bg\r").await.unwrap();
    terminal.write("jobs\r").await.unwrap();
    read_until(&mut output, "Running").await;

    terminal.write("fg\r").await.unwrap();
    sleep(Duration::from_millis(300)).await;
    terminal.write([0x03]).await.unwrap();
    terminal
        .write("jobs; echo none:$((1 + 1))\r")
        .await
        .unwrap();
    let seen = read_until(&mut output, "none:2").await;
    let after_fg = seen.rsplit("fg").next().unwrap();
    assert!(!after_fg.contains("Running"), "{seen:?}");

    terminal.write("exit 0\r").await.unwrap();
    assert_eq!(exit_status(&terminal).await, exited(0));
}

#[tokio::test]
async fn resizes_reach_the_inner_pty() {
    let (terminal, mut output) = relayed("/bin/sh", &["-c", "stty size; read _; stty size"]);
    read_until(&mut output, "24 80").await;

    terminal
        .resize(TerminalSize {
            cols: 132,
            rows: 43,
        })
        .await
        .unwrap();
    terminal.write("\r").await.unwrap();

    read_until(&mut output, "43 132").await;
    assert_eq!(exit_status(&terminal).await, exited(0));
}

#[tokio::test]
async fn neovim_redraws_at_the_new_size() {
    let Some(nvim) = [
        "/opt/homebrew/bin/nvim",
        "/usr/local/bin/nvim",
        "/usr/bin/nvim",
    ]
    .into_iter()
    .find(|path| Path::new(path).exists()) else {
        eprintln!("skipped: Neovim is not installed");
        return;
    };
    let (terminal, mut output) = relayed(nvim, &["--clean", "-n"]);
    // Neovim clears the screen once it has drawn its first frame.
    read_until(&mut output, "\u{1b}[H").await;

    terminal
        .resize(TerminalSize {
            cols: 101,
            rows: 33,
        })
        .await
        .unwrap();
    terminal
        .write(":echo 'size=' . &columns . 'x' . &lines\r")
        .await
        .unwrap();
    read_until(&mut output, "size=101x33").await;

    terminal.write("\u{1b}:qa!\r").await.unwrap();
    assert_eq!(exit_status(&terminal).await, exited(0));
}

#[tokio::test]
async fn stops_background_jobs_when_the_shell_exits() {
    let (terminal, mut output) = relayed(
        "/bin/sh",
        &["-c", "sleep 300 & echo job=$!; read _; exit 3"],
    );
    let [job] = read_pids(&mut output, ["job"]).await;
    assert!(is_alive(job));

    terminal.write("\r").await.unwrap();

    assert_eq!(exit_status(&terminal).await, exited(3));
    wait_gone(job).await;
}

#[tokio::test]
async fn stops_the_session_when_pau_closes_the_terminal() {
    let (terminal, mut output) = bash();
    read_until(&mut output, "$ ").await;
    terminal
        .write("trap '' HUP; sleep 300 & echo job=$!; echo shell=$$\r")
        .await
        .unwrap();
    let [job, shell] = read_pids(&mut output, ["job", "shell"]).await;

    let status = timeout(STEP_LIMIT, terminal.close(Duration::from_secs(10)))
        .await
        .unwrap();

    // The relay exits on its own after the hangup frame, before the grace
    // period would have killed it.
    assert!(
        matches!(status, TerminalStatus::Exited { signal: None, .. }),
        "{status:?}"
    );
    wait_gone(shell).await;
    wait_gone(job).await;
}

#[tokio::test]
async fn a_relay_crash_hangs_up_the_shell_and_its_jobs() {
    let (terminal, mut output) = bash();
    read_until(&mut output, "$ ").await;
    terminal
        .write("sleep 300 & echo job=$!; echo shell=$$\r")
        .await
        .unwrap();
    let [job, shell] = read_pids(&mut output, ["job", "shell"]).await;

    // SAFETY: the terminal's child is the relay process.
    unsafe { libc::kill(terminal.process_id() as i32, libc::SIGKILL) };

    let status = exit_status(&terminal).await;
    assert!(
        matches!(
            status,
            TerminalStatus::Exited {
                signal: Some(_),
                ..
            }
        ),
        "{status:?}"
    );
    wait_gone(shell).await;
    wait_gone(job).await;
}

#[tokio::test]
async fn keystrokes_injected_by_the_shell_reach_only_the_inner_pty() {
    let directory = tempfile::tempdir().unwrap();
    let outer = directory.path().join("outer-tty");
    // The wrapper records Pau's PTY before it becomes the relay.
    let wrapper = format!(
        "tty > '{}'; exec '{RELAY}' {RELAY_ARGUMENT} /bin/sh -c '{}'",
        outer.display(),
        INNER_SCRIPT.replace('\'', "'\\''"),
    );
    let (terminal, mut output) = Terminal::spawn(TerminalCommand {
        program: "/bin/sh".to_owned(),
        args: vec!["-c".to_owned(), wrapper],
        cwd: std::env::temp_dir(),
        environment: vec![("PATH".into(), "/usr/bin:/bin:/opt/homebrew/bin".into())],
        size: SIZE,
        relay: true,
    })
    .unwrap();

    let seen = read_until(&mut output, "done").await;
    let outer = std::fs::read_to_string(&outer).unwrap().trim().to_owned();
    let terminals: Vec<_> = seen
        .lines()
        .filter_map(|line| line.trim().strip_prefix("fd-tty="))
        .collect();
    assert!(!terminals.is_empty(), "{seen:?}");
    assert!(
        terminals.iter().all(|name| *name != outer),
        "the shell holds Pau's PTY {outer}: {seen:?}"
    );
    if seen.contains("tiocsti=unavailable") {
        eprintln!("skipped injection: TIOCSTI is disabled on this host");
    } else {
        // The injected command ran in the inner shell. Had it reached Pau's
        // PTY, the relay would have dropped it as malformed frames.
        assert!(seen.contains("INJECTED-2"), "{seen:?}");
    }
    terminal.write("\r").await.unwrap();
    assert_eq!(exit_status(&terminal).await, exited(0));
}

/// Lists the terminals among the shell's descriptors, injects a command
/// into its controlling terminal, and lets the shell read and run it.
const INNER_SCRIPT: &str = r#"
for fd in 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19; do
  if [ -t "$fd" ]; then echo "fd-tty=$(tty <&"$fd")"; fi
done
if python3 -c 'import fcntl, termios
for byte in b"echo INJECTED-$((1 + 1))\n":
    fcntl.ioctl(0, termios.TIOCSTI, bytes([byte]))' 2>/dev/null; then
  read -r injected; eval "$injected"
else
  echo tiocsti=unavailable
fi
echo done
read _
"#;
