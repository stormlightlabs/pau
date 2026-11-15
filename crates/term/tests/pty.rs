//! PTY behavior on the host platform. These tests run real `/bin/sh` children.

use std::time::Duration;

use pau_term::{
    Terminal, TerminalCommand, TerminalError, TerminalMode, TerminalOutput, TerminalSignal,
    TerminalSize, TerminalStatus,
};
use tokio::time::timeout;

/// Upper bound for one real-process step. It only turns a hang into a failure.
const STEP_LIMIT: Duration = Duration::from_secs(20);

const SIZE: TerminalSize = TerminalSize { cols: 80, rows: 24 };

fn sh(script: &str) -> (Terminal, TerminalOutput) {
    sh_in(TerminalMode::Normal, script)
}

fn sh_in(mode: TerminalMode, script: &str) -> (Terminal, TerminalOutput) {
    Terminal::spawn(TerminalCommand {
        program: "/bin/sh".to_owned(),
        args: vec!["-c".to_owned(), script.to_owned()],
        cwd: std::env::temp_dir(),
        environment: Vec::new(),
        size: SIZE,
        mode,
    })
    .unwrap()
}

/// Reads output until it contains `needle` and returns everything read.
async fn read_until(output: &mut TerminalOutput, needle: &str) -> String {
    timeout(STEP_LIMIT, read_until_unbounded(output, needle))
        .await
        .unwrap_or_else(|_| panic!("timed out waiting for {needle:?}"))
}

/// Reads like [`read_until`] without a deadline, for paused-clock tests where
/// an idle runtime would fire any timer immediately.
async fn read_until_unbounded(output: &mut TerminalOutput, needle: &str) -> String {
    let mut seen = Vec::new();
    while !String::from_utf8_lossy(&seen).contains(needle) {
        let chunk = output
            .recv()
            .await
            .unwrap_or_else(|| panic!("output ended before {needle:?}"));
        seen.extend_from_slice(&chunk);
    }
    String::from_utf8_lossy(&seen).into_owned()
}

async fn drain(output: &mut TerminalOutput) -> Vec<u8> {
    let mut seen = Vec::new();
    timeout(STEP_LIMIT, async {
        while let Some(chunk) = output.recv().await {
            seen.extend_from_slice(&chunk);
        }
    })
    .await
    .expect("output did not end");
    seen
}

#[tokio::test]
async fn round_trips_input_and_output() {
    let (terminal, mut output) = sh("read line; echo \"got:$line\"; echo $((40 + 2))");

    terminal.write("hello pty\r").await.unwrap();
    let seen = read_until(&mut output, "42").await;

    assert!(seen.contains("got:hello pty"), "{seen:?}");
    assert_eq!(
        timeout(STEP_LIMIT, terminal.exit().wait()).await.unwrap(),
        TerminalStatus::Exited {
            exit_code: 0,
            signal: None
        }
    );
}

#[tokio::test]
async fn applies_the_last_of_many_rapid_resizes() {
    let (terminal, mut output) = sh("read _; stty size");

    for step in 1..=200_u16 {
        terminal
            .resize(TerminalSize {
                cols: 40 + step % 100,
                rows: 10 + step % 50,
            })
            .await
            .unwrap();
    }
    let last = TerminalSize {
        cols: 132,
        rows: 43,
    };
    terminal.resize(last).await.unwrap();
    terminal.write("\r").await.unwrap();

    read_until(&mut output, "43 132").await;
    assert_eq!(terminal.size(), last);
    assert!(matches!(
        terminal.resize(TerminalSize { cols: 0, rows: 10 }).await,
        Err(TerminalError::InvalidSize)
    ));
    assert_eq!(terminal.size(), last);
}

#[tokio::test]
async fn reports_output_and_status_after_process_exit() {
    let (terminal, mut output) = sh("printf finished; exit 3");

    let seen = drain(&mut output).await;
    let status = timeout(STEP_LIMIT, terminal.exit().wait()).await.unwrap();

    assert!(String::from_utf8_lossy(&seen).contains("finished"));
    assert_eq!(
        status,
        TerminalStatus::Exited {
            exit_code: 3,
            signal: None
        }
    );
    assert_eq!(terminal.status(), status);
    // Signals after exit must not reach a process that reused the ID.
    terminal.signal(TerminalSignal::Kill).await.unwrap();
}

#[tokio::test]
async fn delivers_noisy_output_without_loss() {
    const BYTES: usize = 4 * 1024 * 1024;
    let (terminal, mut output) = sh(&format!("head -c {BYTES} /dev/zero | tr '\\0' x"));

    let seen = drain(&mut output).await;

    assert_eq!(seen.iter().filter(|byte| **byte == b'x').count(), BYTES);
    assert!(matches!(
        timeout(STEP_LIMIT, terminal.exit().wait()).await.unwrap(),
        TerminalStatus::Exited { exit_code: 0, .. }
    ));
}

#[tokio::test]
async fn interrupts_the_foreground_process_group() {
    let (terminal, mut output) =
        sh("trap 'echo caught; exit 7' INT; echo ready; while :; do sleep 1; done");

    read_until(&mut output, "ready").await;
    terminal.signal(TerminalSignal::Interrupt).await.unwrap();
    read_until(&mut output, "caught").await;

    assert_eq!(
        timeout(STEP_LIMIT, terminal.exit().wait()).await.unwrap(),
        TerminalStatus::Exited {
            exit_code: 7,
            signal: None
        }
    );
}

