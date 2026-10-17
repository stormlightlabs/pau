//! PTY behavior on the host platform. These tests run real `/bin/sh` children.

use std::time::Duration;

use pau_term::{
    Terminal, TerminalCommand, TerminalError, TerminalOutput, TerminalSignal, TerminalSize,
    TerminalStatus,
};
use tokio::time::timeout;

/// Upper bound for one real-process step. It only turns a hang into a failure.
const STEP_LIMIT: Duration = Duration::from_secs(20);

const SIZE: TerminalSize = TerminalSize { cols: 80, rows: 24 };

fn sh(script: &str) -> (Terminal, TerminalOutput) {
    Terminal::spawn(TerminalCommand {
        program: "/bin/sh".to_owned(),
        args: vec!["-c".to_owned(), script.to_owned()],
        cwd: std::env::temp_dir(),
        size: SIZE,
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
            .unwrap();
    }
    let last = TerminalSize {
        cols: 132,
        rows: 43,
    };
    terminal.resize(last).unwrap();
    terminal.write("\r").await.unwrap();

    read_until(&mut output, "43 132").await;
    assert_eq!(terminal.size(), last);
    assert!(matches!(
        terminal.resize(TerminalSize { cols: 0, rows: 10 }),
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
    terminal.signal(TerminalSignal::Kill).unwrap();
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
    terminal.signal(TerminalSignal::Interrupt).unwrap();
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
        size: SIZE,
    });
    assert!(matches!(missing, Err(TerminalError::Spawn(_))));
}
