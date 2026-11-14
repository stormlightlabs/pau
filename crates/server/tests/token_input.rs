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

/// Starts `command`, writes `stdin` when given, checks that the server answers
/// a request that carries `TOKEN`, stops it, and returns its standard error.
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
        if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) {
            write!(
                stream,
                "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {TOKEN}\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            break response.lines().next().unwrap_or_default().to_owned();
        }
        assert!(Instant::now() < deadline, "the server did not start");
        assert!(child.try_wait().unwrap().is_none(), "the server exited");
        thread::sleep(Duration::from_millis(50));
    };
    child.kill().unwrap();
    let output = child.wait_with_output().unwrap();
    assert_eq!(status, "HTTP/1.1 200 OK");
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

#[test]
fn serves_with_a_token_from_the_env_file() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join(".env"),
        format!("PAU_API_TOKEN={TOKEN}\n"),
    )
    .unwrap();
    let stderr = serve(server(directory.path()), None);
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
