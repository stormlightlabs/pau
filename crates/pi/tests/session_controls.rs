#![cfg(unix)]

use pau_agent::{
    AgentCapabilities, AgentControl, AgentControlError, AgentMessageQueue, AgentSessionStatus,
    PromptQueueChoice, ThinkingLevel,
};
use pau_pi::{
    PI_RPC_CAPABILITIES, PiCommand, PiCommandSource, PiCompactionOutcome, PiCompactionReason,
    PiEventPayload, PiEventReducer, PiExtensionUiResponse, PiProcess, PiProcessOutput, PiSession,
    PiSessionError, PiShutdownTimeouts, StartPiProcessOptions,
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

    session
        .set_thinking_level(ThinkingLevel::ExtraHigh)
        .await
        .unwrap();

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
    assert_eq!(commands.len(), 7);
    assert_command(&commands[0], "prompt");
    assert_eq!(commands[0]["message"], "start");
    assert_eq!(commands[1]["streamingBehavior"], "followUp");
    assert_command(&commands[2], "follow_up");
    assert_command(&commands[3], "steer");
    assert_command(&commands[4], "abort");
    assert_command(&commands[5], "set_model");
    assert_eq!(commands[5]["provider"], "fixture");
    assert_eq!(commands[5]["modelId"], "model-one");
    assert_command(&commands[6], "set_thinking_level");
    assert_eq!(commands[6]["level"], "xhigh");
}

#[tokio::test]
async fn reads_and_clears_the_message_queue() {
    let fixture = FakePi::new(CONTROL_FIXTURE);
    let session = PiSession::start(fixture.options()).unwrap();
    assert_eq!(
        session.message_queue().await.unwrap(),
        AgentMessageQueue::default()
    );

    session.prompt("start", None).await.unwrap();
    session.steer("change course").await.unwrap();
    session.follow_up("later").await.unwrap();
    let queued = AgentMessageQueue {
        steering: vec!["change course".to_owned()],
        follow_up: vec!["later".to_owned()],
    };
    wait_for_queue(&session, &queued).await;

    let cleared = session.clear_message_queue().await.unwrap();
    assert_eq!(cleared, queued);
    assert_eq!(
        session.message_queue().await.unwrap(),
        AgentMessageQueue::default()
    );

    let unsupported = PiSession::from_process(
        PiProcess::start(fixture.options()).unwrap(),
        AgentCapabilities {
            message_queue: false,
            ..PI_RPC_CAPABILITIES
        },
    );
    assert!(matches!(
        unsupported.clear_message_queue().await.unwrap_err(),
        PiSessionError::Control(AgentControlError::Unsupported {
            control: AgentControl::MessageQueue,
        })
    ));
    unsupported.stop().await.unwrap();
    session.stop().await.unwrap();
    assert_command(fixture.commands().last().unwrap(), "clear_queue");
}

