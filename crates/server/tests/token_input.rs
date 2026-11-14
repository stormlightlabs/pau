//! How the browser development server receives its API token.

use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const TOKEN: &str = "0123456789abcdef0123456789abcdef";

/// A valid token the server under test does not hold, so it must reject it.
const OTHER: &str = "fedcba9876543210fedcba9876543210";

const WARNING: &str = "warning: PAU_API_TOKEN came from the environment";

/// A server command that runs in `directory`, so it loads only the `.env` a
/// test writes there, with no token in its environment.
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

/// Sends a health request with `token` and returns the response status line,
/// or `None` while the server is not listening.
fn request(port: u16, token: &str) -> Option<String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).ok()?;
    write!(
        stream,
        "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    Some(response.lines().next().unwrap_or_default().to_owned())
}

/// Starts `command`, writes `stdin` when given, checks that the server accepts
/// `TOKEN` and rejects `OTHER`, stops it, and returns its standard error.
fn serve(mut command: Command, stdin: Option<&str>) -> String {
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    command.env("PAU_SERVER_ADDR", format!("127.0.0.1:{port}"));
    command.stdin(if stdin.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    let mut child = command.spawn().unwrap();
    if let Some(input) = stdin {
        writeln!(child.stdin.take().unwrap(), "{input}").unwrap();
    }

    let deadline = Instant::now() + Duration::from_secs(15);
    let status = loop {
        if let Some(status) = request(port, TOKEN) {
            break status;
        }
        assert!(Instant::now() < deadline, "the server did not start");
        assert!(child.try_wait().unwrap().is_none(), "the server exited");
        thread::sleep(Duration::from_millis(50));
    };
    let rejected = request(port, OTHER);
    child.kill().unwrap();
    let output = child.wait_with_output().unwrap();
    assert_eq!(status, "HTTP/1.1 200 OK");
    assert_eq!(rejected.as_deref(), Some("HTTP/1.1 401 Unauthorized"));
    String::from_utf8_lossy(&output.stderr).into_owned()
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
}

#[test]
fn ignores_an_empty_exported_token() {
    let directory = directory_with_env_file();
    let mut command = server(directory.path());
    command.env("PAU_API_TOKEN", "");
    let stderr = serve(command, None);
    assert!(!stderr.contains(WARNING), "{stderr}");
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
    let output = server(directory.path())
        .env("PAU_API_TOKEN", std::ffi::OsStr::from_bytes(b"\xff\xfe"))
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("PAU_API_TOKEN is not valid UTF-8"),
        "{stderr}"
    );
}
