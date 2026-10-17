use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf, time::Duration};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::Request,
    http::{StatusCode, header},
};
use pau_core::{
    ServerEvent, ServerStreamMessage, persistence::Database, sandbox::SandboxSelection,
    workspace::WorkspaceService,
};
use serde_json::{Value, json};
use tempfile::TempDir;
use tower::ServiceExt;

use super::*;
use crate::{ApiToken, EventSubscription, SandboxApi, default_diagnostics, router_with_services};

const TOKEN: &str = "0123456789abcdef0123456789abcdef";

/// A Pi RPC stand-in. It records every command in the workspace, answers the
/// controls the session API sends, and exits with status 3 without answering
/// a prompt whose text is `exit`.
const FAKE_PI: &str = r#"#!/bin/sh
if [ "$1" = '--version' ]; then echo 0.87.1; exit 0; fi
[ "$1" = '--mode' ] && [ "$2" = 'rpc' ] || exit 64
printf '%s\n' "$*" > "$PWD/args.txt"
while IFS= read -r command; do
    printf '%s\n' "$command" >> "$PWD/commands.jsonl"
    id=$(printf '%s' "$command" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
    case "$command" in
        *'"type":"get_state"'*)
            printf '{"id":"%s","type":"response","command":"get_state","success":true,"data":{"sessionId":"native","sessionFile":"%s/session.jsonl","model":{"provider":"fixture","id":"model-one"}}}\n' "$id" "$PWD"
            ;;
        *'"message":"exit"'*) exit 3 ;;
        *'"message":"dialogs"'*)
            printf '{"id":"%s","type":"response","command":"prompt","success":true}\n' "$id"
            printf '{"type":"extension_ui_request","id":"ui-select","method":"select","title":"Pick","options":["a","b"]}\n'
            printf '{"type":"extension_ui_request","id":"ui-confirm","method":"confirm","title":"Sure?","message":"Delete it"}\n'
            printf '{"type":"extension_ui_request","id":"ui-input","method":"input","title":"Name","placeholder":"x"}\n'
            printf '{"type":"extension_ui_request","id":"ui-editor","method":"editor","title":"Edit","prefill":"text"}\n'
            printf '{"type":"extension_ui_request","id":"ui-notify","method":"notify","message":"Heads up","notifyType":"warning"}\n'
            printf '{"type":"extension_ui_request","id":"ui-status","method":"setStatus","statusKey":"k","statusText":"busy"}\n'
            printf '{"type":"extension_ui_request","id":"ui-widget","method":"setWidget","widgetKey":"w","widgetLines":["one"],"widgetPlacement":"belowEditor"}\n'
            printf '{"type":"agent_start"}\n'
            ;;
        *'"message":"expiring"'*)
            printf '{"id":"%s","type":"response","command":"prompt","success":true}\n' "$id"
            printf '{"type":"extension_ui_request","id":"ui-short","method":"input","title":"Quick","timeout":100}\n'
            ;;
        *'"type":"extension_ui_response"'*) ;;
        *'"message":"usage"'*)
            printf '{"id":"%s","type":"response","command":"prompt","success":true}\n' "$id"
            printf '{"type":"agent_start"}\n'
            printf '{"type":"message_end","message":{"role":"user"}}\n'
            printf '{"type":"message_end","message":{"role":"assistant"}}\n'
            ;;
        *'"type":"prompt"'*)
            printf '{"id":"%s","type":"response","command":"prompt","success":true}\n' "$id"
            printf '{"type":"agent_start"}\n'
            ;;
        *'"type":"steer"'*)
            printf '{"id":"%s","type":"response","command":"steer","success":true}\n' "$id"
            ;;
        *'"type":"follow_up"'*)
            printf '{"id":"%s","type":"response","command":"follow_up","success":true}\n' "$id"
            printf '{"type":"queue_update","steering":["change course"],"followUp":["later"]}\n'
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
        *'"type":"set_thinking_level"'*)
            printf '{"id":"%s","type":"response","command":"set_thinking_level","success":true}\n' "$id"
            ;;
        *'"customInstructions":"fail"'*)
            printf '{"id":"%s","type":"response","command":"compact","success":false,"error":"Nothing to compact"}\n' "$id"
            printf '{"type":"compaction_end","reason":"manual","aborted":false,"willRetry":false,"errorMessage":"Nothing to compact"}\n'
            ;;
        *'"type":"compact"'*)
            printf '{"type":"compaction_start","reason":"manual"}\n'
            printf '{"id":"%s","type":"response","command":"compact","success":true,"data":{"summary":"Short summary","firstKeptEntryId":"entry-2","tokensBefore":9000}}\n' "$id"
            printf '{"type":"compaction_end","reason":"manual","aborted":false,"willRetry":false,"result":{"summary":"Short summary","firstKeptEntryId":"entry-2","tokensBefore":9000}}\n'
            ;;
        *'"type":"set_auto_compaction"'*)
            printf '{"id":"%s","type":"response","command":"set_auto_compaction","success":true}\n' "$id"
            ;;
        *'"type":"get_session_stats"'*)
            printf '{"id":"%s","type":"response","command":"get_session_stats","success":true,"data":{"tokens":{"input":50000,"output":10000,"cacheRead":40000,"cacheWrite":5000,"total":105000},"cost":0.45,"contextUsage":{"tokens":60000,"contextWindow":200000,"percent":30}}}\n' "$id"
            ;;
        *'"type":"get_available_models"'*)
            printf '{"id":"%s","type":"response","command":"get_available_models","success":true,"data":{"models":[{"id":"model-one","name":"Model One","provider":"fixture","reasoning":true},{"id":"model-two","provider":"fixture","reasoning":false}]}}\n' "$id"
            ;;
        *'"type":"get_entries"'*)
            printf '{"id":"%s","type":"response","command":"get_entries","success":true,"data":{"entries":[{"type":"message","id":"a","message":{"role":"user","content":"first"}},{"type":"message","id":"b","message":{"role":"assistant","content":"reply"}},{"type":"message","id":"c","message":{"role":"user","content":[{"type":"text","text":"second"}]}}]}}\n' "$id"
            ;;
        *'"type":"get_commands"'*)
            printf '{"id":"%s","type":"response","command":"get_commands","success":true,"data":{"commands":[{"name":"review","description":"Review the changes","source":"prompt","sourceInfo":{"path":"/prompts/review.md"}},{"name":"skill:lint","source":"skill"}]}}\n' "$id"
            ;;
        *) exit 65 ;;
    esac
