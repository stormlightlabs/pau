//! Sandboxed terminals under the real sandbox runtime.
//!
//! Each test resolves a terminal profile with `pau-core` and starts
//! sandbox-runtime's `srt` on a PTY owned by [`Terminal`]. On Linux `srt` runs
//! the `pau-term` relay inside the sandbox, and on macOS the shell itself. The tests need `srt`, Node, and ripgrep. They look for `srt`
//! in `PAU_SRT` and then in `packages/sandbox` after `pnpm install`, and skip
//! with a message when it is missing. Linux also needs Bubblewrap and socat.

use std::{
    collections::BTreeMap,
    ffi::OsString,
    fs,
    io::Read,
    net::TcpListener,
    path::{Path, PathBuf},
    time::Duration,
};

use pau_core::sandbox::{
    SandboxAdapter, SandboxExecutables, SandboxLaunchInput, SandboxSettings, TerminalSandboxInput,
    prepare_terminal_sandbox,
};
use pau_term::{
    Terminal, TerminalCommand, TerminalMode, TerminalOutput, TerminalSize, TerminalStatus,
    relay::RELAY_ARGUMENT,
};
use tokio::time::timeout;

/// Upper bound for one real-process step. Starting `srt` takes about a
/// second, so this only turns a hang into a failure.
const STEP_LIMIT: Duration = Duration::from_secs(30);

const SIZE: TerminalSize = TerminalSize { cols: 80, rows: 24 };

const RELAY: &str = env!("CARGO_BIN_EXE_pau-term");

struct Fixture {
    _directory: tempfile::TempDir,
    workspace: PathBuf,
    terminal: Terminal,
    output: TerminalOutput,
}

/// Finds `srt` and builds a `PATH` with it, Node, and ripgrep.
fn search_path() -> Option<OsString> {
    let srt = std::env::var_os("PAU_SRT").map(PathBuf::from).or_else(|| {
        let shim = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/sandbox/node_modules/.bin/srt");
        shim.exists().then_some(shim)
    })?;
    let directory = srt.parent()?.to_path_buf();
    let inherited = std::env::var_os("PATH").unwrap_or_default();
    std::env::join_paths(std::iter::once(directory).chain(std::env::split_paths(&inherited))).ok()
}

/// Starts a sandboxed shell in a fresh workspace, or returns `None` when this
/// host cannot run the sandbox. `script` receives a directory outside the
/// workspace and returns the shell script.
fn start(script: impl FnOnce(&Path) -> String) -> Option<Fixture> {
    let Some(path) = search_path() else {
        eprintln!("skipped: srt was not found; run pnpm install or set PAU_SRT");
        return None;
    };
    let executables = match SandboxExecutables::resolve(&path) {
        Ok(executables) => executables,
        Err(error) => {
            eprintln!("skipped: {error}");
            return None;
        }
    };
    if let Err(error) = executables.srt() {
        eprintln!("skipped: {error}");
        return None;
    }
    let directory = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(directory.path()).unwrap();
    let workspace = root.join("workspace");
    let outside = root.join("outside");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&outside).unwrap();
    let settings = SandboxSettings::workspace_write();
    let relay = [RELAY.to_owned(), RELAY_ARGUMENT.to_owned()];
    let command = ["/bin/sh".to_owned(), "-c".to_owned(), script(&outside)];
    let launch = prepare_terminal_sandbox(&TerminalSandboxInput {
        launch: SandboxLaunchInput {
            adapter: SandboxAdapter::Terminal,
            settings: &settings,
            workspace: &workspace,
            home: &root,
            session_directory: &root.join("session"),
            executables: &executables,
            runtime_roots: &[],
            tool_path: &path.to_string_lossy(),
            credential_environment: &BTreeMap::new(),
        },
        relay: &relay,
        command: &command,
        shell: "/bin/sh",
    })
    .unwrap();
    let (terminal, output) = Terminal::spawn(TerminalCommand {
        program: launch.program,
        args: launch.args,
        cwd: workspace.clone(),
        environment: launch.environment,
        size: SIZE,
        mode: if launch.relay {
            TerminalMode::Relay
        } else {
            TerminalMode::Sandboxed
        },
    })
    .unwrap();
    Some(Fixture {
        _directory: directory,
        workspace,
        terminal,
        output,
    })
}

