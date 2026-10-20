#![cfg(unix)]

use pau_agent::{
    AgentCapabilities, AgentControl, AgentControlError, AgentMessageQueue, AgentSessionStatus,
    PromptQueueChoice, ThinkingLevel,
};
use pau_pi::{
    PI_RPC_CAPABILITIES, PiCommand, PiCommandSource, PiCompactionOutcome, PiCompactionReason,
    PiContextUsage, PiEventPayload, PiEventReducer, PiExtensionUiResponse, PiImage, PiModel,
    PiProcess, PiProcessOutput, PiSession, PiSessionError, PiSessionUsage, PiShutdownTimeouts,
    PiTokenUsage, StartPiProcessOptions,
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
    // A prompt that an extension command consumes starts no run.
    session.prompt("/handled", Vec::new(), None).await.unwrap();
    assert_eq!(session.status().await, AgentSessionStatus::Idle);

    session.prompt("start", Vec::new(), None).await.unwrap();
    assert_eq!(session.status().await, AgentSessionStatus::Running);

    let error = session
        .prompt("ambiguous", Vec::new(), None)
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        PiSessionError::Control(AgentControlError::InvalidState {
            control: AgentControl::Prompt,
            status: AgentSessionStatus::Running,
            ..
        })
    ));

    session
        .prompt(
            "queued prompt",
            Vec::new(),
            Some(PromptQueueChoice::FollowUp),
        )
        .await
        .unwrap();
    session.follow_up("later", Vec::new()).await.unwrap();
    session.steer("change course", Vec::new()).await.unwrap();
    session.interrupt().await.unwrap();
    assert_eq!(session.status().await, AgentSessionStatus::Idle);

    let model = session.select_model("fixture", "model-one").await.unwrap();
    assert_eq!(model["id"], "model-one");

    session
        .set_thinking_level(ThinkingLevel::ExtraHigh)
        .await
        .unwrap();

    let invalid_follow_up = session.follow_up("too late", Vec::new()).await.unwrap_err();
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
    assert_eq!(commands.len(), 8);
    assert_eq!(commands[0]["message"], "/handled");
    let commands = &commands[1..];
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
async fn sends_images_with_prompts_and_queued_messages() {
    let fixture = FakePi::new(CONTROL_FIXTURE);
    let session = PiSession::start(fixture.options()).unwrap();
    let image = || PiImage {
        mime_type: "image/png".to_owned(),
        data: "AAAA".to_owned(),
    };

    session.prompt("start", vec![image()], None).await.unwrap();
    session.steer("change course", vec![image()]).await.unwrap();
    session.follow_up("later", Vec::new()).await.unwrap();

    let commands = fixture.commands();
    let expected = serde_json::json!([{"type": "image", "data": "AAAA", "mimeType": "image/png"}]);
    assert_eq!(commands[0]["images"], expected);
    assert_eq!(commands[1]["images"], expected);
    assert!(commands[2].get("images").is_none());
    session.stop().await.unwrap();
}

