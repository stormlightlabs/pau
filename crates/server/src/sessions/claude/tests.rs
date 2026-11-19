use std::{fs, os::unix::fs::PermissionsExt, path::Path, path::PathBuf, time::Duration};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::Request,
    http::{StatusCode, header},
};
use pau_agent::DiscoverClaudeOptions;
use pau_core::{
    ServerEvent,
    audit::{AuditLog, AuditOperation, AuditResult},
    persistence::Database,
    workspace::WorkspaceService,
};
use pau_pi::{DiscoverPiOptions, PiSessionRegistry};
use serde_json::{Value, json};
use tempfile::TempDir;
use tower::ServiceExt;

use super::super::SessionApi;
use crate::{
    ApiServices, ApiToken, EventHub, EventSubscription, SandboxApi, default_diagnostics,
    router_with_services,
};
use pau_core::ServerEventKind;

const TOKEN: &str = "0123456789abcdef0123456789abcdef";

/// The Claude session ID the fake bridge reports for every turn.
const NATIVE_ID: &str = "0b5e8a3c-6f1d-4c2a-9e7b-3d4f5a6b7c8d";

/// A Claude bridge host stand-in. It records its arguments in the working
/// directory, answers `status`, `prompt`, and `interrupt`, streams the model,
/// one text delta and a completed turn for each prompt, and exits when its
/// input closes. The prompt `fail` gets a failed turn without a model
/// instead, and the prompt `wait` streams its delta and runs until
/// `interrupt` ends the turn.
const FAKE_BRIDGE: &str = r#"#!/bin/sh
printf '%s\n' "$*" > "$PWD/bridge-args.txt"
while IFS= read -r line; do
    id=$(printf '%s' "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
    case "$line" in
        *'"command":"status"'*)
            printf '{"version":1,"type":"response","id":"%s","ok":true,"result":{"capabilities":{"prompt":true,"interrupt":true,"stop":true},"nativeSessionId":null}}\n' "$id"
            ;;
        *'"text":"fail"'*)
            printf '{"version":1,"type":"response","id":"%s","ok":true,"result":{"accepted":true}}\n' "$id"
            printf '{"version":1,"type":"event","sequence":0,"event":"turn.completed","payload":{"status":"failed","error":"overloaded","sessionId":"0b5e8a3c-6f1d-4c2a-9e7b-3d4f5a6b7c8d"}}\n'
            ;;
        *'"text":"wait"'*)
            printf '{"version":1,"type":"response","id":"%s","ok":true,"result":{"accepted":true}}\n' "$id"
            printf '{"version":1,"type":"event","sequence":0,"event":"text.delta","payload":{"text":"working"}}\n'
            ;;
        *'"command":"interrupt"'*)
            printf '{"version":1,"type":"response","id":"%s","ok":true,"result":{}}\n' "$id"
            printf '{"version":1,"type":"event","sequence":1,"event":"turn.completed","payload":{"status":"interrupted","sessionId":"0b5e8a3c-6f1d-4c2a-9e7b-3d4f5a6b7c8d"}}\n'
            ;;
        *'"command":"prompt"'*)
            printf '{"version":1,"type":"response","id":"%s","ok":true,"result":{"accepted":true}}\n' "$id"
            printf '{"version":1,"type":"event","sequence":0,"event":"session.model","payload":{"model":"claude-sonnet-4-5"}}\n'
            printf '{"version":1,"type":"event","sequence":1,"event":"text.delta","payload":{"text":"fixture output"}}\n'
            printf '{"version":1,"type":"event","sequence":2,"event":"turn.completed","payload":{"status":"completed","sessionId":"0b5e8a3c-6f1d-4c2a-9e7b-3d4f5a6b7c8d"}}\n'
            ;;
        *)
            printf '{"version":1,"type":"response","id":"%s","ok":true,"result":{}}\n' "$id"
            ;;
    esac
done
"#;

fn write_executable(directory: &Path, name: &str, contents: &str) -> PathBuf {
    let path = directory.join(name);
    fs::write(&path, contents).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path
}

struct Fixture {
    _directory: TempDir,
    workspace_root: PathBuf,
    workspace_id: String,
    events: EventHub,
    audit: AuditLog,
    app: Router,
}

