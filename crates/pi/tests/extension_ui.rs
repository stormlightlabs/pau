#![cfg(unix)]

use pau_pi::{
    PiExtensionUiRequest, PiExtensionUiResponse, PiProcessOutput, PiReplyTimeouts, PiSession,
    PiShutdownTimeouts, StartPiProcessOptions,
};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

#[tokio::test]
#[ignore = "requires a compatible Pi executable on PATH"]
async fn exercises_the_fixture_extension_through_pi_rpc() {
    let executable = find_pi_on_path().expect("Pi must be installed on PATH");
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/extension-ui.ts");
    let session = Arc::new(
        PiSession::start(StartPiProcessOptions {
            executable_path: executable,
            working_directory: PathBuf::from(env!("CARGO_MANIFEST_DIR")),
            arguments: vec![
                "--no-session".into(),
                "--no-tools".into(),
                "--extension".into(),
                fixture.into_os_string(),
            ],
            environment: Vec::new(),
            reply_timeouts: PiReplyTimeouts::default(),
            shutdown_timeouts: PiShutdownTimeouts::default(),
        })
        .unwrap(),
    );
    let mut output = session.subscribe();
    let prompt_session = Arc::clone(&session);
    let prompt = tokio::spawn(async move {
        prompt_session
            .prompt("/pau-extension-ui-fixture", Vec::new(), None)
            .await
    });

    let mut seen = HashSet::new();
    let mut reported_terminal_limitation = false;
    while !reported_terminal_limitation
        || !seen.contains("status-cleared")
        || !seen.contains("widget-cleared")
    {
        let PiProcessOutput::Event(record) =
            tokio::time::timeout(Duration::from_secs(5), output.recv())
                .await
                .expect("timed out waiting for fixture extension output")
                .expect("Pi output stream closed")
        else {
            continue;
        };
        if record.get("type").and_then(|value| value.as_str()) != Some("extension_ui_request") {
            continue;
        }

        match PiExtensionUiRequest::try_from(&record).unwrap() {
            PiExtensionUiRequest::Confirm { id, .. } => {
                seen.insert("confirm");
                session
                    .respond_to_extension_ui(PiExtensionUiResponse::Confirmed {
                        id,
                        confirmed: true,
                    })
                    .await
                    .unwrap();
            }
            PiExtensionUiRequest::Select { id, title, .. } if title == "Select fixture" => {
                seen.insert("select");
                session
                    .respond_to_extension_ui(PiExtensionUiResponse::Value {
                        id,
                        value: "Two".to_owned(),
                    })
                    .await
                    .unwrap();
            }
            PiExtensionUiRequest::Select { title, timeout, .. } if title == "Timeout fixture" => {
                assert_eq!(timeout, Some(25));
                seen.insert("timeout");
            }
            PiExtensionUiRequest::Input { id, .. } => {
                seen.insert("input");
                session
                    .respond_to_extension_ui(PiExtensionUiResponse::Cancelled { id })
                    .await
                    .unwrap();
            }
            PiExtensionUiRequest::Editor { id, .. } => {
                seen.insert("editor");
                session
                    .respond_to_extension_ui(PiExtensionUiResponse::Value {
                        id,
                        value: "Edited fixture".to_owned(),
                    })
                    .await
                    .unwrap();
            }
            PiExtensionUiRequest::Notification { message, .. } => {
                seen.insert("notification");
                reported_terminal_limitation |= message.contains("requires vanilla Pi");
            }
            PiExtensionUiRequest::Status { text, .. } => {
                seen.insert(if text.is_some() {
                    "status"
                } else {
                    "status-cleared"
                });
            }
            PiExtensionUiRequest::Widget { lines, .. } => {
                seen.insert(if lines.is_some() {
                    "widget"
                } else {
                    "widget-cleared"
                });
            }
            PiExtensionUiRequest::Unsupported { .. } => {
                seen.insert("unsupported");
            }
            PiExtensionUiRequest::Select { .. } => unreachable!("unexpected selection request"),
        }
    }

    prompt.await.unwrap().unwrap();
    for expected in [
        "confirm",
        "select",
        "input",
        "editor",
        "notification",
        "status",
        "widget",
        "timeout",
        "status-cleared",
        "widget-cleared",
    ] {
        assert!(
            seen.contains(expected),
            "missing {expected} fixture request"
        );
    }
    session.stop().await.unwrap();
}

fn find_pi_on_path() -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .map(|directory| directory.join("pi"))
            .find(|candidate| candidate.is_file())
    })
}