#[tokio::test]
async fn reads_and_clears_the_message_queue() {
    let fixture = FakePi::new(CONTROL_FIXTURE);
    let session = PiSession::start(fixture.options()).unwrap();
    assert_eq!(
        session.message_queue().await.unwrap(),
        AgentMessageQueue::default()
    );

    session.prompt("start", Vec::new(), None).await.unwrap();
    session.steer("change course", Vec::new()).await.unwrap();
    session.follow_up("later", Vec::new()).await.unwrap();
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

/// Polls the fake Pi's command log. The deadline is generous because the fake
/// shell can start slowly while other builds load the machine.
async fn wait_for_commands(fixture: &FakePi, count: usize) -> Vec<Value> {
    for _ in 0..500 {
        let commands = fixture.commands();
        if commands.len() >= count {
            return commands;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("the fake Pi never recorded {count} commands");
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
async fn reports_context_token_and_cost_usage() {
    let fixture = FakePi::new(CONTROL_FIXTURE);
    let session = PiSession::start(fixture.options()).unwrap();

    let tokens = PiTokenUsage {
        input: 50000,
        output: 10000,
        cache_read: 40000,
        cache_write: 5000,
        total: 105000,
    };
    assert_eq!(
        session.usage().await.unwrap(),
        PiSessionUsage {
            context: Some(PiContextUsage {
                tokens: Some(60000),
                context_window: 200000,
                percent: Some(30.0),
            }),
            tokens,
            cost: 0.45,
        }
    );

    // Pi has no context estimate between a compaction and the next response.
    session.compact(Some("keep code".to_owned())).await.unwrap();
    let compacted = session.usage().await.unwrap();
    assert_eq!(
        compacted.context,
        Some(PiContextUsage {
            tokens: None,
            context_window: 200000,
            percent: None,
        })
    );
    assert_eq!(compacted.tokens, tokens);

    let unsupported = PiSession::from_process(
        PiProcess::start(fixture.options()).unwrap(),
        AgentCapabilities {
            usage: false,
            ..PI_RPC_CAPABILITIES
        },
    );
    assert!(matches!(
        unsupported.usage().await.unwrap_err(),
        PiSessionError::Control(AgentControlError::Unsupported {
            control: AgentControl::ReadUsage,
        })
    ));
    session.stop().await.unwrap();
    unsupported.stop().await.unwrap();
}

#[tokio::test]
async fn branches_through_pi_fork_only_while_idle() {
    let fixture = FakePi::new(CONTROL_FIXTURE);
    let session = PiSession::start(fixture.options()).unwrap();

    let outcome = session.branch("entry-1".to_owned()).await.unwrap();
    assert_eq!(outcome.text.as_deref(), Some("First prompt"));
    assert!(!outcome.cancelled);
    let vetoed = session.branch("vetoed".to_owned()).await.unwrap();
    assert_eq!(vetoed.text, None);
    assert!(vetoed.cancelled);
    assert_eq!(
        fixture.commands()[0],
        serde_json::json!({"id": fixture.commands()[0]["id"], "type": "fork", "entryId": "entry-1"})
    );

    session.prompt("start", Vec::new(), None).await.unwrap();
    let error = session.branch("entry-1".to_owned()).await.unwrap_err();
    assert!(matches!(
        error,
        PiSessionError::Control(AgentControlError::InvalidState {
            control: AgentControl::Branching,
            ..
        })
    ));
    session.stop().await.unwrap();
}

#[tokio::test]
async fn lists_available_models_and_marks_the_current_one() {
    let fixture = FakePi::new(CONTROL_FIXTURE);
    let session = PiSession::start(fixture.options()).unwrap();
    let model = |id: &str, name: Option<&str>, reasoning, image_input, current| PiModel {
        provider: "fixture".to_owned(),
        id: id.to_owned(),
        name: name.map(str::to_owned),
        reasoning,
        image_input,
        current,
    };
    assert_eq!(
        session.models().await.unwrap(),
        vec![
            model("model-one", Some("Model One"), true, true, false),
            model("model-two", None, false, false, true),
        ]
    );
    session.stop().await.unwrap();

    let empty = FakePi::new(
        r#"
while IFS= read -r command; do
    id=$(printf '%s' "$command" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
    case "$command" in
        *'"type":"get_state"'*)
            printf '{"id":"%s","type":"response","command":"get_state","success":true,"data":{}}\n' "$id"
            ;;
        *'"type":"get_available_models"'*)
            printf '{"id":"%s","type":"response","command":"get_available_models","success":true,"data":{"models":[]}}\n' "$id"
            ;;
        *) exit 65 ;;
    esac
done
"#,
    );
    let session = PiSession::start(empty.options()).unwrap();
    assert_eq!(session.models().await.unwrap(), Vec::new());
    session.stop().await.unwrap();
}

#[tokio::test]
async fn reports_the_current_models_thinking_levels() {
    let fixture = FakePi::new(CONTROL_FIXTURE);
    let session = PiSession::start(fixture.options()).unwrap();

    // The fixture starts on a model without reasoning support.
    assert_eq!(
        session.thinking_levels().await.unwrap(),
        vec![ThinkingLevel::Off]
    );

    // Switching to a reasoning model changes the levels Pi reports.
    session.select_model("fixture", "model-one").await.unwrap();
    assert_eq!(
        session.thinking_levels().await.unwrap(),
        vec![
            ThinkingLevel::Off,
            ThinkingLevel::Minimal,
            ThinkingLevel::Low,
            ThinkingLevel::Medium,
            ThinkingLevel::High,
            ThinkingLevel::ExtraHigh,
        ]
    );
    session.stop().await.unwrap();
}

#[tokio::test]
async fn recalls_user_prompts_newest_first() {
    let fixture = FakePi::new(CONTROL_FIXTURE);
    let session = PiSession::start(fixture.options()).unwrap();
    assert_eq!(
        session.input_history().await.unwrap(),
        vec!["second\nline", "second", "first"]
    );
    session.stop().await.unwrap();
    assert_command(&fixture.commands()[0], "get_entries");
}

#[tokio::test]
async fn reads_the_conversation_as_native_messages() {
    let fixture = FakePi::new(CONTROL_FIXTURE);
    let session = PiSession::start(fixture.options()).unwrap();
    let messages = session.messages().await.unwrap();
    session.stop().await.unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[1]["errorMessage"], "529 overloaded");
    assert_command(&fixture.commands()[0], "get_messages");
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
    // Responses get no reply, so wait for the fake to log both before
    // shutdown can interrupt its read loop.
    let commands = wait_for_commands(&fixture, 2).await;
    session.stop().await.unwrap();

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

    let unsupported = session
        .prompt("not sent", Vec::new(), None)
        .await
        .unwrap_err();
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

    session.prompt("start", Vec::new(), None).await.unwrap();
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

#[tokio::test]
async fn sends_a_failed_turn_prompt_again_and_manages_automatic_retry() {
    let fixture = FakePi::new(CONTROL_FIXTURE);
    let session = PiSession::start(fixture.options()).unwrap();
    let mut output = session.subscribe();

    session.retry().await.unwrap();
    assert_eq!(session.status().await, AgentSessionStatus::Running);

    let busy = session.retry().await.unwrap_err();
    assert!(matches!(
        busy,
        PiSessionError::Control(AgentControlError::InvalidState {
            control: AgentControl::Retry,
            status: AgentSessionStatus::Running,
            ..
        })
    ));
    session.set_auto_retry(false).await.unwrap();
    session.abort_retry().await.unwrap();
    session.interrupt().await.unwrap();

    let idle = session.abort_retry().await.unwrap_err();
    assert!(matches!(
        idle,
        PiSessionError::Control(AgentControlError::InvalidState {
            control: AgentControl::AbortRetry,
            status: AgentSessionStatus::Idle,
            ..
        })
    ));

    let unsupported = PiSession::from_process(
        PiProcess::start(fixture.options()).unwrap(),
        AgentCapabilities {
            retry: false,
            ..PI_RPC_CAPABILITIES
        },
    );
    assert!(matches!(
        unsupported.retry().await.unwrap_err(),
        PiSessionError::Control(AgentControlError::Unsupported {
            control: AgentControl::Retry,
        })
    ));
    unsupported.stop().await.unwrap();
    session.stop().await.unwrap();

    let mut reducer = PiEventReducer::default();
    let mut payloads = Vec::new();
    while let Ok(record) = output.try_recv() {
        if let PiProcessOutput::Event(event) = record
            && let Some(projected) = reducer.reduce(&event)
        {
            payloads.push(projected.payload);
        }
    }
    assert!(payloads.contains(&PiEventPayload::AutoRetryStarted {
        attempt: 1,
        max_attempts: 3,
        delay_ms: 2000,
        error_message: "529 overloaded".to_owned(),
    }));
    assert!(payloads.contains(&PiEventPayload::AutoRetryEnded {
        success: false,
        attempt: 3,
        final_error: Some("529 overloaded".to_owned()),
    }));

    let commands = fixture.commands();
    assert_command(&commands[0], "get_messages");
    assert_command(&commands[1], "prompt");
    assert_eq!(commands[1]["message"], "failing prompt");
    assert_command(&commands[2], "set_auto_retry");
    assert_eq!(commands[2]["enabled"], false);
    assert_command(&commands[3], "abort_retry");
}

#[tokio::test]
async fn refuses_to_send_again_when_the_last_turn_succeeded() {
    let fixture = FakePi::new(CONTROL_FIXTURE);
    let session = PiSession::start(fixture.options()).unwrap();
    session.prompt("healthy", Vec::new(), None).await.unwrap();
    session.interrupt().await.unwrap();
    // Pi answers `get_messages` with a failed turn until a prompt named
    // "healthy" has been sent, after which the last turn succeeded.
    let rejected = session.retry().await.unwrap_err();
    assert!(matches!(
        rejected,
        PiSessionError::Control(AgentControlError::Rejected {
            control: AgentControl::Retry,
            message,
        }) if message == "the last assistant turn did not fail"
    ));
    assert_eq!(session.status().await, AgentSessionStatus::Idle);
    session.stop().await.unwrap();
}

#[tokio::test]
async fn renames_and_clones_the_session() {
    let fixture = FakePi::new(NAMING_FIXTURE);
    let session = PiSession::start(fixture.options()).unwrap();

    session.rename("release prep").await.unwrap();
    let rejected = session.rename("").await.unwrap_err();
    assert!(matches!(
        rejected,
        PiSessionError::Control(AgentControlError::Rejected {
            control: AgentControl::Rename,
            message,
        }) if message == "Session name cannot be empty"
    ));

    let cloned = session.clone_session().await.unwrap();
    assert_eq!(cloned.id, "native-clone");
    assert_eq!(cloned.file, "/sessions/clone.jsonl");
    let cancelled = session.clone_session().await.unwrap_err();
    assert!(matches!(
        cancelled,
        PiSessionError::Control(AgentControlError::Rejected {
            control: AgentControl::CloneSession,
            message,
        }) if message == "An extension cancelled the clone"
    ));

    session.prompt("start", Vec::new(), None).await.unwrap();
    let busy = session.clone_session().await.unwrap_err();
    assert!(matches!(
        busy,
        PiSessionError::Control(AgentControlError::InvalidState {
            control: AgentControl::CloneSession,
            status: AgentSessionStatus::Running,
            ..
        })
    ));
    session.stop().await.unwrap();

    let commands = fixture.commands();
    assert_command(&commands[0], "set_session_name");
    assert_eq!(commands[0]["name"], "release prep");
    assert_command(&commands[1], "set_session_name");
    assert_command(&commands[2], "clone");
    assert_command(&commands[3], "get_state");
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
        *'"message":"healthy"'*)
            : > "$PWD/healthy"
            printf '{"id":"%s","type":"response","command":"prompt","success":true}\n' "$id"
            printf '{"type":"agent_start"}\n'
            ;;
        *'"message":"/handled"'*)
            printf '{"id":"%s","type":"response","command":"prompt","success":true,"data":{"disposition":"handled"}}\n' "$id"
            ;;
        *'"streamingBehavior"'*)
            printf '{"id":"%s","type":"response","command":"prompt","success":true,"data":{"disposition":"queued"}}\n' "$id"
            ;;
        *'"type":"prompt"'*)
            printf '{"id":"%s","type":"response","command":"prompt","success":true,"data":{"disposition":"started"}}\n' "$id"
            printf '{"type":"agent_start"}\n'
            ;;
        *'"type":"follow_up"'*)
            printf '{"id":"%s","type":"response","command":"follow_up","success":true,"data":{"disposition":"queued"}}\n' "$id"
            printf '{"type":"queue_update","steering":["change course"],"followUp":["later"]}\n'
            ;;
        *'"type":"steer"'*)
            printf '{"id":"%s","type":"response","command":"steer","success":true,"data":{"disposition":"queued"}}\n' "$id"
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
        *'"type":"get_session_stats"'*)
            if grep -q '"type":"compact"' "$PWD/commands.jsonl"; then
                context='{"tokens":null,"contextWindow":200000,"percent":null}'
            else
                context='{"tokens":60000,"contextWindow":200000,"percent":30}'
            fi
            printf '{"id":"%s","type":"response","command":"get_session_stats","success":true,"data":{"tokens":{"input":50000,"output":10000,"cacheRead":40000,"cacheWrite":5000,"total":105000},"cost":0.45,"contextUsage":%s}}\n' "$id" "$context"
            ;;
        *'"type":"get_state"'*)
            printf '{"id":"%s","type":"response","command":"get_state","success":true,"data":{"model":{"provider":"fixture","id":"model-two"}}}\n' "$id"
            ;;
        *'"type":"get_available_thinking_levels"'*)
            if grep -q '"modelId":"model-one"' "$PWD/commands.jsonl"; then
                levels='["off","minimal","low","medium","high","xhigh"]'
            else
                levels='["off"]'
            fi
            printf '{"id":"%s","type":"response","command":"get_available_thinking_levels","success":true,"data":{"levels":%s}}\n' "$id" "$levels"
            ;;
        *'"type":"get_available_models"'*)
            printf '{"id":"%s","type":"response","command":"get_available_models","success":true,"data":{"models":[{"id":"model-one","name":"Model One","provider":"fixture","reasoning":true,"input":["text","image"]},{"id":"model-two","provider":"fixture","reasoning":false,"input":["text"]}]}}\n' "$id"
            ;;
        *'"entryId":"vetoed"'*)
            printf '{"id":"%s","type":"response","command":"fork","success":true,"data":{"cancelled":true}}\n' "$id"
            ;;
        *'"type":"fork"'*)
            printf '{"id":"%s","type":"response","command":"fork","success":true,"data":{"text":"First prompt","cancelled":false}}\n' "$id"
            ;;
        *'"type":"get_entries"'*)
            printf '{"id":"%s","type":"response","command":"get_entries","success":true,"data":{"entries":[{"type":"message","id":"a","message":{"role":"user","content":"first"}},{"type":"message","id":"b","message":{"role":"assistant","content":[{"type":"text","text":"reply"}]}},{"type":"message","id":"c","message":{"role":"user","content":[{"type":"text","text":"second"},{"type":"image","data":"x"}]}},{"type":"compaction","id":"d"},{"type":"message","id":"e","message":{"role":"user","content":"second\\nline"}},{"type":"message","id":"f","message":{"role":"user","content":"second\\nline"}},{"type":"message","id":"g","message":{"role":"user","content":[{"type":"image","data":"x"}]}}]}}\n' "$id"
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
        *'"type":"get_messages"'*)
            if [ -f "$PWD/healthy" ]; then
                printf '{"id":"%s","type":"response","command":"get_messages","success":true,"data":{"messages":[{"role":"user","content":"healthy"},{"role":"assistant","content":[],"stopReason":"stop"}]}}\n' "$id"
            else
                printf '{"id":"%s","type":"response","command":"get_messages","success":true,"data":{"messages":[{"role":"user","content":[{"type":"text","text":"failing prompt"}]},{"role":"assistant","content":[],"stopReason":"error","errorMessage":"529 overloaded"}]}}\n' "$id"
            fi
            ;;
        *'"type":"set_auto_retry"'*)
            printf '{"id":"%s","type":"response","command":"set_auto_retry","success":true}\n' "$id"
            ;;
        *'"type":"abort_retry"'*)
            printf '{"type":"auto_retry_start","attempt":1,"maxAttempts":3,"delayMs":2000,"errorMessage":"529 overloaded"}\n'
            printf '{"id":"%s","type":"response","command":"abort_retry","success":true}\n' "$id"
            printf '{"type":"auto_retry_end","success":false,"attempt":3,"finalError":"529 overloaded"}\n'
            ;;
        *'"type":"set_auto_compaction"'*)
            printf '{"id":"%s","type":"response","command":"set_auto_compaction","success":true}\n' "$id"
            ;;
        *'"type":"extension_ui_response"'*) ;;
        *) exit 65 ;;
    esac