async fn wait_for_queue(session: &PiSession, expected: &AgentMessageQueue) {
    for _ in 0..100 {
        if session.message_queue().await.unwrap() == *expected {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("queue never reached {expected:?}");
}

#[tokio::test]
async fn lists_prompt_skill_and_extension_commands() {
    let fixture = FakePi::new(CONTROL_FIXTURE);
    let session = PiSession::start(fixture.options()).unwrap();

    let commands = session.commands().await.unwrap();
    assert_eq!(
        commands,
        vec![
            PiCommand {
                name: "review".to_owned(),
                description: Some("Review the changes".to_owned()),
                source: PiCommandSource::Prompt,
                path: Some("/prompts/review.md".to_owned()),
            },
            PiCommand {
                name: "skill:lint".to_owned(),
                description: None,
                source: PiCommandSource::Skill,
                path: None,
            },
            PiCommand {
                name: "ping".to_owned(),
                description: Some("Ping".to_owned()),
                source: PiCommandSource::Extension,
                path: None,
            },
        ]
    );

    let unsupported = PiSession::from_process(
        PiProcess::start(fixture.options()).unwrap(),
        AgentCapabilities {
            command_discovery: false,
            ..PI_RPC_CAPABILITIES
        },
    );
    assert!(matches!(
        unsupported.commands().await.unwrap_err(),
        PiSessionError::Control(AgentControlError::Unsupported {
            control: AgentControl::ListCommands,
        })
    ));
    session.stop().await.unwrap();
    unsupported.stop().await.unwrap();
    assert_command(&fixture.commands()[0], "get_commands");
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

    let rejected_level = session
        .set_thinking_level(ThinkingLevel::Off)
        .await
        .unwrap_err();
    assert!(matches!(
        rejected_level,
        PiSessionError::Control(AgentControlError::Rejected {
            control: AgentControl::SetThinkingLevel,
            message,
        }) if message == "Unsupported thinking level"
    ));

    session.stop().await.unwrap();
    assert_eq!(fixture.commands().len(), 2);
}

#[tokio::test]
async fn compacts_manually_and_reports_failed_compaction() {
    let fixture = FakePi::new(CONTROL_FIXTURE);
    let session = PiSession::start(fixture.options()).unwrap();
    let mut output = session.subscribe();

    let result = session
        .compact(Some("Focus on code changes".to_owned()))
        .await
        .unwrap();
    assert_eq!(result.summary, "Fixture summary");
    assert_eq!(result.first_kept_entry_id.as_deref(), Some("entry-2"));
    assert_eq!(result.tokens_before, Some(150000));
    assert_eq!(result.estimated_tokens_after, Some(32000));
    assert_eq!(result.native["usage"]["totalTokens"], 33200);
    assert_eq!(session.status().await, AgentSessionStatus::Idle);

    let failed = session.compact(None).await.unwrap_err();
    assert!(matches!(
        failed,
        PiSessionError::Control(AgentControlError::Rejected {
            control: AgentControl::Compact,
            message,
        }) if message == "Nothing to compact (session too small)"
    ));
    assert_eq!(session.status().await, AgentSessionStatus::Idle);

    session.set_auto_compaction(false).await.unwrap();

    session.prompt("start", None).await.unwrap();
    let busy = session.compact(None).await.unwrap_err();
    assert!(matches!(
        busy,
        PiSessionError::Control(AgentControlError::InvalidState {
            control: AgentControl::Compact,
            status: AgentSessionStatus::Running,
            ..
        })
    ));
    session.stop().await.unwrap();

    let mut reducer = PiEventReducer::default();
    let mut outcomes = Vec::new();
    while let Ok(record) = output.try_recv() {
        if let PiProcessOutput::Event(event) = record
            && let Some(projected) = reducer.reduce(&event)
            && let PiEventPayload::CompactionEnded {
                reason, outcome, ..
            } = projected.payload
        {
            outcomes.push((reason, outcome));
        }
    }
    assert_eq!(outcomes.len(), 2);
    assert_eq!(outcomes[0].0, PiCompactionReason::Manual);
    assert!(matches!(
        &outcomes[0].1,
        PiCompactionOutcome::Completed(result) if result.summary == "Fixture summary"
    ));
    assert_eq!(
        outcomes[1].1,
        PiCompactionOutcome::Failed {
            message: "Nothing to compact (session too small)".to_owned(),
        }
    );

    let commands = fixture.commands();
    assert_command(&commands[0], "compact");
    assert_eq!(commands[0]["customInstructions"], "Focus on code changes");
    assert_command(&commands[1], "compact");
    assert!(commands[1].get("customInstructions").is_none());
    assert_command(&commands[2], "set_auto_compaction");
    assert_eq!(commands[2]["enabled"], false);
    assert_eq!(commands.len(), 4);
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
            printf '{"type":"queue_update","steering":["change course"],"followUp":["later"]}\n'
            ;;
        *'"type":"steer"'*)
            printf '{"id":"%s","type":"response","command":"steer","success":true}\n' "$id"
            ;;
        *'"type":"clear_queue"'*)
            printf '{"id":"%s","type":"response","command":"clear_queue","success":true,"data":{"steering":["change course"],"followUp":["later"]}}\n' "$id"
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
        *'"level":"off"'*)
            printf '{"id":"%s","type":"response","command":"set_thinking_level","success":false,"error":"Unsupported thinking level"}\n' "$id"
            ;;
        *'"type":"set_thinking_level"'*)
            printf '{"id":"%s","type":"response","command":"set_thinking_level","success":true}\n' "$id"
            ;;
        *'"type":"get_commands"'*)
            printf '{"id":"%s","type":"response","command":"get_commands","success":true,"data":{"commands":[{"name":"review","description":"Review the changes","source":"prompt","sourceInfo":{"path":"/prompts/review.md","source":"local","scope":"project","origin":"top-level"}},{"name":"skill:lint","source":"skill"},{"name":"ping","description":"Ping","source":"extension"}]}}\n' "$id"
            ;;
        *'"customInstructions"'*)
            printf '{"type":"compaction_start","reason":"manual"}\n'
            printf '{"type":"compaction_end","reason":"manual","result":{"summary":"Fixture summary","firstKeptEntryId":"entry-2","tokensBefore":150000,"estimatedTokensAfter":32000,"usage":{"totalTokens":33200},"details":{}},"aborted":false,"willRetry":false}\n'
            printf '{"id":"%s","type":"response","command":"compact","success":true,"data":{"summary":"Fixture summary","firstKeptEntryId":"entry-2","tokensBefore":150000,"estimatedTokensAfter":32000,"usage":{"totalTokens":33200},"details":{}}}\n' "$id"
            ;;
        *'"type":"compact"'*)
            printf '{"type":"compaction_start","reason":"manual"}\n'
            printf '{"type":"compaction_end","reason":"manual","aborted":false,"willRetry":false,"errorMessage":"Nothing to compact (session too small)"}\n'
            printf '{"id":"%s","type":"response","command":"compact","success":false,"error":"Nothing to compact (session too small)"}\n' "$id"
            ;;
        *'"type":"set_auto_compaction"'*)
            printf '{"id":"%s","type":"response","command":"set_auto_compaction","success":true}\n' "$id"
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
