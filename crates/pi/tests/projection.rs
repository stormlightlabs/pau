use pau_agent::{AgentEventKind, AgentSessionStatus};
use pau_pi::{
    PiCompactionOutcome, PiCompactionReason, PiEventPayload, PiEventReducer, PiLifecycleEvent,
    PiMessagePhase, PiProjectedContent, PiToolCallPhase, PiToolResultPhase,
};
use serde_json::Value;

const CAPTURED_EVENTS: &str = include_str!("fixtures/event-projection.jsonl");
const COMPACTION_EVENTS: &str = include_str!("fixtures/compaction-events.jsonl");

#[test]
fn replays_captured_events_and_replaces_streamed_messages() {
    let mut reducer = PiEventReducer::default();
    let mut events = Vec::new();
    let mut saw_streamed_projection = false;

    for line in CAPTURED_EVENTS.lines() {
        let native: Value = serde_json::from_str(line).unwrap();
        if !saw_streamed_projection
            && native["type"] == "message_end"
            && native["message"]["role"] == "assistant"
        {
            assert_eq!(
                reducer.messages()[0].content,
                vec![
                    PiProjectedContent::Text("streamed text".to_owned()),
                    PiProjectedContent::Thinking("check files".to_owned()),
                    PiProjectedContent::ToolCall {
                        id: "call-1".to_owned(),
                        name: "read".to_owned(),
                        arguments: serde_json::json!({"path": "README.md"}),
                        streamed_arguments: String::new(),
                    },
                ]
            );
            saw_streamed_projection = true;
        }
        if let Some(event) = reducer.reduce(&native) {
            events.push(event);
        }
    }

    assert!(saw_streamed_projection);
    assert_eq!(reducer.status(), AgentSessionStatus::Idle);
    // Two assistant messages and six tool results.
    assert_eq!(reducer.messages().len(), 8);
    let assistant = &reducer.messages()[0];
    assert!(assistant.complete);
    assert_eq!(
        assistant.content,
        vec![
            PiProjectedContent::Text("authoritative text".to_owned()),
            PiProjectedContent::Thinking("authoritative thought".to_owned()),
            PiProjectedContent::ToolCall {
                id: "call-1".to_owned(),
                name: "read".to_owned(),
                arguments: serde_json::json!({"path": "README.md"}),
                streamed_arguments: String::new(),
            },
        ]
    );
    assert_eq!(assistant.native["futureMessageField"]["kept"], true);
    assert_eq!(
        reducer.messages()[1].content,
        vec![PiProjectedContent::Text("complete output".to_owned())]
    );

    assert!(
        events
            .iter()
            .any(|event| event.kind == AgentEventKind::TextDelta)
    );
    assert!(
        events
            .iter()
            .any(|event| event.kind == AgentEventKind::ThinkingDelta)
    );
    assert!(
        events
            .iter()
            .any(|event| event.kind == AgentEventKind::ToolCall)
    );
    assert!(events.iter().any(|event| {
        matches!(
            &event.payload,
            PiEventPayload::ToolResult {
                phase: PiToolResultPhase::Completed,
                result,
                ..
            } if result["details"]["lines"] == 10
        )
    }));
    assert!(events.iter().any(|event| {
        matches!(
            &event.payload,
            PiEventPayload::Message {
                phase: PiMessagePhase::Completed,
                message,
            } if message.native["futureMessageField"]["kept"] == true
        )
    }));
}

/// Pi's built-in tools report structured arguments and result details that the
/// projection must pass through intact, along with extension tools and failures.
#[test]
fn passes_built_in_extension_and_failed_tool_data_through() {
    let mut reducer = PiEventReducer::default();
    let events: Vec<_> = CAPTURED_EVENTS
        .lines()
        .filter_map(|line| reducer.reduce(&serde_json::from_str(line).unwrap()))
        .collect();
    let executing = |id: &str| {
        events.iter().find_map(|event| match &event.payload {
            PiEventPayload::ToolCall {
                phase: PiToolCallPhase::Executing,
                id: call,
                name,
                arguments,
            } if call == id => Some((name.as_str(), arguments.clone())),
            _ => None,
        })
    };
    let completed = |id: &str| {
        events.iter().find_map(|event| match &event.payload {
            PiEventPayload::ToolResult {
                phase: PiToolResultPhase::Completed,
                id: call,
                result,
                is_error,
                ..
            } if call == id => Some((result.clone(), *is_error)),
            _ => None,
        })
    };

    assert_eq!(
        executing("call-1"),
        Some(("read", serde_json::json!({"path": "README.md"})))
    );
    assert_eq!(
        executing("call-2"),
        Some((
            "bash",
            serde_json::json!({"command": "pnpm test", "timeout": 120})
        ))
    );
    let (bash, failed) = completed("call-2").unwrap();
    assert!(!failed);
    assert_eq!(bash["details"]["truncation"]["totalLines"], 3);
    assert_eq!(bash["structuredContent"]["exit_code"], 0);

    assert_eq!(
        executing("call-3").unwrap().1["edits"][0]["newText"],
        "New intro"
    );
    let (edit, failed) = completed("call-3").unwrap();
    assert!(!failed);
    assert_eq!(
        edit["details"]["diff"],
        " 1 # Pau\n-2 Old intro\n+2 New intro"
    );
    assert_eq!(edit["details"]["firstChangedLine"], 2);

    assert_eq!(
        executing("call-4"),
        Some((
            "write",
            serde_json::json!({"path": "NOTES.md", "content": "# Notes\nFirst line\n"})
        ))
    );
    assert_eq!(completed("call-4").map(|(_, failed)| failed), Some(false));

    assert_eq!(executing("call-5").unwrap().0, "todo");
    assert_eq!(
        completed("call-5").unwrap().0["details"]["todos"][0]["text"],
        "Ship it"
    );

    let (build, failed) = completed("call-6").unwrap();
    assert!(failed);
    assert_eq!(build["structuredContent"]["exit_code"], 1);
    assert!(
        reducer
            .messages()
            .iter()
            .any(|message| message.role == "toolResult"
                && message.native["toolCallId"] == "call-6"
                && message.native["isError"] == true)
    );
}