#[tokio::test]
async fn close_hangs_up_a_cooperative_shell() {
    let (terminal, mut output) = sh("echo ready; while :; do sleep 1; done");

    read_until(&mut output, "ready").await;
    let status = timeout(STEP_LIMIT, terminal.close(STEP_LIMIT))
        .await
        .unwrap();

    assert!(
        matches!(
            &status,
            TerminalStatus::Exited {
                signal: Some(_),
                ..
            }
        ),
        "{status:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn close_kills_a_child_that_ignores_hangup_and_terminate() {
    // Ignored dispositions survive exec, so `sleep` ignores them as well.
    let (terminal, mut output) = sh("trap '' HUP TERM; echo ready; while :; do sleep 1; done");
    read_until_unbounded(&mut output, "ready").await;

    // The paused clock reaches the grace deadline as soon as the runtime is
    // idle, so this exercises the forced path without waiting.
    let status = terminal.close(Duration::from_secs(30)).await;

    assert!(
        matches!(
            &status,
            TerminalStatus::Exited {
                signal: Some(_),
                ..
            }
        ),
        "{status:?}"
    );
    assert!(matches!(
        terminal.write("ignored").await,
        Ok(()) | Err(TerminalError::Closed)
    ));
}

#[tokio::test]
async fn dropping_a_terminal_kills_its_child() {
    let (terminal, mut output) = sh("trap '' HUP TERM; echo ready; while :; do sleep 1; done");
    read_until(&mut output, "ready").await;
    let mut exit = terminal.exit();

    drop(terminal);

    let status = timeout(STEP_LIMIT, exit.wait()).await.unwrap();
    assert!(
        matches!(
            &status,
            TerminalStatus::Exited {
                signal: Some(_),
                ..
            }
        ),
        "{status:?}"
    );
}

/// Waits until `pid` no longer exists, or fails after [`STEP_LIMIT`].
async fn assert_gone(pid: i32, what: &str) {
    let deadline = std::time::Instant::now() + STEP_LIMIT;
    // SAFETY: signal 0 only checks that the process exists.
    while unsafe { libc::kill(pid, 0) } == 0 {
        assert!(
            std::time::Instant::now() < deadline,
            "{what} {pid} survived"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// Reads the process ID the script printed after `job=`.
fn job_pid(seen: &str) -> i32 {
    seen.split("job=")
        .nth(1)
        .and_then(|rest| rest.split(' ').next())
        .and_then(|pid| pid.parse().ok())
        .expect("job pid")
}

#[tokio::test]
async fn a_sandboxed_terminal_kills_jobs_left_in_its_session() {
    // The ignored hangup is inherited, so the job survives the shell's exit
    // without racing `nohup`.
    let (terminal, mut output) = sh_in(
        TerminalMode::Sandboxed,
        "trap '' HUP; nohup sleep 9999 >/dev/null 2>&1 & echo job=$! ready; exit 0",
    );
    let job = job_pid(&read_until(&mut output, "ready").await);
    timeout(STEP_LIMIT, terminal.exit().wait()).await.unwrap();

    assert_gone(job, "the sandboxed shell's nohup job").await;
}

#[tokio::test]
async fn a_sandboxed_terminal_stops_a_chain_that_forks_and_exits() {
    let directory = tempfile::tempdir().unwrap();
    let beat = directory.path().join("beat");
    let (terminal, mut output) = sh_in(
        TerminalMode::Sandboxed,
        &format!("{} & echo ready; read _; exit 0", fork_chain(&beat)),
    );
    read_until(&mut output, "ready").await;
    assert!(beating(&beat).await, "the chain did not start");
    terminal.write("\r").await.unwrap();
    timeout(STEP_LIMIT, terminal.exit().wait()).await.unwrap();

    assert!(!beating(&beat).await, "the chain outlived the terminal");
    let left = std::process::Command::new("pgrep")
        .args(["-s", &terminal.process_id().to_string()])
        .output()
        .unwrap();
    assert!(
        left.stdout.is_empty(),
        "processes left in the session: {}",
        String::from_utf8_lossy(&left.stdout)
    );
}

/// A shell command for a chain of processes that each fork and exit at once,
/// so no process ID lasts long enough to be listed and then killed. Every
/// 16th process writes its process ID to `beat`, because a fast chain also
/// outruns tools such as `pgrep -f` that read each process after listing it.
fn fork_chain(beat: &std::path::Path) -> String {
    format!(
        "perl -e '$SIG{{HUP}}=q(IGNORE); \
         while(1){{exit if fork; ++$n % 16 or open(my $f, q(>), $ARGV[0]) and print $f $$}}' '{}'",
        beat.display()
    )
}

/// Whether some process rewrites `beat` within a short wait.
async fn beating(beat: &std::path::Path) -> bool {
    let first = std::fs::read(beat).ok();
    tokio::time::sleep(Duration::from_millis(300)).await;
    std::fs::read(beat).ok() != first
}

#[test]
fn rejects_empty_dimensions_and_missing_programs() {
    let empty = Terminal::spawn(TerminalCommand {
        size: TerminalSize { cols: 80, rows: 0 },
        ..TerminalCommand::shell(std::env::temp_dir(), SIZE)
    });
    assert!(matches!(empty, Err(TerminalError::InvalidSize)));

    let missing = Terminal::spawn(TerminalCommand {
        program: "/nonexistent/pau-terminal-test".to_owned(),
        args: Vec::new(),
        cwd: std::env::temp_dir(),
        environment: Vec::new(),
        size: SIZE,
        mode: TerminalMode::Normal,
    });
    assert!(matches!(missing, Err(TerminalError::Spawn(_))));
}