done
"#;

struct Fixture {
    _directory: TempDir,
    workspace_root: PathBuf,
    workspace_id: String,
    database: Database,
    events: EventHub,
    app: Router,
}

impl Fixture {
    /// Serves the API with the fake Pi, or with `executable` in its place.
    async fn new(executable: Option<&str>) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let pi = directory.path().join("fake pi");
        fs::write(&pi, FAKE_PI).unwrap();
        fs::set_permissions(&pi, fs::Permissions::from_mode(0o755)).unwrap();
        let workspace_root = directory.path().join("project");
        fs::create_dir(&workspace_root).unwrap();
        let database = Database::open(":memory:").await.unwrap();
        let workspaces = WorkspaceService::new(database.workspaces());
        let workspace = workspaces.open(&workspace_root, None).await.unwrap();
        let events = EventHub::default();
        let sessions = SessionApi::new(
            PiSessionRegistry::new(database.processes()),
            DiscoverPiOptions {
                executable_path: Some(executable.map_or(pi, |name| directory.path().join(name))),
                path: Default::default(),
                home_directory: Some(directory.path().to_path_buf()),
                agent_directory: None,
                session_directory: None,
                working_directory: directory.path().to_path_buf(),
            },
            events.clone(),
        );
        let app = router_with_services(
            ApiToken::configured(TOKEN).unwrap(),
            events.clone(),
            Some(workspaces),
            default_diagnostics(),
            None,
            Some(SandboxApi::new(
                database.sandbox_selection(),
                directory.path().join("sandbox"),
            )),
            Some(sessions),
        );
        Self {
            _directory: directory,
            workspace_root,
            workspace_id: workspace.id,
            database,
            events,
            app,
        }
    }

    async fn call(&self, method: &str, path: &str, body: Option<Value>) -> (StatusCode, Value) {
        let request = Request::builder()
            .method(method)
            .uri(path)
            .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(body.map_or_else(Body::empty, |body| Body::from(body.to_string())))
            .unwrap();
        let response = self.app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    async fn start(&self, model: Option<Value>) -> (StatusCode, Value) {
        self.call(
            "POST",
            "/api/sessions",
            Some(json!({"workspace_id": self.workspace_id, "model": model})),
        )
        .await
    }

    /// Command types the fake Pi received, in order.
    fn commands(&self) -> Vec<String> {
        fs::read_to_string(self.workspace_root.join("commands.jsonl"))
            .unwrap_or_default()
            .lines()
            .map(|line| {
                let command: Value = serde_json::from_str(line).unwrap();
                command["type"].as_str().unwrap().to_owned()
            })
            .collect()
    }
}