impl Fixture {
    /// Serves the API with a fake Claude Code and bridge, or with no Claude
    /// Code anywhere when `installed` is false. Pi is never installed.
    async fn new(installed: bool) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let claude = write_executable(
            directory.path(),
            "claude",
            "#!/bin/sh\necho '2.1.281 (Claude Code)'\n",
        );
        let bridge = write_executable(directory.path(), "pau-claude-bridge", FAKE_BRIDGE);
        let workspace_root = directory.path().join("project");
        fs::create_dir(&workspace_root).unwrap();
        let database = Database::open(":memory:").await.unwrap();
        let workspaces = WorkspaceService::new(database.workspaces());
        let workspace = workspaces.open(&workspace_root, None).await.unwrap();
        let events = EventHub::default();
        let audit = AuditLog::new(database.audit(), Default::default());
        let sessions = SessionApi::new(
            PiSessionRegistry::new(database.processes()),
            DiscoverPiOptions {
                executable_path: Some(directory.path().join("missing pi")),
                path: crate::sessions::tests::FIXTURE_PATH.as_str().into(),
                home_directory: Some(directory.path().to_path_buf()),
                agent_directory: None,
                session_directory: None,
                working_directory: directory.path().to_path_buf(),
            },
            events.clone(),
            audit.clone(),
        )
        .with_claude_discovery(DiscoverClaudeOptions {
            executable_path: installed.then_some(claude),
            bridge_path: installed.then_some(bridge),
            path: crate::sessions::tests::FIXTURE_PATH.as_str().into(),
        });
        let app = router_with_services(
            ApiToken::configured(TOKEN).unwrap(),
            events.clone(),
            default_diagnostics(),
            ApiServices {
                workspaces: Some(workspaces),
                sandbox: Some(SandboxApi::new(
                    database.sandbox_selection(),
                    directory.path().join("sandbox"),
                    std::env::var_os("PATH").unwrap_or_default(),
                )),
                sessions: Some(sessions),
                audit: audit.clone(),
                ..ApiServices::default()
            },
        );
        Self {
            _directory: directory,
            workspace_root,
            workspace_id: workspace.id,
            events,
            audit,
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

    async fn start(&self, request: Value) -> (StatusCode, Value) {
        let mut body = json!({"workspace_id": self.workspace_id, "model": null});
        body.as_object_mut()
            .unwrap()
            .extend(request.as_object().unwrap().clone());
        self.call("POST", "/api/sessions", Some(body)).await
    }
}

/// Reads the event stream until an event matches.
async fn next_event(
    subscription: &mut EventSubscription,
    mut matches: impl FnMut(&ServerEvent, &Value) -> bool,
) -> Value {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let event = subscription.receiver.recv().await.unwrap();
            let payload: Value = serde_json::from_str(&event.payload).unwrap();
            if matches(&event, &payload) {
                return payload;
            }
        }
    })
    .await
    .expect("the expected event never arrived")
}