#[test]
fn agent_end_keeps_the_session_running_until_agent_settled() {
    let mut reducer = PiEventReducer::default();

    let started = reducer
        .reduce(&serde_json::json!({"type": "agent_start"}))
        .unwrap();
    assert_eq!(reducer.status(), AgentSessionStatus::Running);
    assert!(matches!(
        started.payload,
        PiEventPayload::Lifecycle {
            event: PiLifecycleEvent::AgentStarted,
            status: AgentSessionStatus::Running,
        }
    ));

    let ended = reducer
        .reduce(&serde_json::json!({
            "type": "agent_end",
            "messages": [],
            "willRetry": false
        }))
        .unwrap();
    assert_eq!(reducer.status(), AgentSessionStatus::Running);
    assert!(matches!(
        ended.payload,
        PiEventPayload::Lifecycle {
            event: PiLifecycleEvent::AgentEnded { will_retry: false },
            status: AgentSessionStatus::Running,
        }
    ));

    let settled = reducer
        .reduce(&serde_json::json!({"type": "agent_settled"}))
        .unwrap();
    assert_eq!(reducer.status(), AgentSessionStatus::Idle);
    assert!(matches!(
        settled.payload,
        PiEventPayload::Lifecycle {
            event: PiLifecycleEvent::AgentSettled,
            status: AgentSessionStatus::Idle,
        }
    ));
}

#[test]
fn projects_automatic_compaction_results_and_failures() {
    let mut reducer = PiEventReducer::default();
    let mut started = Vec::new();
    let mut ended = Vec::new();

    for line in COMPACTION_EVENTS.lines() {
        let native: Value = serde_json::from_str(line).unwrap();
        let Some(event) = reducer.reduce(&native) else {
            continue;
        };
        match event.payload {
            PiEventPayload::CompactionStarted { reason } => {
                assert_eq!(event.kind, AgentEventKind::Compaction);
                assert_eq!(reducer.status(), AgentSessionStatus::Running);
                started.push(reason);
            }
            PiEventPayload::CompactionEnded {
                reason,
                outcome,
                will_retry,
            } => {
                assert_eq!(event.kind, AgentEventKind::Compaction);
                ended.push((reason, outcome, will_retry, reducer.status()));
            }
            _ => {}
        }
    }

    assert_eq!(
        started,
        vec![
            PiCompactionReason::Threshold,
            PiCompactionReason::Overflow,
            PiCompactionReason::Threshold,
            PiCompactionReason::Manual,
        ]
    );
    assert!(started[..3].iter().all(PiCompactionReason::is_automatic));
    assert!(!started[3].is_automatic());
    assert_eq!(ended.len(), 4);

    let PiCompactionOutcome::Completed(threshold) = &ended[0].1 else {
        panic!("threshold compaction should succeed");
    };
    assert_eq!(threshold.summary, "Threshold summary");
    assert_eq!(threshold.first_kept_entry_id.as_deref(), Some("entry-4"));
    assert_eq!(threshold.tokens_before, Some(180000));
    assert_eq!(threshold.estimated_tokens_after, Some(40000));
    assert_eq!(threshold.native["details"]["futureDetail"], true);
    // Automatic compaction inside a run leaves settlement to `agent_settled`.
    assert_eq!(ended[0].3, AgentSessionStatus::Running);

    assert_eq!(ended[1].0, PiCompactionReason::Overflow);
    assert!(matches!(ended[1].1, PiCompactionOutcome::Completed(_)));
    assert!(ended[1].2);

    assert_eq!(
        ended[2].1,
        PiCompactionOutcome::Failed {
            message: "Summarization failed: 529 overloaded".to_owned(),
        }
    );
    assert_eq!(ended[2].3, AgentSessionStatus::Running);

    assert_eq!(ended[3].1, PiCompactionOutcome::Aborted);
    // Manual compaction from idle returns the session to idle when it ends.
    assert_eq!(ended[3].3, AgentSessionStatus::Idle);
}

#[test]
fn reports_a_compaction_end_without_a_result_as_failed() {
    let mut reducer = PiEventReducer::default();
    let event = reducer
        .reduce(&serde_json::json!({"type": "compaction_end", "reason": "threshold"}))
        .unwrap();

    assert!(matches!(
        event.payload,
        PiEventPayload::CompactionEnded {
            outcome: PiCompactionOutcome::Failed { message },
            ..
        } if message == "Pi did not report a compaction result"
    ));
}
