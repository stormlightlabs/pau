//! How the browser development server receives its API token.

use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpStream},
    path::Path,
    process::{Child, ChildStdout, Command, ExitStatus, Stdio},
    sync::mpsc::{self, RecvTimeoutError},
    thread,
    time::{Duration, Instant},
};

const TOKEN: &str = "0123456789abcdef0123456789abcdef";

/// A valid token the server under test does not hold, so it must reject it.
const OTHER: &str = "fedcba9876543210fedcba9876543210";

const WARNING: &str = "warning: PAU_API_TOKEN came from the environment";

const NOTE: &str = "note: using PAU_API_TOKEN from .env";

/// How long a server may take to start, answer or exit before the test fails.
const DEADLINE: Duration = Duration::from_secs(30);

/// A server command that runs in `directory`, with no token in its
/// environment. The server reads `.env` from that directory only, so a
/// `.env` above the temporary directory does not reach it.
fn server(directory: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_pau-server"));
    command
        .current_dir(directory)
        .env_remove("PAU_API_TOKEN")
        .env("PAU_DATABASE_PATH", directory.join("pau.db"))
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    command
}

/// A running server, killed when dropped so a failed assertion never leaves
/// it running.
struct Running(Child);

impl Running {
    /// Kills the server and returns its standard error.
    fn stop(mut self) -> String {
        let _ = self.0.kill();
        let mut stderr = String::new();
        self.0
            .stderr
            .take()
            .unwrap()
            .read_to_string(&mut stderr)
            .unwrap();
        stderr
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Sends a health request with `token` and returns the response status line.
fn request(port: u16, token: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream.set_read_timeout(Some(DEADLINE)).unwrap();
    write!(
        stream,
        "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    response.lines().next().unwrap_or_default().to_owned()
}

/// Starts `command`, writes `stdin` when given, checks that the server accepts
/// `TOKEN` and rejects `OTHER`, stops it, and returns its standard error.
///
/// The server binds port 0 and the test reads the port it got from its
/// `server.started` log line. Picking a free port in the test and passing it
/// on would leave the port unbound until the server starts, and another
/// process's short-lived listener could take it in that window. A request
/// sent to that listener is reset when it closes.
fn serve(mut command: Command, stdin: Option<&str>) -> String {
    command
        .env("PAU_SERVER_ADDR", "127.0.0.1:0")
        .env("RUST_LOG", "pau_server=info")
        .stdout(Stdio::piped());
    command.stdin(if stdin.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    let mut child = Running(command.spawn().unwrap());
    if let Some(input) = stdin {
        writeln!(child.0.stdin.take().unwrap(), "{input}").unwrap();
    }

    let port = started_port(child.0.stdout.take().unwrap());
    let status = request(port, TOKEN);
    let rejected = request(port, OTHER);
    let stderr = child.stop();
    assert_eq!(status, "HTTP/1.1 200 OK");
    assert_eq!(rejected, "HTTP/1.1 401 Unauthorized");
    stderr
}

/// Reads the server's JSON log from `stdout` until its `server.started` event
/// and returns the port in it. The server logs that event after it binds its
/// listener, so requests sent afterwards reach it.
///
/// A thread reads the log so the wait can end at the deadline, and keeps
/// draining it until the server exits so the server never blocks on a full
/// pipe.
fn started_port(stdout: ChildStdout) -> u16 {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { return };
            let Ok(record) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            let fields = &record["fields"];
            if fields["event"] == "server.started"
                && let Some(address) = fields["address"].as_str()
            {
                let _ = sender.send(address.to_owned());
            }
        }
    });
    match receiver.recv_timeout(DEADLINE) {
        Ok(address) => address
            .parse::<SocketAddr>()
            .unwrap_or_else(|error| {
                panic!("the server logged an invalid address {address:?}: {error}")
            })
            .port(),
        Err(RecvTimeoutError::Timeout) => panic!("the server did not start"),
        Err(RecvTimeoutError::Disconnected) => panic!("the server exited before it started"),
    }
}

/// Runs `command`, which must exit on its own within the deadline, and
/// returns its status and standard error.
fn exit(mut command: Command) -> (ExitStatus, String) {
    let mut child = Running(command.stdin(Stdio::null()).spawn().unwrap());
    let deadline = Instant::now() + DEADLINE;
    let status = loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            break status;
        }
        assert!(Instant::now() < deadline, "the server did not exit");
        thread::sleep(Duration::from_millis(50));
    };
    (status, child.stop())
}

