#![cfg(unix)]

use pau_agent::{
    AgentEventKind, AgentSessionStatus, ClaudeBridgeDecodeError, ClaudeBridgeFrame,
    ClaudeBridgeOutput, ClaudeBridgeShutdownTimeouts, ClaudeEventPayload, ClaudeSession,
    StartClaudeBridgeOptions, decode_claude_bridge_diagnostic, decode_claude_bridge_frame,
    project_claude_event,
};
use std::ffi::OsString;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[test]
fn consumes_the_bridge_package_protocol_fixtures() {
    let fixtures = bridge_root().join("test/fixtures");
    let protocol = fs::read_to_string(fixtures.join("protocol.jsonl")).unwrap();
    let decoded: Vec<_> = protocol.lines().map(decode_claude_bridge_frame).collect();

    assert!(matches!(
        decoded[0],
        Err(ClaudeBridgeDecodeError::Malformed(_))
    ));
    assert!(matches!(decoded[1], Ok(ClaudeBridgeFrame::Response(_))));
    assert!(matches!(decoded[2], Ok(ClaudeBridgeFrame::Response(_))));
    assert!(matches!(decoded[3], Ok(ClaudeBridgeFrame::Event(_))));
    let event = match &decoded[4] {
        Ok(ClaudeBridgeFrame::Event(event)) => event,
        other => panic!("expected text event, got {other:?}"),
    };
    let projected = project_claude_event(event);
    assert_eq!(projected.kind, AgentEventKind::TextDelta);
    assert_eq!(
        projected.payload,
        ClaudeEventPayload::TextDelta {
            text: "Done".to_owned()
        }
    );

    let recovery = fs::read_to_string(fixtures.join("recovery.jsonl")).unwrap();
    let mut records = recovery.lines().map(decode_claude_bridge_frame);
    assert_eq!(
        records.next().unwrap(),
        Err(ClaudeBridgeDecodeError::UnsupportedVersion(2))
    );
    assert!(matches!(
        records.next().unwrap(),
        Err(ClaudeBridgeDecodeError::Malformed(_))
    ));
    assert!(matches!(
        records.next().unwrap(),
        Err(ClaudeBridgeDecodeError::Malformed(_))
    ));
    assert!(matches!(
        records.next().unwrap(),
        Ok(ClaudeBridgeFrame::Event(_))
    ));

    let diagnostics = fs::read_to_string(fixtures.join("diagnostics.jsonl")).unwrap();
    let decoded: Vec<_> = diagnostics
        .lines()
        .map(|line| decode_claude_bridge_diagnostic(line).unwrap())
        .collect();
    assert_eq!(decoded.len(), 2);
    assert_eq!(decoded[1].message, "fixture warning");
}

#[tokio::test]
async fn runs_a_fake_bridge_session_through_the_adapter() {
    let temporary = tempfile::tempdir().unwrap();
    let launcher = temporary.path().join("fake bridge host");
    fs::write(
        &launcher,
        r#"#!/bin/sh
while IFS= read -r line; do
    id=$(printf '%s' "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
    case "$line" in
        *'"command":"status"'*)
            printf '{"version":1,"type":"response","id":"%s","ok":true,"result":{"capabilities":{"prompt":true,"interrupt":true,"stop":true},"nativeSessionId":null}}\n' "$id"
            ;;
        *'"command":"prompt"'*)
            printf '{"version":1,"type":"response","id":"%s","ok":true,"result":{"accepted":true}}\n' "$id"
            printf '{"version":1,"type":"event","sequence":0,"event":"text.delta","payload":{"text":"fixture output"}}\n'
            printf '{"version":1,"type":"event","sequence":1,"event":"tool.started","payload":{"id":"tool-1","name":"Read","input":{"path":"README.md"}}}\n'
            printf '{"version":1,"type":"event","sequence":2,"event":"tool.completed","payload":{"id":"tool-1","content":"file contents","isError":false}}\n'
            printf '{"version":1,"type":"event","sequence":3,"event":"turn.completed","payload":{"status":"completed","sessionId":"session-fixture"}}\n'
            ;;
    esac
done
"#,
    )
    .unwrap();
    fs::set_permissions(&launcher, fs::Permissions::from_mode(0o755)).unwrap();

    let session = ClaudeSession::start(StartClaudeBridgeOptions {
        executable_path: launcher,
        working_directory: temporary.path().to_path_buf(),
        arguments: Vec::<OsString>::new(),
        shutdown_timeouts: ClaudeBridgeShutdownTimeouts {
            protocol: Duration::from_secs(2),
            interrupt: Duration::from_secs(1),
            terminate: Duration::from_secs(1),
            kill: Duration::from_secs(1),
        },
    })
    .await
    .unwrap();
    let mut output = session.subscribe();

    session.prompt("Inspect the fixture").await.unwrap();
    let mut names = Vec::new();
    while names.last().map(String::as_str) != Some("turn.completed") {
        let item = tokio::time::timeout(Duration::from_secs(3), output.recv())
            .await
            .unwrap()
            .unwrap();
        if let ClaudeBridgeOutput::Event(event) = item {
            names.push(event.event);
        }
    }

    assert_eq!(
        names,
        [
            "text.delta",
            "tool.started",
            "tool.completed",
            "turn.completed"
        ]
    );
    assert_eq!(session.status().await, AgentSessionStatus::Idle);
    assert_eq!(
        session.native_session_id().await.as_deref(),
        Some("session-fixture")
    );
    assert!(session.stop().await.unwrap().requested);
}

#[tokio::test]
async fn stops_a_session_whose_bridge_failed() {
    let temporary = tempfile::tempdir().unwrap();
    let launcher = temporary.path().join("failing bridge host");
    // Answers the handshake, then exits without being asked on the first
    // prompt.
    fs::write(
        &launcher,
        r#"#!/bin/sh
IFS= read -r line
id=$(printf '%s' "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
printf '{"version":1,"type":"response","id":"%s","ok":true,"result":{"nativeSessionId":null}}\n' "$id"
IFS= read -r line
exit 1
"#,
    )
    .unwrap();
    fs::set_permissions(&launcher, fs::Permissions::from_mode(0o755)).unwrap();
    let session = ClaudeSession::start(StartClaudeBridgeOptions {
        executable_path: launcher,
        working_directory: temporary.path().to_path_buf(),
        arguments: Vec::<OsString>::new(),
        shutdown_timeouts: ClaudeBridgeShutdownTimeouts::default(),
    })
    .await
    .unwrap();

    assert!(session.prompt("crash").await.is_err());
    tokio::time::timeout(Duration::from_secs(3), async {
        while session.status().await != AgentSessionStatus::Failed {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the session never failed");

    let exit = session.stop().await.unwrap();
    assert!(!exit.requested);
    assert_eq!(exit.code, Some(1));
    assert_eq!(session.status().await, AgentSessionStatus::Stopped);
}

fn bridge_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/claude-bridge")
}
