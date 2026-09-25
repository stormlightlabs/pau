use pau_agent::{AgentEventKind, AgentSessionStatus};
use pau_pi::{
    PiEventPayload, PiEventReducer, PiLifecycleEvent, PiMessagePhase, PiProjectedContent,
    PiToolResultPhase,
};
use serde_json::Value;

const CAPTURED_EVENTS: &str = include_str!("fixtures/event-projection.jsonl");

#[test]
fn replays_captured_events_and_replaces_streamed_messages() {
    let mut reducer = PiEventReducer::default();
    let mut events = Vec::new();
    let mut saw_streamed_projection = false;

    for line in CAPTURED_EVENTS.lines() {
        let native: Value = serde_json::from_str(line).unwrap();
        if native["type"] == "message_end" && native["message"]["role"] == "assistant" {
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
    assert_eq!(reducer.messages().len(), 2);
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