#[test]
fn serves_with_a_token_read_from_standard_input() {
    let directory = tempfile::tempdir().unwrap();
    let mut command = server(directory.path());
    command.arg("--token-stdin");
    let stderr = serve(command, Some(TOKEN));
    assert!(!stderr.contains(WARNING), "{stderr}");
}

/// Writes `TOKEN` to a `.env` file in a new directory.
fn directory_with_env_file() -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join(".env"),
        format!("PAU_API_TOKEN={TOKEN}\n"),
    )
    .unwrap();
    directory
}

#[test]
fn serves_with_a_token_from_the_env_file() {
    let directory = directory_with_env_file();
    let stderr = serve(server(directory.path()), None);
    assert!(!stderr.contains(WARNING), "{stderr}");
}

#[test]
fn prefers_the_env_file_to_an_exported_token() {
    let directory = directory_with_env_file();
    let mut command = server(directory.path());
    command.env("PAU_API_TOKEN", OTHER);
    let stderr = serve(command, None);
    assert!(!stderr.contains(WARNING), "{stderr}");
    assert_eq!(stderr.matches(NOTE).count(), 1, "{stderr}");
}

#[test]
fn ignores_an_empty_exported_token() {
    let directory = directory_with_env_file();
    let mut command = server(directory.path());
    command.env("PAU_API_TOKEN", "");
    let stderr = serve(command, None);
    assert!(!stderr.contains(WARNING), "{stderr}");
    assert!(!stderr.contains(NOTE), "{stderr}");
}

#[test]
fn ignores_an_env_file_in_a_parent_directory() {
    let parent = tempfile::tempdir().unwrap();
    std::fs::write(
        parent.path().join(".env"),
        format!("PAU_API_TOKEN={OTHER}\n"),
    )
    .unwrap();
    let directory = parent.path().join("child");
    std::fs::create_dir(&directory).unwrap();
    let mut command = server(&directory);
    command.env("PAU_API_TOKEN", TOKEN);
    let stderr = serve(command, None);
    assert_eq!(stderr.matches(WARNING).count(), 1, "{stderr}");
}

#[test]
fn reports_a_malformed_env_file_without_its_content() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join(".env"),
        format!("# settings\nPAU_API_TOKEN={TOKEN} x\n"),
    )
    .unwrap();
    let (status, stderr) = exit(server(directory.path()));
    assert!(!status.success());
    assert!(
        stderr.contains("could not parse .env at line 2 (PAU_API_TOKEN)"),
        "{stderr}"
    );
    assert!(!stderr.contains(TOKEN), "{stderr}");
}

#[test]
fn warns_once_about_a_token_in_the_launch_environment() {
    let directory = tempfile::tempdir().unwrap();
    let mut command = server(directory.path());
    command.env("PAU_API_TOKEN", TOKEN);
    let stderr = serve(command, None);
    assert_eq!(stderr.matches(WARNING).count(), 1, "{stderr}");
    assert!(stderr.contains("--token-stdin"), "{stderr}");
}

#[cfg(unix)]
#[test]
fn refuses_an_exported_token_that_is_not_utf8() {
    use std::os::unix::ffi::OsStrExt;
    let directory = tempfile::tempdir().unwrap();
    let mut command = server(directory.path());
    command.env("PAU_API_TOKEN", std::ffi::OsStr::from_bytes(b"\xff\xfe"));
    let (status, stderr) = exit(command);
    assert!(!status.success());
    assert!(
        stderr.contains("PAU_API_TOKEN is not valid UTF-8"),
        "{stderr}"
    );
}