/// Reads the event stream until an event matches.
async fn next_event(
    subscription: &mut EventSubscription,
    mut matches: impl FnMut(&ServerEvent) -> bool,
) -> ServerEvent {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let event = subscription.receiver.recv().await.unwrap();
            if matches(&event) {
                return event;
            }
        }
    })
    .await
    .expect("the expected event never arrived")
}

fn session_changed(status: &'static str) -> impl FnMut(&ServerEvent) -> bool {
    move |event| {
        event.kind == ServerEventKind::SessionChanged
            && serde_json::from_str::<Value>(&event.payload).unwrap()["status"] == status
    }
}

fn output(kind: &'static str) -> impl FnMut(&ServerEvent) -> bool {
    move |event| {
        event.kind == ServerEventKind::SessionOutput
            && serde_json::from_str::<Value>(&event.payload).unwrap()["type"] == kind
    }
}

#[tokio::test]
async fn controls_a_pi_session_over_http_and_the_event_stream() {
    let fixture = Fixture::new(None).await;
    let mut stream = fixture.events.subscribe(None);

    let (status, session) = fixture
        .start(Some(
            json!({"provider": "fixture", "model_id": "model-one"}),
        ))
        .await;
    assert_eq!(status, StatusCode::CREATED, "{session}");
    assert_eq!(session["status"], "idle");
    assert_eq!(session["workspace_id"], fixture.workspace_id);
    assert_eq!(session["capabilities"]["prompt"], true);
    let id = session["id"].as_str().unwrap().to_owned();
    let base = format!("/api/sessions/{id}");
    let started = next_event(&mut stream, session_changed("idle")).await;
    assert_eq!(started.session_id.as_deref(), Some(id.as_str()));

    let (status, listed) = fixture.call("GET", "/api/sessions", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(listed[0]["id"], id);

    let (status, commands) = fixture.call("GET", &format!("{base}/commands"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        commands,
        json!([
            {"name": "review", "description": "Review the changes", "source": "prompt", "path": "/prompts/review.md"},
            {"name": "skill:lint", "description": null, "source": "skill", "path": null},
        ])
    );

    let (status, models) = fixture.call("GET", &format!("{base}/models"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        models,
        json!([
            {"provider": "fixture", "id": "model-one", "name": "Model One", "reasoning": true, "current": true},
            {"provider": "fixture", "id": "model-two", "name": null, "reasoning": false, "current": false},
        ])
    );

    let (status, history) = fixture.call("GET", &format!("{base}/history"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(history, json!(["second", "first"]));

    let model = json!({"provider": "fixture", "model_id": "model-one"});
    let (status, selected) = fixture
        .call("PUT", &format!("{base}/model"), Some(model))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(selected["id"], "model-one");
    let missing = json!({"provider": "fixture", "model_id": "missing"});
    let (status, rejected) = fixture
        .call("PUT", &format!("{base}/model"), Some(missing))
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(rejected["code"], "control_rejected");

    let level = json!({"level": "xhigh"});
    let (status, _) = fixture
        .call("PUT", &format!("{base}/thinking-level"), Some(level))
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, compacted) = fixture
        .call("POST", &format!("{base}/compact"), Some(json!({})))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(compacted["summary"], "Short summary");
    assert_eq!(compacted["first_kept_entry_id"], "entry-2");
    assert_eq!(compacted["tokens_before"], 9000);
    next_event(&mut stream, output("compaction_start")).await;
    next_event(&mut stream, output("compaction_end")).await;
    let failing = json!({"custom_instructions": "fail"});
    let (status, failed) = fixture
        .call("POST", &format!("{base}/compact"), Some(failing))
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(failed["code"], "control_rejected");
    next_event(&mut stream, output("compaction_end")).await;
    for enabled in [false, true] {
        let (status, _) = fixture
            .call(
                "PUT",
                &format!("{base}/auto-compaction"),
                Some(json!({"enabled": enabled})),
            )
            .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
    }

    let prompt_path = format!("{base}/prompt");
    let prompt = |body: Value| fixture.call("POST", &prompt_path, Some(body));
    assert_eq!(
        prompt(json!({"message": "start"})).await.0,
        StatusCode::ACCEPTED
    );
    next_event(&mut stream, output("agent_start")).await;
    next_event(&mut stream, session_changed("running")).await;
    let (status, ambiguous) = prompt(json!({"message": "again"})).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(ambiguous["code"], "invalid_session_state");
    assert_eq!(
        prompt(json!({"message": "queued", "queue": "follow_up"}))
            .await
            .0,
        StatusCode::ACCEPTED
    );

    let steer = json!({"message": "change course"});
    let (status, _) = fixture
        .call("POST", &format!("{base}/steer"), Some(steer))
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let follow_up = json!({"message": "later"});
    let (status, _) = fixture
        .call("POST", &format!("{base}/follow-up"), Some(follow_up))
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    next_event(&mut stream, output("queue_update")).await;
    let queued = json!({"steering": ["change course"], "follow_up": ["later"]});
    let mut queue = Value::Null;
    for _ in 0..100 {
        queue = fixture.call("GET", &format!("{base}/queue"), None).await.1;
        if queue == queued {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(queue, queued);
    let (status, cleared) = fixture.call("DELETE", &format!("{base}/queue"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(cleared, queued);

    let (status, _) = fixture
        .call("POST", &format!("{base}/interrupt"), None)
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    next_event(&mut stream, session_changed("idle")).await;
    assert_eq!(fixture.call("GET", &base, None).await.1["status"], "idle");
    next_event(&mut stream, output("session_usage")).await;

    let reconnected = fixture.events.subscribe(None);
    let [ServerStreamMessage::Snapshot { snapshot }] = &reconnected.initial[..] else {
        panic!("a new subscriber starts from a snapshot");
    };
    assert!(
        snapshot
            .events
            .iter()
            .all(|event| event.kind != ServerEventKind::SessionOutput)
    );

    let (status, _) = fixture.call("DELETE", &base, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let stopped = next_event(&mut stream, session_changed("stopped")).await;
    let stopped: Value = serde_json::from_str(&stopped.payload).unwrap();
    assert!(stopped["ended_at"].is_string());
    let (status, missing) = fixture.call("GET", &base, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(missing["code"], "not_found");
    assert_eq!(
        fixture.call("GET", "/api/sessions", None).await.1,
        json!([])
    );

    assert_eq!(
        fixture.commands(),
        [
            "get_state",
            "set_model",
            "get_commands",
            "get_state",
            "get_available_models",
            "get_entries",
            "set_model",
            "set_model",
            "set_thinking_level",
            "compact",
            "compact",
            "set_auto_compaction",
            "set_auto_compaction",
            "prompt",
            "prompt",
            "steer",
            "follow_up",
            "clear_queue",
            "abort",
            "get_session_stats",
        ]
    );
}

#[tokio::test]
async fn reports_usage_on_request_and_after_assistant_messages() {
    let fixture = Fixture::new(None).await;
    let mut stream = fixture.events.subscribe(None);
    let (_, session) = fixture.start(None).await;
    assert_eq!(session["capabilities"]["usage"], true);
    let base = format!("/api/sessions/{}", session["id"].as_str().unwrap());
    let expected = json!({
        "context": {"tokens": 60000, "context_window": 200000, "percent": 30.0},
        "tokens": {"input": 50000, "output": 10000, "cache_read": 40000, "cache_write": 5000, "total": 105000},
        "cost": 0.45,
    });

    let (status, usage) = fixture.call("GET", &format!("{base}/usage"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(usage, expected);

    let prompt = json!({"message": "usage"});
    let (status, _) = fixture
        .call("POST", &format!("{base}/prompt"), Some(prompt))
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let event = next_event(&mut stream, output("session_usage")).await;
    let event: Value = serde_json::from_str(&event.payload).unwrap();
    assert_eq!(event["usage"], expected);
    // Only the assistant message ends a refresh: one read from the route and
    // one from the event.
    assert_eq!(
        fixture.commands(),
        [
            "get_state",
            "get_session_stats",
            "prompt",
            "get_session_stats"
        ]
    );

    let (status, missing) = fixture
        .call("GET", "/api/sessions/missing/usage", None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(missing["code"], "not_found");
}

#[tokio::test]
async fn reports_a_session_that_exits_during_a_request() {
    let fixture = Fixture::new(None).await;
    let mut stream = fixture.events.subscribe(None);
    let (_, session) = fixture.start(None).await;
    let base = format!("/api/sessions/{}", session["id"].as_str().unwrap());

    let (status, error) = fixture
        .call(
            "POST",
            &format!("{base}/prompt"),
            Some(json!({"message": "exit"})),
        )
        .await;
    assert_eq!(status, StatusCode::GONE);
    assert_eq!(error["code"], "session_exited");

    let failed = next_event(&mut stream, session_changed("failed")).await;
    let failed: Value = serde_json::from_str(&failed.payload).unwrap();
    assert_eq!(failed["exit_code"], 3);
    assert!(failed["ended_at"].is_string());
    // The registry drops the session once its exit arrives.
    for _ in 0..100 {
        if fixture.call("GET", &base, None).await.0 == StatusCode::NOT_FOUND {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("the exited session stayed listed");
}

#[tokio::test]
async fn refuses_to_start_without_a_usable_launch() {
    let fixture = Fixture::new(Some("missing pi")).await;
    let (status, error) = fixture.start(None).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(error["code"], "pi_unavailable");
    assert!(
        error["message"]
            .as_str()
            .unwrap()
            .contains("does not exist")
    );

    let fixture = Fixture::new(None).await;
    let (status, error) = fixture
        .start(Some(json!({"provider": "fixture", "model_id": "missing"})))
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(error["code"], "control_rejected");
    assert_eq!(
        fixture.call("GET", "/api/sessions", None).await.1,
        json!([])
    );

    let unknown = json!({"workspace_id": "unknown"});
    let (status, error) = fixture.call("POST", "/api/sessions", Some(unknown)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error["code"], "not_found");
    let (status, _) = fixture
        .call("POST", "/api/sessions/unknown/interrupt", None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let sandboxed: SandboxSelection = serde_json::from_value(json!({
        "mode": "sandboxed",
        "settings": {
            "profile": "workspace-write",
            "grants": {"domains": [], "writable_roots": [], "unix_sockets": false},
        },
    }))
    .unwrap();
    fixture
        .database
        .sandbox_selection()
        .set_workspace_default(&fixture.workspace_id, &sandboxed, &diagnostic_timestamp())
        .await
        .unwrap();
    let (status, error) = fixture.start(None).await;
    assert_eq!(status, StatusCode::NOT_IMPLEMENTED);
    assert_eq!(error["code"], "sandboxed_session_unsupported");
}

/// Writes a Pi session file into the fixture workspace's session directory.
fn write_native_session(fixture: &Fixture, file: &str, contents: &str) {
    let root = fixture.workspace_root.canonicalize().unwrap();
    let encoded = root
        .to_str()
        .unwrap()
        .trim_start_matches('/')
        .replace('/', "-");
    let directory = fixture
        ._directory
        .path()
        .join(".pi/agent/sessions")
        .join(format!("--{encoded}--"));
    fs::create_dir_all(&directory).unwrap();
    fs::write(directory.join(file), contents).unwrap();
}

/// A session header for the fixture workspace, or for `cwd` when given.
fn native_header(fixture: &Fixture, id: &str, cwd: Option<&str>) -> String {
    let root = fixture.workspace_root.canonicalize().unwrap();
    let cwd = cwd.unwrap_or_else(|| root.to_str().unwrap());
    json!({"type": "session", "version": 3, "id": id, "timestamp": "2026-01-02T03:04:05.000Z", "cwd": cwd}).to_string()
}

#[tokio::test]
async fn lists_and_resumes_native_sessions() {
    let fixture = Fixture::new(None).await;
    let list_path = format!("/api/workspaces/{}/pi-sessions", fixture.workspace_id);
    let (status, list) = fixture.call("GET", &list_path, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list, json!({"sessions": [], "warnings": []}));

    let user = r#"{"type":"message","message":{"role":"user","content":"Fix the login bug"}}"#;
    let good = format!("{}\n{user}", native_header(&fixture, "good", None));
    write_native_session(&fixture, "2026_good.jsonl", &good);
    write_native_session(&fixture, "2026_broken.jsonl", "not json");
    let foreign = native_header(&fixture, "foreign", Some("/elsewhere"));
    write_native_session(&fixture, "2026_foreign.jsonl", &foreign);

    let (_, list) = fixture.call("GET", &list_path, None).await;
    let sessions = list["sessions"].as_array().unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0]["id"], "good");
    assert_eq!(sessions[0]["first_message"], "Fix the login bug");
    assert!(sessions[0]["modified_at"].is_string());
    assert_eq!(list["warnings"].as_array().unwrap().len(), 2);

    let (status, started) = fixture
        .call(
            "POST",
            "/api/sessions",
            Some(json!({"workspace_id": fixture.workspace_id, "native_session_id": "good"})),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(started["status"], "idle");
    let args = fs::read_to_string(fixture.workspace_root.join("args.txt")).unwrap();
    assert!(args.starts_with("--mode rpc --session "));
    assert!(args.trim_end().ends_with("2026_good.jsonl"));

    for (id, status, code) in [
        ("missing", StatusCode::NOT_FOUND, "native_session_not_found"),
        (
            "broken",
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_native_session",
        ),
        (
            "foreign",
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_native_session",
        ),
        (
            "../../etc/passwd",
            StatusCode::NOT_FOUND,
            "native_session_not_found",
        ),
    ] {
        let (got, error) = fixture
            .call(
                "POST",
                "/api/sessions",
                Some(json!({"workspace_id": fixture.workspace_id, "native_session_id": id})),
            )
            .await;
        assert_eq!(
            (got, error["code"].as_str().unwrap()),
            (status, code),
            "{id}"
        );
    }
}

/// Matches the last request the fake Pi sends for a `dialogs` prompt. The
/// API applies a request before it publishes it, so once this event arrives
/// every earlier request is already part of the session's extension UI.
fn last_dialog_request(event: &ServerEvent) -> bool {
    event.kind == ServerEventKind::SessionOutput
        && serde_json::from_str::<Value>(&event.payload).unwrap()["id"] == "ui-widget"
}

#[tokio::test]
async fn forwards_extension_ui_and_accepts_responses() {
    let widget_request = last_dialog_request;
    let fixture = Fixture::new(None).await;
    let mut stream = fixture.events.subscribe(None);
    let (_, session) = fixture.start(None).await;
    let base = format!("/api/sessions/{}", session["id"].as_str().unwrap());
    let ui = format!("{base}/extension-ui");

    let (status, _) = fixture
        .call(
            "POST",
            &format!("{base}/prompt"),
            Some(json!({"message": "dialogs"})),
        )
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    next_event(&mut stream, widget_request).await;

    // A client that connects now still finds the unanswered dialogs.
    let (status, state) = fixture.call("GET", &ui, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        state["dialogs"],
        json!([
            {"kind": "select", "id": "ui-select", "title": "Pick", "options": ["a", "b"], "timeout_ms": null},
            {"kind": "confirm", "id": "ui-confirm", "title": "Sure?", "message": "Delete it", "timeout_ms": null},
            {"kind": "input", "id": "ui-input", "title": "Name", "placeholder": "x", "timeout_ms": null},
            {"kind": "editor", "id": "ui-editor", "title": "Edit", "prefill": "text"},
        ])
    );
    assert_eq!(state["statuses"], json!([{"key": "k", "text": "busy"}]));
    assert_eq!(
        state["widgets"],
        json!([{"key": "w", "lines": ["one"], "placement": "below-editor"}])
    );

    let answer = |id: &str, body: Value| {
        let path = format!("{ui}/{id}");
        let fixture = &fixture;
        async move { fixture.call("POST", &path, Some(body)).await }
    };
    // Answers that do not fit the dialog leave it waiting.
    let (status, error) = answer("ui-select", json!({"value": "c"})).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(error["code"], "invalid_extension_response");
    let (status, _) = answer("ui-input", json!({"confirmed": true})).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    for (id, body) in [
        ("ui-select", json!({"value": "b"})),
        ("ui-confirm", json!({"confirmed": false})),
        ("ui-input", json!({"value": "Pau"})),
    ] {
        let (status, _) = answer(id, body).await;
        assert_eq!(status, StatusCode::NO_CONTENT, "{id}");
    }
    let (status, _) = answer("ui-editor", json!({"cancelled": true})).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Answered, cancelled, and unknown requests are all stale.
    for id in ["ui-select", "ui-editor", "never-asked"] {
        let (status, error) = answer(id, json!({"cancelled": true})).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{id}");
        assert_eq!(error["code"], "extension_request_not_found");
    }
    let (_, state) = fixture.call("GET", &ui, None).await;
    assert_eq!(state["dialogs"], json!([]));

    // The fake Pi logs each record as it reads it, so wait for the last one.
    let mut responses: Vec<Value> = Vec::new();
    for _ in 0..100 {
        responses = fs::read_to_string(fixture.workspace_root.join("commands.jsonl"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .filter(|command: &Value| command["type"] == "extension_ui_response")
            .collect();
        if responses.len() == 4 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(
        responses,
        [
            json!({"type": "extension_ui_response", "id": "ui-select", "value": "b"}),
            json!({"type": "extension_ui_response", "id": "ui-confirm", "confirmed": false}),
            json!({"type": "extension_ui_response", "id": "ui-input", "value": "Pau"}),
            json!({"type": "extension_ui_response", "id": "ui-editor", "cancelled": true}),
        ]
    );

    let (status, _) = fixture
        .call("GET", "/api/sessions/missing/extension-ui", None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn clears_pending_dialogs_on_interrupt_timeout_and_exit() {
    let widget_request = last_dialog_request;
    let fixture = Fixture::new(None).await;
    let mut stream = fixture.events.subscribe(None);
    let (_, session) = fixture.start(None).await;
    let base = format!("/api/sessions/{}", session["id"].as_str().unwrap());
    let ui = format!("{base}/extension-ui");
    let resolved = |request: &'static str, reason: &'static str| {
        move |event: &ServerEvent| {
            let payload: Value = serde_json::from_str(&event.payload).unwrap();
            event.kind == ServerEventKind::SessionOutput
                && payload["type"] == "extension_ui_resolved"
                && payload["id"] == request
                && payload["reason"] == reason
        }
    };

    // Pi times a dialog out without telling the client, so the API does.
    fixture
        .call(
            "POST",
            &format!("{base}/prompt"),
            Some(json!({"message": "expiring"})),
        )
        .await;
    next_event(&mut stream, resolved("ui-short", "timed_out")).await;
    let (_, state) = fixture.call("GET", &ui, None).await;
    assert_eq!(state["dialogs"], json!([]));

    fixture
        .call("POST", &format!("{base}/interrupt"), None)
        .await;

    // An interrupt abandons the dialogs of the run it stops.
    fixture
        .call(
            "POST",
            &format!("{base}/prompt"),
            Some(json!({"message": "dialogs"})),
        )
        .await;
    next_event(&mut stream, widget_request).await;
    let (status, _) = fixture
        .call("POST", &format!("{base}/interrupt"), None)
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    next_event(&mut stream, resolved("ui-editor", "interrupted")).await;
    let (_, state) = fixture.call("GET", &ui, None).await;
    assert_eq!(state["dialogs"], json!([]));
    assert_eq!(state["statuses"], json!([{"key": "k", "text": "busy"}]));
    let (status, _) = fixture
        .call(
            "POST",
            &format!("{ui}/ui-select"),
            Some(json!({"value": "a"})),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // An exit drops the session's extension UI along with the session.
    fixture
        .call(
            "POST",
            &format!("{base}/prompt"),
            Some(json!({"message": "dialogs"})),
        )
        .await;
    next_event(&mut stream, widget_request).await;
    fixture.call("DELETE", &base, None).await;
    next_event(&mut stream, resolved("ui-editor", "exited")).await;
    let (status, _) = fixture.call("GET", &ui, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
