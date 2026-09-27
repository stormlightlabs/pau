#![cfg(unix)]

use pau_agent::{
    AgentCapabilities, AgentControl, AgentControlError, AgentSessionStatus, PromptQueueChoice,
};
use pau_pi::{
    PI_RPC_CAPABILITIES, PiExtensionUiResponse, PiProcess, PiSession, PiSessionError,
    PiShutdownTimeouts, StartPiProcessOptions,
};
use serde_json::Value;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::time::Duration;
use tempfile::TempDir;

#[tokio::test]
async fn exercises_every_session_control_against_fake_rpc() {
    let fixture = FakePi::new(CONTROL_FIXTURE);
    let session = PiSession::start(fixture.options()).unwrap();

    assert_eq!(session.capabilities(), PI_RPC_CAPABILITIES);
    session.prompt("start", None).await.unwrap();
    assert_eq!(session.status().await, AgentSessionStatus::Running);

    let error = session.prompt("ambiguous", None).await.unwrap_err();
    assert!(matches!(
        error,
        PiSessionError::Control(AgentControlError::InvalidState {
            control: AgentControl::Prompt,
            status: AgentSessionStatus::Running,
            ..
        })
    ));

    session
        .prompt("queued prompt", Some(PromptQueueChoice::FollowUp))
        .await
        .unwrap();
    session.follow_up("later").await.unwrap();
    session.steer("change course").await.unwrap();
    session.interrupt().await.unwrap();
    assert_eq!(session.status().await, AgentSessionStatus::Idle);

    let model = session.select_model("fixture", "model-one").await.unwrap();
    assert_eq!(model["id"], "model-one");

    let invalid_follow_up = session.follow_up("too late").await.unwrap_err();
    assert!(matches!(
        invalid_follow_up,
        PiSessionError::Control(AgentControlError::InvalidState {
            control: AgentControl::FollowUp,
            status: AgentSessionStatus::Idle,
            ..
        })
    ));

    let exit = session.stop().await.unwrap();
    assert_eq!(exit.code, Some(0));
    assert!(exit.requested);
    assert_eq!(session.status().await, AgentSessionStatus::Stopped);

    let commands = fixture.commands();
    assert_eq!(commands.len(), 6);
    assert_command(&commands[0], "prompt");
    assert_eq!(commands[0]["message"], "start");
    assert_eq!(commands[1]["streamingBehavior"], "followUp");
    assert_command(&commands[2], "follow_up");
    assert_command(&commands[3], "steer");
    assert_command(&commands[4], "abort");
    assert_command(&commands[5], "set_model");
    assert_eq!(commands[5]["provider"], "fixture");
    assert_eq!(commands[5]["modelId"], "model-one");
}

#[tokio::test]
async fn sends_extension_ui_responses_without_command_ids() {
    let fixture = FakePi::new(CONTROL_FIXTURE);
    let session = PiSession::start(fixture.options()).unwrap();

    session
        .respond_to_extension_ui(PiExtensionUiResponse::Value {
            id: "extension-request".to_owned(),
            value: "Allow".to_owned(),
        })
        .await
        .unwrap();
    session
        .respond_to_extension_ui(PiExtensionUiResponse::Cancelled {
            id: "cancelled-request".to_owned(),
        })
        .await
        .unwrap();
    session.stop().await.unwrap();

    let commands = fixture.commands();
    assert_eq!(commands[0]["type"], "extension_ui_response");
    assert_eq!(commands[0]["id"], "extension-request");
    assert_eq!(commands[0]["value"], "Allow");
    assert_eq!(commands[1]["cancelled"], true);
}

#[tokio::test]
async fn returns_capability_and_native_rejection_errors() {
    let fixture = FakePi::new(CONTROL_FIXTURE);
    let process = PiProcess::start(fixture.options()).unwrap();
    let capabilities = AgentCapabilities {
        prompt: false,
        ..PI_RPC_CAPABILITIES
    };
    let session = PiSession::from_process(process, capabilities);

    let unsupported = session.prompt("not sent", None).await.unwrap_err();
    assert!(matches!(
        unsupported,
        PiSessionError::Control(AgentControlError::Unsupported {
            control: AgentControl::Prompt,
        })
    ));

    let rejected = session
        .select_model("fixture", "missing")
        .await
        .unwrap_err();
    assert!(matches!(
        rejected,
        PiSessionError::Control(AgentControlError::Rejected {
            control: AgentControl::SelectModel,
            message,
        }) if message == "Model not found: fixture/missing"
    ));

    session.stop().await.unwrap();
    assert_eq!(fixture.commands().len(), 1);
}

fn assert_command(command: &Value, expected: &str) {
    assert_eq!(command["type"], expected);
    assert!(command["id"].as_str().unwrap().starts_with("pau-"));
}

const CONTROL_FIXTURE: &str = r#"
while IFS= read -r command; do
    printf '%s\n' "$command" >> "$PWD/commands.jsonl"
    id=$(printf '%s' "$command" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
    case "$command" in
        *'"type":"prompt"'*)
            printf '{"id":"%s","type":"response","command":"prompt","success":true}\n' "$id"
            printf '{"type":"agent_start"}\n'
            ;;
        *'"type":"follow_up"'*)
            printf '{"id":"%s","type":"response","command":"follow_up","success":true}\n' "$id"
            ;;
        *'"type":"steer"'*)
            printf '{"id":"%s","type":"response","command":"steer","success":true}\n' "$id"
            ;;
        *'"type":"abort"'*)
            printf '{"id":"%s","type":"response","command":"abort","success":true}\n' "$id"
            printf '{"type":"agent_settled"}\n'
            ;;
        *'"modelId":"missing"'*)
            printf '{"id":"%s","type":"response","command":"set_model","success":false,"error":"Model not found: fixture/missing"}\n' "$id"
            ;;
        *'"type":"set_model"'*)
            printf '{"id":"%s","type":"response","command":"set_model","success":true,"data":{"provider":"fixture","id":"model-one"}}\n' "$id"
            ;;
        *'"type":"extension_ui_response"'*) ;;
        *) exit 65 ;;
    esac
done
"#;

struct FakePi {
    root: TempDir,
    executable: PathBuf,
}

impl FakePi {
    fn new(body: &str) -> Self {
        let root = tempfile::tempdir().unwrap();
        let executable = root.path().join("fake pi");
        fs::write(
            &executable,
            format!("#!/bin/sh\n[ \"$1\" = '--mode' ] && [ \"$2\" = 'rpc' ] || exit 64\n{body}"),
        )
        .unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
        Self { root, executable }
    }

    fn options(&self) -> StartPiProcessOptions {
        StartPiProcessOptions {
            executable_path: self.executable.clone(),
            working_directory: self.root.path().to_path_buf(),
            arguments: Vec::new(),
            environment: Vec::new(),
            shutdown_timeouts: PiShutdownTimeouts {
                protocol: Duration::from_secs(1),
                interrupt: Duration::from_secs(1),
                terminate: Duration::from_secs(1),
                kill: Duration::from_secs(1),
            },
        }
    }

    fn commands(&self) -> Vec<Value> {
        let path = self.root.path().join("commands.jsonl");
        fs::read_to_string(path)
            .unwrap_or_default()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }
}