#[tokio::test]
async fn starts_prompts_streams_and_stops_a_claude_session() {
    let fixture = Fixture::new(true).await;
    let mut stream = fixture.events.subscribe(None);

    let (status, session) = fixture.start(json!({"agent": "claude"})).await;
    assert_eq!(status, StatusCode::CREATED, "{session}");
    assert_eq!(session["agent"], "claude");
    assert_eq!(session["status"], "idle");
    assert!(session["model"].is_null(), "{session}");
    assert_eq!(session["workspace_id"], fixture.workspace_id);
    let capabilities = &session["capabilities"];
    assert_eq!(capabilities["prompt"], true);
    assert_eq!(capabilities["interrupt"], true);
    assert_eq!(capabilities["stop"], true);
    assert_eq!(capabilities["steer"], false);
    assert_eq!(capabilities["model_selection"], false);
    let id = session["id"].as_str().unwrap().to_owned();
    let base = format!("/api/sessions/{id}");

    let arguments = fs::read_to_string(fixture.workspace_root.join("bridge-args.txt")).unwrap();
    assert!(arguments.starts_with("--claude "), "{arguments}");
    assert!(arguments.contains("--cwd "), "{arguments}");

    let (status, _) = fixture
        .call(
            "POST",
            &format!("{base}/prompt"),
            Some(json!({"message": "hello"})),
        )
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let delta = next_event(&mut stream, |event, payload| {
        event.kind == ServerEventKind::SessionOutput && payload["event"] == "text.delta"
    })
    .await;
    assert_eq!(delta["payload"]["text"], "fixture output");
    let settled = next_event(&mut stream, |event, payload| {
        event.kind == ServerEventKind::SessionChanged && payload["status"] == "idle"
    })
    .await;
    assert_eq!(settled["native_session_id"], NATIVE_ID);
    assert_eq!(settled["model"], "claude-sonnet-4-5");

    let (status, listed) = fixture.call("GET", "/api/sessions", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(listed[0]["id"], id.as_str());
    assert_eq!(listed[0]["agent"], "claude");
    assert_eq!(listed[0]["model"], "claude-sonnet-4-5");

    // Controls the bridge does not offer are refused, not misrouted to Pi.
    let (status, error) = fixture.call("GET", &format!("{base}/queue"), None).await;
    assert_eq!(status, StatusCode::NOT_IMPLEMENTED);
    assert_eq!(error["code"], "unsupported_control");
    let (status, error) = fixture
        .call(
            "POST",
            &format!("{base}/prompt"),
            Some(json!({"message": "later", "queue": "follow_up"})),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_IMPLEMENTED);
    assert_eq!(error["code"], "unsupported_control");

    let (status, _) = fixture.call("DELETE", &base, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let stopped = next_event(&mut stream, |event, payload| {
        event.kind == ServerEventKind::SessionChanged && payload["status"] == "stopped"
    })
    .await;
    assert!(stopped["ended_at"].is_string());
    assert_eq!(
        fixture.call("GET", "/api/sessions", None).await.1,
        json!([])
    );

    let records = fixture.audit.list().await.unwrap();
    let recorded: Vec<_> = records
        .iter()
        .map(|record| {
            (
                record.entry.operation,
                record.entry.result,
                record.entry.session_id.as_deref(),
                record.entry.target.as_deref(),
            )
        })
        .collect();
    assert_eq!(
        recorded,
        [
            (
                AuditOperation::SessionStart,
                AuditResult::Succeeded,
                Some(id.as_str()),
                Some("claude")
            ),
            (
                AuditOperation::SessionStop,
                AuditResult::Succeeded,
                Some(id.as_str()),
                Some("claude")
            ),
        ]
    );
}

#[tokio::test]
async fn interrupts_a_running_turn_and_resumes_the_conversation_later() {
    let fixture = Fixture::new(true).await;
    let mut stream = fixture.events.subscribe(None);
    let (_, session) = fixture.start(json!({"agent": "claude"})).await;
    let base = format!("/api/sessions/{}", session["id"].as_str().unwrap());

    let (status, _) = fixture
        .call(
            "POST",
            &format!("{base}/prompt"),
            Some(json!({"message": "wait"})),
        )
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let delta = next_event(&mut stream, |event, payload| {
        event.kind == ServerEventKind::SessionOutput && payload["event"] == "text.delta"
    })
    .await;
    assert_eq!(delta["payload"]["text"], "working");
    assert_eq!(
        fixture.call("GET", &base, None).await.1["status"],
        "running"
    );

    let (status, cleared) = fixture
        .call("POST", &format!("{base}/interrupt"), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{cleared}");
    // The interrupt is announced before the turn ends, so clients do not
    // report the idle session as a finished turn.
    next_event(&mut stream, |event, payload| {
        event.kind == ServerEventKind::SessionOutput && payload["type"] == "session_interrupted"
    })
    .await;
    let ended = next_event(&mut stream, |event, payload| {
        event.kind == ServerEventKind::SessionOutput && payload["event"] == "turn.completed"
    })
    .await;
    assert_eq!(ended["payload"]["status"], "interrupted");
    let settled = next_event(&mut stream, |event, payload| {
        event.kind == ServerEventKind::SessionChanged && payload["status"] == "idle"
    })
    .await;
    assert_eq!(settled["native_session_id"], NATIVE_ID);

    let (status, _) = fixture.call("DELETE", &base, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    next_event(&mut stream, |event, payload| {
        event.kind == ServerEventKind::SessionChanged && payload["status"] == "stopped"
    })
    .await;

    // Starting again with the reported ID resumes the same conversation.
    let (status, resumed) = fixture
        .start(json!({"agent": "claude", "native_session_id": NATIVE_ID}))
        .await;
    assert_eq!(status, StatusCode::CREATED, "{resumed}");
    assert_eq!(resumed["native_session_id"], NATIVE_ID);
    let arguments = fs::read_to_string(fixture.workspace_root.join("bridge-args.txt")).unwrap();
    assert!(
        arguments.ends_with(&format!("--resume {NATIVE_ID}\n")),
        "{arguments}"
    );
    let base = format!("/api/sessions/{}", resumed["id"].as_str().unwrap());
    let (status, _) = fixture
        .call(
            "POST",
            &format!("{base}/prompt"),
            Some(json!({"message": "continue"})),
        )
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let delta = next_event(&mut stream, |event, payload| {
        event.kind == ServerEventKind::SessionOutput
            && payload["event"] == "text.delta"
            && payload["payload"]["text"] == "fixture output"
    })
    .await;
    assert_eq!(delta["payload"]["text"], "fixture output");
}

#[tokio::test]
async fn refuses_an_unknown_or_unavailable_agent_with_its_reason() {
    let fixture = Fixture::new(false).await;

    let (status, error) = fixture.start(json!({"agent": "codex"})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error["code"], "unknown_agent");
    assert_eq!(
        error["message"],
        "Pau does not support the agent `codex`. Choose one of: pi, claude."
    );

    let (status, error) = fixture.start(json!({"agent": "claude"})).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(error["code"], "agent_unavailable");
    assert!(
        error["message"]
            .as_str()
            .unwrap()
            .contains("Claude Code was not found"),
        "{error}"
    );

    // Naming Pi explicitly takes the same path as naming no agent.
    let (status, error) = fixture.start(json!({"agent": "pi"})).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(error["code"], "pi_unavailable");

    let fixture = Fixture::new(true).await;
    let (status, error) = fixture
        .start(json!({"agent": "claude", "model": {"provider": "anthropic", "model_id": "opus"}}))
        .await;
    assert_eq!(status, StatusCode::NOT_IMPLEMENTED);
    assert_eq!(error["code"], "unsupported_control");
    assert_eq!(
        fixture.call("GET", "/api/sessions", None).await.1,
        json!([])
    );
}

#[tokio::test]
async fn a_failed_turn_leaves_the_session_ready_for_the_next_prompt() {
    let fixture = Fixture::new(true).await;
    let mut stream = fixture.events.subscribe(None);
    let (_, session) = fixture.start(json!({"agent": "claude"})).await;
    let base = format!("/api/sessions/{}", session["id"].as_str().unwrap());

    let (status, _) = fixture
        .call(
            "POST",
            &format!("{base}/prompt"),
            Some(json!({"message": "fail"})),
        )
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let failed = next_event(&mut stream, |event, payload| {
        event.kind == ServerEventKind::SessionOutput && payload["event"] == "turn.completed"
    })
    .await;
    assert_eq!(failed["payload"]["error"], "overloaded");
    let settled = next_event(&mut stream, |event, _| {
        event.kind == ServerEventKind::SessionChanged
    })
    .await;
    assert_eq!(settled["status"], "idle");
    // That turn named no model, so the session reports none.
    assert!(settled["model"].is_null(), "{settled}");

    // The session's own observer applies the same turn, so wait for it.
    tokio::time::timeout(Duration::from_secs(5), async {
        while fixture.call("GET", &base, None).await.1["status"] != "idle" {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the session never became idle");
    let (status, body) = fixture
        .call(
            "POST",
            &format!("{base}/prompt"),
            Some(json!({"message": "again"})),
        )
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    let (status, body) = fixture.call("DELETE", &base, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
}

#[tokio::test]
async fn refuses_a_native_session_id_that_is_not_a_uuid() {
    let fixture = Fixture::new(true).await;
    let (status, error) = fixture
        .start(json!({"agent": "claude", "native_session_id": "--dangerously-skip-permissions"}))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    assert_eq!(error["code"], "invalid_native_session_id");
    assert!(!fixture.workspace_root.join("bridge-args.txt").exists());

    let (status, session) = fixture
        .start(
            json!({"agent": "claude", "native_session_id": "0b5e8a3c-6f1d-4c2a-9e7b-3d4f5a6b7c8d"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{session}");
    let arguments = fs::read_to_string(fixture.workspace_root.join("bridge-args.txt")).unwrap();
    assert!(
        arguments.ends_with("--resume 0b5e8a3c-6f1d-4c2a-9e7b-3d4f5a6b7c8d\n"),
        "{arguments}"
    );
}