async fn read_until(output: &mut TerminalOutput, needle: &str) -> String {
    let mut seen = Vec::new();
    timeout(STEP_LIMIT, async {
        while !String::from_utf8_lossy(&seen).contains(needle) {
            let chunk = output.recv().await.unwrap_or_else(|| {
                panic!(
                    "output ended before {needle:?}: {:?}",
                    String::from_utf8_lossy(&seen)
                )
            });
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

#[tokio::test]
async fn runs_the_shell_on_a_pty_under_the_sandbox() {
    let Some(mut fixture) = start(|_| "tty; stty size; read _; stty size; exit 5".into()) else {
        return;
    };
    let seen = read_until(&mut fixture.output, "24 80").await;
    assert!(seen.contains("/dev/tty"), "{seen:?}");

    fixture
        .terminal
        .resize(TerminalSize {
            cols: 132,
            rows: 43,
        })
        .await
        .unwrap();
    fixture.terminal.write("\r").await.unwrap();

    read_until(&mut fixture.output, "43 132").await;
    assert_eq!(
        exit_status(&fixture.terminal).await,
        TerminalStatus::Exited {
            exit_code: 5,
            signal: None
        }
    );
}

#[tokio::test]
async fn inherits_the_profile_limits() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let port = listener.local_addr().unwrap().port();
    let Some(mut fixture) = start(|outside| {
        // Cargo sets CARGO_MANIFEST_DIR for this test process. The sandbox
        // environment must not carry it, or anything else of Pau's.
        format!(
            r#"
echo inside > inside.txt && echo write-inside=ok
echo outside > '{}/outside.txt' 2>/dev/null && echo write-outside=ok
nc -z -w 2 127.0.0.1 {port} 2>/dev/null; echo network=$?
echo inherited=${{CARGO_MANIFEST_DIR:-unset}} term=$TERM
echo core=$(ulimit -c)
sleep 300 & echo job=$!
echo done
"#,
            outside.display()
        )
    }) else {
        return;
    };
    let seen = read_until(&mut fixture.output, "done").await;
    let status = exit_status(&fixture.terminal).await;

    assert!(seen.contains("write-inside=ok"), "{seen:?}");
    assert!(fixture.workspace.join("inside.txt").exists());
    assert!(!seen.contains("write-outside=ok"), "{seen:?}");
    assert!(!seen.contains("network=0"), "{seen:?}");
    let mut accepted = listener.accept();
    if let Ok((stream, _)) = &mut accepted {
        let mut byte = [0];
        let _ = stream.read(&mut byte);
    }
    assert!(
        accepted.is_err(),
        "the sandboxed shell reached a local port"
    );
    assert!(
        seen.contains("inherited=unset term=xterm-256color"),
        "{seen:?}"
    );
    assert!(seen.contains("core=0"), "{seen:?}");
    assert_eq!(
        status,
        TerminalStatus::Exited {
            exit_code: 0,
            signal: None
        }
    );
    let job: i32 = seen
        .split("job=")
        .nth(1)
        .and_then(|rest| rest.split(['\r', '\n']).next())
        .and_then(|pid| pid.trim().parse().ok())
        .expect("job pid");
    assert_gone(job, "the background job").await;
}

/// Injects keystrokes with `TIOCSTI` from inside the sandbox, into the
/// shell's own terminal and into a terminal the test owns outside it.
///
/// The probe must run: a missing `python3` or any error other than a refused
/// `ioctl` or `open` fails the test. Injection into the shell's own terminal
/// may succeed, and must then reach only the sandboxed shell. On Linux that
/// terminal is the relay's PTY inside the sandbox, and kernels that disable
/// `TIOCSTI` for unprivileged processes refuse it. On macOS it is Pau's PTY,
/// whose only reader is the sandboxed shell, and Seatbelt may refuse it. The
/// outside terminal must receive nothing. CI runs this test on Linux only;
/// the macOS path runs where a developer has `srt` installed.
#[tokio::test]
async fn keystrokes_injected_in_the_sandbox_reach_only_the_sandboxed_shell() {
    let (leader, follower) = open_pty();
    // SAFETY: `follower` is an open terminal descriptor.
    let other = unsafe { std::ffi::CStr::from_ptr(libc::ttyname(follower)) }
        .to_string_lossy()
        .into_owned();
    let probe = r#"
import errno, fcntl, os, sys, termios
# The probe passes through shell quoting, so it spells out no escapes.
NEWLINE = bytes([10])
def inject(fd, text):
    for byte in text:
        fcntl.ioctl(fd, termios.TIOCSTI, bytes([byte]))
def name(error):
    return errno.errorcode.get(error.errno, str(error.errno))
try:
    inject(0, b"echo INJECTED-$((1 + 1))" + NEWLINE)
    print("own=injected")
except OSError as error:
    print("own=refused:" + name(error))
try:
    fd = os.open(sys.argv[1], os.O_RDWR | os.O_NOCTTY)
except OSError as error:
    print("other=closed:" + name(error))
else:
    try:
        inject(fd, b"OUTSIDE" + NEWLINE)
        print("other=injected")
    except OSError as error:
        print("other=refused:" + name(error))
print("probe=ran")
"#;
    let Some(mut fixture) = start(|_| {
        format!(
            r#"
for fd in 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19; do
  if [ -t "$fd" ]; then echo "fd-tty=$(tty <&"$fd")"; fi
done
result=$(python3 -c '{probe}' '{other}' 2>&1)
echo "$result"
case "$result" in *own=injected*) read -r injected; eval "$injected" ;; esac
echo done
"#
        )
    }) else {
        // SAFETY: both descriptors are open and closed only here.
        unsafe {
            libc::close(leader);
            libc::close(follower);
        }
        return;
    };
    let pau_tty = pty_name(fixture.terminal.process_id());
    let seen = read_until(&mut fixture.output, "done").await;
    exit_status(&fixture.terminal).await;
    // Injected bytes would wait in the outside terminal's input queue.
    // SAFETY: `follower` is open, and the buffer is valid for its length.
    let mut queued = [0u8; 64];
    let read = unsafe {
        libc::fcntl(follower, libc::F_SETFL, libc::O_NONBLOCK);
        libc::read(follower, queued.as_mut_ptr().cast(), queued.len())
    };
    // SAFETY: both descriptors are open and closed only here.
    unsafe {
        libc::close(leader);
        libc::close(follower);
    }

    assert!(seen.contains("probe=ran"), "the probe failed: {seen:?}");
    let names: Vec<_> = seen
        .lines()
        .filter_map(|line| line.trim().strip_prefix("fd-tty="))
        .collect();
    assert!(!names.is_empty(), "{seen:?}");
    if let Some(pau_tty) = &pau_tty {
        assert!(
            names.iter().all(|name| name != pau_tty),
            "the sandboxed shell holds Pau's PTY {pau_tty}: {seen:?}"
        );
    }
    if seen.contains("own=injected") {
        assert!(seen.contains("INJECTED-2"), "{seen:?}");
    } else {
        assert!(seen.contains("own=refused:"), "{seen:?}");
    }
    assert!(!seen.contains("other=injected"), "{seen:?}");
    assert!(
        read <= 0,
        "the outside terminal received {:?}",
        String::from_utf8_lossy(&queued[..read as usize])
    );
}

/// Opens a PTY pair that stands for one of the operator's other terminals.
fn open_pty() -> (i32, i32) {
    let (mut leader, mut follower) = (0, 0);
    // SAFETY: both out-pointers are valid, and the name, settings, and size
    // pointers may be null.
    let opened = unsafe {
        libc::openpty(
            &mut leader,
            &mut follower,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    assert_eq!(opened, 0, "openpty failed");
    (leader, follower)
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

#[tokio::test]
async fn cannot_open_other_terminals() {
    // Another terminal, such as one of the operator's, with typed input
    // waiting to be read.
    let (leader, follower) = open_pty();
    // SAFETY: `follower` is an open terminal descriptor.
    let other = unsafe { std::ffi::CStr::from_ptr(libc::ttyname(follower)) }
        .to_string_lossy()
        .into_owned();
    // SAFETY: the buffer is valid for its length.
    unsafe { libc::write(leader, b"typed-secret\n".as_ptr().cast(), 13) };

    let Some(mut fixture) = start(|_| {
        format!(
            r#"
head -c 4 '{other}' 2>/dev/null && echo read-other=ok
echo injected 2>/dev/null > '{other}' && echo write-other=ok
stty size
set -m; sleep 0 & fg %1 >/dev/null && echo job-control=ok
echo done
"#
        )
    }) else {
        return;
    };
    let seen = read_until(&mut fixture.output, "done").await;
    // SAFETY: both descriptors are open and closed only here.
    unsafe {
        libc::close(leader);
        libc::close(follower);
    }

    assert!(!seen.contains("read-other=ok"), "{seen:?}");
    assert!(!seen.contains("typed-secret"), "{seen:?}");
    assert!(!seen.contains("write-other=ok"), "{seen:?}");
    // The shell's own terminal still works.
    assert!(seen.contains("24 80"), "{seen:?}");
    assert!(seen.contains("job-control=ok"), "{seen:?}");
    exit_status(&fixture.terminal).await;
}

#[tokio::test]
async fn stops_nohup_jobs_when_the_shell_or_its_parent_goes() {
    // On Linux the shell's parent is the relay, inside the sandbox. On macOS
    // it is outside, and Seatbelt refuses the signal, so the shell exits.
    let Some(mut fixture) = start(|_| {
        "trap '' HUP; nohup sleep 9999 >/dev/null 2>&1 & echo job=$! ready; \
         kill -9 $PPID 2>/dev/null; exit 0"
            .into()
    }) else {
        return;
    };
    let seen = read_until(&mut fixture.output, "ready").await;
    let job: i32 = seen
        .split("job=")
        .nth(1)
        .and_then(|rest| rest.split(' ').next())
        .and_then(|pid| pid.parse().ok())
        .expect("job pid");
    exit_status(&fixture.terminal).await;
    assert_gone(job, "the nohup job").await;
}

#[tokio::test]
async fn stops_a_chain_that_forks_and_exits() {
    // Each process forks and exits at once, so no process ID lasts long
    // enough to be listed and then killed. Every 16th writes its process ID
    // to `beat` in the workspace, which shows whether any still runs.
    let Some(mut fixture) = start(|_| {
        "perl -e '$SIG{HUP}=q(IGNORE); \
         while(1){exit if fork; ++$n % 16 or open(my $f, q(>), q(beat)) and print $f $$}' & \
         echo ready; read _; exit 0"
            .into()
    }) else {
        return;
    };
    let beat = fixture.workspace.join("beat");
    read_until(&mut fixture.output, "ready").await;
    assert!(beating(&beat).await, "the chain did not start");
    fixture.terminal.write("\r").await.unwrap();
    exit_status(&fixture.terminal).await;

    assert!(!beating(&beat).await, "the chain outlived the terminal");
}

/// Whether some process rewrites `beat` within a short wait.
async fn beating(beat: &Path) -> bool {
    let first = fs::read(beat).ok();
    tokio::time::sleep(Duration::from_millis(300)).await;
    fs::read(beat).ok() != first
}

/// Records the resident memory of one terminal's `srt` process. Run with
/// `--nocapture` to see the figure.
#[tokio::test]
async fn measures_the_srt_process() {
    let Some(mut fixture) = start(|_| "echo ready; read _".into()) else {
        return;
    };
    read_until(&mut fixture.output, "ready").await;
    let pid = fixture.terminal.process_id().to_string();
    let output = std::process::Command::new("ps")
        .args(["-o", "rss=,comm=", "-p", &pid])
        .output()
        .unwrap();
    let report = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    eprintln!("srt process {pid}: {report} (resident KiB, command)");
    let rss: u64 = report
        .split_whitespace()
        .next()
        .and_then(|value| value.parse().ok())
        .expect("ps reports resident memory");
    assert!(rss > 0);
    fixture.terminal.write("\r").await.unwrap();
    exit_status(&fixture.terminal).await;
}

/// Names the controlling terminal of `pid`, which is Pau's PTY for `srt`.
fn pty_name(pid: u32) -> Option<String> {
    let output = std::process::Command::new("ps")
        .args(["-o", "tty=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    let name = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    (!name.is_empty() && name != "??").then(|| format!("/dev/{name}"))
}