done
"#;

const NAMING_FIXTURE: &str = r#"
while IFS= read -r command; do
    printf '%s\n' "$command" >> "$PWD/commands.jsonl"
    id=$(printf '%s' "$command" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
    case "$command" in
        *'"name":""'*)
            printf '{"id":"%s","type":"response","command":"set_session_name","success":false,"error":"Session name cannot be empty"}\n' "$id"
            ;;
        *'"type":"set_session_name"'*)
            printf '{"id":"%s","type":"response","command":"set_session_name","success":true}\n' "$id"
            ;;
        *'"type":"clone"'*)
            if [ -f "$PWD/cloned" ]; then
                printf '{"id":"%s","type":"response","command":"clone","success":true,"data":{"cancelled":true}}\n' "$id"
            else
                : > "$PWD/cloned"
                printf '{"id":"%s","type":"response","command":"clone","success":true,"data":{"cancelled":false}}\n' "$id"
            fi
            ;;
        *'"type":"get_state"'*)
            printf '{"id":"%s","type":"response","command":"get_state","success":true,"data":{"sessionId":"native-clone","sessionFile":"/sessions/clone.jsonl"}}\n' "$id"
            ;;
        *'"type":"prompt"'*)
            printf '{"id":"%s","type":"response","command":"prompt","success":true}\n' "$id"
            printf '{"type":"agent_start"}\n'
            ;;
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
