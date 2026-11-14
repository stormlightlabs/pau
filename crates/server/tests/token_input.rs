//! How the browser development server receives its API token.

use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const TOKEN: &str = "0123456789abcdef0123456789abcdef";

fn server() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_pau-server"));
    command.env_remove("PAU_API_TOKEN");
    command
}

#[test]
fn refuses_a_token_in_the_launch_environment() {
    let output = server()
        .arg("--token-stdin")
        .env("PAU_API_TOKEN", TOKEN)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("must not be set in the environment"),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn serves_with_a_token_read_from_standard_input() {
    let directory = tempfile::tempdir().unwrap();
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let mut child = server()
        .arg("--token-stdin")
        .env("PAU_SERVER_ADDR", format!("127.0.0.1:{port}"))
        .env("PAU_DATABASE_PATH", directory.path().join("pau.db"))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    writeln!(child.stdin.take().unwrap(), "{TOKEN}").unwrap();

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
    child.wait().unwrap();
    assert_eq!(status, "HTTP/1.1 200 OK");
}
