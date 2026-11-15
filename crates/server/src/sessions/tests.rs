use std::{env, fs, os::unix::fs::PermissionsExt, path::PathBuf, sync::LazyLock, time::Duration};

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

/// The `PATH` agent fixtures run with: the directories that hold the tools
/// the fake agents call, found on the test's own `PATH` so the fixtures also
/// run where those tools live outside `/usr/bin` and `/bin`, as on NixOS. No
/// real Pi or Claude Code may sit beside them, or a test could start one by
/// mistake.
pub(crate) static FIXTURE_PATH: LazyLock<String> = LazyLock::new(|| {
    let search = env::var_os("PATH").unwrap_or_default();
    let mut directories: Vec<PathBuf> = Vec::new();
    for tool in ["sed", "cat", "rm"] {
        let directory = env::split_paths(&search)
            .find(|directory| directory.join(tool).is_file())
            .unwrap_or_else(|| panic!("agent fixtures need `{tool}` on the test's PATH"));
        if !directories.contains(&directory) {
            directories.push(directory);
        }
    }
    for directory in &directories {
        for agent in ["pi", "claude"] {
            assert!(
                !directory.join(agent).exists(),
                "agent fixtures cannot use {} on PATH: it holds a real `{agent}`",
                directory.display()
            );
        }
    }
    env::join_paths(directories)
        .expect("tool directories form a PATH")
        .into_string()
        .expect("tool directories are UTF-8")
});

/// A Pi RPC stand-in. It records every command in the workspace, answers the
/// controls the session API sends, and exits with status 3 without answering
/// a prompt whose text is `exit`. Shell commands other than `echo hi` and
/// `sleep 60`, which runs until `abort_bash`, fail. A resumed session answers `get_messages`
/// with the messages of its file, after a summary once it has compacted.
const FAKE_PI: &str = r#"#!/bin/sh
if [ "$1" = '--version' ]; then echo 1.0.0; exit 0; fi
[ "$1" = '--mode' ] && [ "$2" = 'rpc' ] || exit 64
printf '%s\n' "$*" > "$PWD/args.txt"
printf '%s' "$PATH" > "$PWD/path.txt"
current=model-one
session_file=
[ "$3" = '--session' ] && session_file=$4
summary=
level=medium
native=native
while IFS= read -r command; do
    printf '%s\n' "$command" >> "$PWD/commands.jsonl"
    id=$(printf '%s' "$command" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
    case "$command" in
        *'"type":"get_state"'*)
            printf '{"id":"%s","type":"response","command":"get_state","success":true,"data":{"sessionId":"%s","sessionFile":"%s/session.jsonl","thinkingLevel":"%s","sessionName":"%s","model":{"provider":"fixture","id":"%s"}}}\n' "$id" "$native" "$PWD" "$level" "$name" "$current"
            ;;
        *'"type":"get_available_thinking_levels"'*)
            levels='["off","minimal","low","medium","high","xhigh"]'
            [ "$current" = model-two ] && levels='["off"]'
            printf '{"id":"%s","type":"response","command":"get_available_thinking_levels","success":true,"data":{"levels":%s}}\n' "$id" "$levels"
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
        *'"command":"echo hi"'*)
            printf '{"type":"bash_execution_update","id":"%s","delta":"hi\\n"}\n' "$id"
            printf '{"id":"%s","type":"response","command":"bash","success":true,"data":{"output":"hi\\n","exitCode":0,"cancelled":false,"truncated":false}}\n' "$id"
            ;;
        *'"command":"sleep 60"'*) printf '%s' "$id" > "$PWD/running" ;;
        *'"type":"abort_bash"'*)
            printf '{"id":"%s","type":"response","command":"abort_bash","success":true}\n' "$id"
            if [ -f "$PWD/running" ]; then
                printf '{"id":"%s","type":"response","command":"bash","success":true,"data":{"output":"","cancelled":true,"truncated":false}}\n' "$(cat "$PWD/running")"
                rm "$PWD/running"
            fi
            ;;
        *'"type":"bash"'*)
            printf '{"id":"%s","type":"response","command":"bash","success":false,"error":"Shell unavailable"}\n' "$id"
            ;;
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
            : > "$PWD/queued"
            printf '{"id":"%s","type":"response","command":"follow_up","success":true}\n' "$id"
            printf '{"type":"queue_update","steering":["change course"],"followUp":["later"]}\n'
            ;;
        *'"type":"clear_queue"'*)
            if [ -f "$PWD/queued" ]; then
                rm "$PWD/queued"
                printf '{"id":"%s","type":"response","command":"clear_queue","success":true,"data":{"steering":["change course"],"followUp":["later"]}}\n' "$id"
            else
                printf '{"id":"%s","type":"response","command":"clear_queue","success":true,"data":{"steering":[],"followUp":[]}}\n' "$id"
            fi
            ;;
        *'"type":"abort"'*)
            printf '{"id":"%s","type":"response","command":"abort","success":true}\n' "$id"
            printf '{"type":"agent_settled"}\n'
            ;;
        *'"modelId":"missing"'*)
            printf '{"id":"%s","type":"response","command":"set_model","success":false,"error":"Model not found: fixture/missing"}\n' "$id"
            ;;
        *'"modelId":"model-two"'*)
            current=model-two
            level=off
            printf '{"id":"%s","type":"response","command":"set_model","success":true,"data":{"provider":"fixture","id":"model-two"}}\n' "$id"
            ;;
        *'"type":"set_model"'*)
            current=model-one
            printf '{"id":"%s","type":"response","command":"set_model","success":true,"data":{"provider":"fixture","id":"model-one"}}\n' "$id"
            ;;
        *'"type":"set_thinking_level"'*)
            level=$(printf '%s' "$command" | sed -n 's/.*"level":"\([^"]*\)".*/\1/p')
            printf '{"id":"%s","type":"response","command":"set_thinking_level","success":true}\n' "$id"
            ;;
        *'"name":""'*)
            printf '{"id":"%s","type":"response","command":"set_session_name","success":false,"error":"Session name cannot be empty"}\n' "$id"
            ;;
        *'"type":"set_session_name"'*)
            name=$(printf '%s' "$command" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')
            printf '{"id":"%s","type":"response","command":"set_session_name","success":true}\n' "$id"
            ;;
        *'"type":"clone"'*)
            native=cloned
            printf '{"id":"%s","type":"response","command":"clone","success":true,"data":{"cancelled":false}}\n' "$id"
            ;;
        *'"customInstructions":"fail"'*)
            printf '{"id":"%s","type":"response","command":"compact","success":false,"error":"Nothing to compact"}\n' "$id"
            printf '{"type":"compaction_end","reason":"manual","aborted":false,"willRetry":false,"errorMessage":"Nothing to compact"}\n'
            ;;
        *'"type":"compact"'*)
            summary='{"role":"compactionSummary","summary":"Short summary","tokensBefore":9000,"timestamp":1},'
            printf '{"type":"compaction_start","reason":"manual"}\n'
            printf '{"id":"%s","type":"response","command":"compact","success":true,"data":{"summary":"Short summary","firstKeptEntryId":"entry-2","tokensBefore":9000}}\n' "$id"
            printf '{"type":"compaction_end","reason":"manual","aborted":false,"willRetry":false,"result":{"summary":"Short summary","firstKeptEntryId":"entry-2","tokensBefore":9000}}\n'
            ;;
        *'"type":"get_messages"'*)
            if [ -n "$session_file" ]; then
                messages=$(sed -n 's/^{"type":"message","message":\(.*\)}$/\1/p' "$session_file" | paste -sd , -)
            else
                messages='{"role":"user","content":"failing prompt"},{"role":"assistant","content":[],"stopReason":"error","errorMessage":"529 overloaded"}'
            fi
            printf '{"id":"%s","type":"response","command":"get_messages","success":true,"data":{"messages":[%s%s]}}\n' "$id" "$summary" "$messages"
            ;;
        *'"type":"set_auto_retry"'*)
            printf '{"id":"%s","type":"response","command":"set_auto_retry","success":true}\n' "$id"
            ;;
        *'"type":"abort_retry"'*)
            printf '{"id":"%s","type":"response","command":"abort_retry","success":true}\n' "$id"
            ;;
        *'"type":"set_auto_compaction"'*)
            printf '{"id":"%s","type":"response","command":"set_auto_compaction","success":true}\n' "$id"
            ;;
        *'"type":"get_session_stats"'*)
            printf '{"id":"%s","type":"response","command":"get_session_stats","success":true,"data":{"tokens":{"input":50000,"output":10000,"cacheRead":40000,"cacheWrite":5000,"total":105000},"cost":0.45,"contextUsage":{"tokens":60000,"contextWindow":200000,"percent":30}}}\n' "$id"
            ;;
        *'"entryId":"missing"'*)
            printf '{"id":"%s","type":"response","command":"fork","success":false,"error":"Entry missing not found"}\n' "$id"
            ;;
        *'"type":"fork"'*)
            native=forked
            printf '{"id":"%s","type":"response","command":"fork","success":true,"data":{"text":"Fix the login bug","cancelled":false}}\n' "$id"
            ;;
        *'"type":"get_available_models"'*)
            printf '{"id":"%s","type":"response","command":"get_available_models","success":true,"data":{"models":[{"id":"model-one","name":"Model One","provider":"fixture","reasoning":true,"input":["text","image"]},{"id":"model-two","provider":"fixture","reasoning":false,"input":["text"]}]}}\n' "$id"
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
                path: FIXTURE_PATH.as_str().into(),
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
                std::env::var_os("PATH").unwrap_or_default(),
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

    // An interrupt clears the queue and returns its text with the response.
    let follow_up = json!({"message": "later"});
    let (status, _) = fixture
        .call("POST", &format!("{base}/follow-up"), Some(follow_up))
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let (status, cleared) = fixture
        .call("POST", &format!("{base}/interrupt"), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(cleared, queued);
    // The interrupt is announced before the idle status it causes.
    next_event(&mut stream, output("session_interrupted")).await;
    next_event(&mut stream, session_changed("idle")).await;
    assert_eq!(fixture.call("GET", &base, None).await.1["status"], "idle");
    next_event(&mut stream, output("session_usage")).await;

    let (status, idle) = fixture.call("DELETE", &format!("{base}/retry"), None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(idle["code"], "invalid_session_state");
    let (status, _) = fixture.call("POST", &format!("{base}/retry"), None).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    next_event(&mut stream, session_changed("running")).await;
    let (status, busy) = fixture.call("POST", &format!("{base}/retry"), None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(busy["code"], "invalid_session_state");
    let (status, _) = fixture
        .call(
            "PUT",
            &format!("{base}/auto-retry"),
            Some(json!({"enabled": false})),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = fixture.call("DELETE", &format!("{base}/retry"), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, cleared) = fixture
        .call("POST", &format!("{base}/interrupt"), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(cleared, json!({"steering": [], "follow_up": []}));
    // The usage refresh after an interrupt runs in the background, so wait
    // for it before the recorded commands are compared.
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
            "get_state",
            "get_available_thinking_levels",
            "get_commands",
            "get_state",
            "get_available_models",
            "get_entries",
            "set_model",
            "get_available_thinking_levels",
            "get_state",
            "set_model",
            "set_thinking_level",
            "get_state",
            "compact",
            "compact",
            "set_auto_compaction",
            "set_auto_compaction",
            "prompt",
            "prompt",
            "steer",
            "follow_up",
            "clear_queue",
            "follow_up",
            "clear_queue",
            "abort",
            "get_session_stats",
            "get_messages",
            "prompt",
            "set_auto_retry",
            "abort_retry",
            "clear_queue",
            "abort",
            "get_session_stats",
        ]
    );
}

#[tokio::test]
async fn validates_prompt_images_and_the_model_that_receives_them() {
    use base64::{Engine, engine::general_purpose::STANDARD};
    let fixture = Fixture::new(None).await;
    let (_, session) = fixture
        .start(Some(
            json!({"provider": "fixture", "model_id": "model-one"}),
        ))
        .await;
    let base = format!("/api/sessions/{}", session["id"].as_str().unwrap());
    let prompt_path = format!("{base}/prompt");
    let image =
        |bytes: usize| json!({"mime_type": "image/png", "data": STANDARD.encode(vec![0u8; bytes])});
    let send = |images: Value| {
        fixture.call(
            "POST",
            &prompt_path,
            Some(json!({"message": "look", "images": images})),
        )
    };
    let mib = 1024 * 1024;

    let cases = [
        (
            json!([{"mime_type": "image/svg+xml", "data": "AAAA"}]),
            "unsupported_image_type",
        ),
        (
            json!([{"mime_type": "image/png", "data": "not base64!"}]),
            "invalid_image_data",
        ),
        (json!([image(5 * mib + 1)]), "image_too_large"),
        (
            json!([image(7 * mib / 2), image(7 * mib / 2), image(7 * mib / 2)]),
            "request_images_too_large",
        ),
    ];
    for (images, code) in cases {
        let (status, error) = send(images).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{code}");
        assert_eq!(error["code"], code);
    }

    let text_only = json!({"provider": "fixture", "model_id": "model-two"});
    fixture
        .call("PUT", &format!("{base}/model"), Some(text_only))
        .await;
    let (status, error) = send(json!([image(8)])).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(error["code"], "image_input_unsupported");
    assert!(
        !fixture.commands().contains(&"prompt".to_owned()),
        "a refused prompt must not reach Pi"
    );

    let capable = json!({"provider": "fixture", "model_id": "model-one"});
    fixture
        .call("PUT", &format!("{base}/model"), Some(capable))
        .await;
    assert_eq!(send(json!([image(8)])).await.0, StatusCode::ACCEPTED);
    let recorded = fs::read_to_string(fixture.workspace_root.join("commands.jsonl")).unwrap();
    let prompt: Value = recorded
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .find(|command| command["type"] == "prompt")
        .unwrap();
    assert_eq!(
        prompt["images"],
        json!([{"type": "image", "data": STANDARD.encode([0u8; 8]), "mimeType": "image/png"}])
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
            "get_state",
            "get_available_thinking_levels",
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

/// Pi runs with the discovery `PATH`. A fake Pi that cannot find `sed` never
/// answers, so a time limit turns a wrong `PATH` into a failure, not a hang.
#[tokio::test]
async fn starts_pi_with_the_discovery_path() {
    let fixture = Fixture::new(None).await;

    let (status, session) = tokio::time::timeout(Duration::from_secs(10), fixture.start(None))
        .await
        .expect("the session did not start within 10 seconds");

    assert_eq!(status, StatusCode::CREATED, "{session}");
    let path = fs::read_to_string(fixture.workspace_root.join("path.txt")).unwrap();
    assert_eq!(path, *FIXTURE_PATH);
}

#[tokio::test]
async fn renames_and_clones_a_session() {
    let fixture = Fixture::new(None).await;
    let mut stream = fixture.events.subscribe(None);
    let (_, session) = fixture.start(None).await;
    assert_eq!(session["capabilities"]["rename"], true);
    assert_eq!(session["capabilities"]["clone_session"], true);
    let base = format!("/api/sessions/{}", session["id"].as_str().unwrap());

    let (status, _) = fixture
        .call(
            "PUT",
            &format!("{base}/name"),
            Some(json!({"name": "release prep"})),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    next_event(&mut stream, session_changed("idle")).await;
    let (_, named) = fixture.call("GET", &base, None).await;
    assert_eq!(named["name"], "release prep");

    let (status, rejected) = fixture
        .call("PUT", &format!("{base}/name"), Some(json!({"name": ""})))
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(rejected["code"], "control_rejected");

    let (status, cloned) = fixture.call("POST", &format!("{base}/clone"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(cloned, json!({"native_session_id": "cloned"}));
    let (_, current) = fixture.call("GET", &base, None).await;
    assert_eq!(current["native_session_id"], "cloned");
    next_event(&mut stream, session_changed("idle")).await;

    let (status, missing) = fixture
        .call("POST", "/api/sessions/missing/clone", None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(missing["code"], "not_found");
    assert_eq!(
        fixture.commands(),
        [
            "get_state",
            "get_state",
            "get_available_thinking_levels",
            "set_session_name",
            "get_state",
            "set_session_name",
            "clone",
            "get_state",
            "get_state"
        ]
    );
}

#[tokio::test]
async fn runs_and_stops_shell_commands() {
    let fixture = Fixture::new(None).await;
    let mut stream = fixture.events.subscribe(None);
    let (_, session) = fixture.start(None).await;
    assert_eq!(session["capabilities"]["shell_commands"], true);
    let shell = format!("/api/sessions/{}/shell", session["id"].as_str().unwrap());

    let request = json!({"command": "echo hi", "exclude_from_context": true});
    let (status, result) = fixture.call("POST", &shell, Some(request)).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    let id = result["id"].as_str().unwrap().to_owned();
    assert_eq!(
        result,
        json!({
            "id": id, "output": "hi\n", "exit_code": 0, "cancelled": false,
            "truncated": false, "full_output_path": null,
        })
    );
    let payload = |event: ServerEvent| serde_json::from_str::<Value>(&event.payload).unwrap();
    let start = payload(next_event(&mut stream, output("shell_command_start")).await);
    assert_eq!(
        start,
        json!({
            "type": "shell_command_start", "id": id, "command": "echo hi",
            "exclude_from_context": true,
        })
    );
    let update = payload(next_event(&mut stream, output("bash_execution_update")).await);
    assert_eq!(update["id"], id.as_str());
    assert_eq!(update["delta"], "hi\n");
    let end = payload(next_event(&mut stream, output("shell_command_end")).await);
    assert_eq!(end["id"], id.as_str());
    assert_eq!(end["result"], result);
    assert_eq!(end["error"], Value::Null);

    let (stopped, stop) = tokio::join!(
        fixture.call(
            "POST",
            &shell,
            Some(json!({"command": "sleep 60", "exclude_from_context": false})),
        ),
        async {
            next_event(&mut stream, output("shell_command_start")).await;
            // The start event comes before Pi reads the command.
            while !fixture.commands().ends_with(&["bash".to_owned()]) {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            fixture.call("DELETE", &shell, None).await
        }
    );
    assert_eq!(stop.0, StatusCode::NO_CONTENT);
    assert_eq!(stopped.0, StatusCode::OK);
    assert_eq!(stopped.1["cancelled"], true);
    assert_eq!(stopped.1["exit_code"], Value::Null);
    let end = payload(next_event(&mut stream, output("shell_command_end")).await);
    assert_eq!(end["result"]["cancelled"], true);

    let request = json!({"command": "broken", "exclude_from_context": false});
    let (status, rejected) = fixture.call("POST", &shell, Some(request)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(rejected["code"], "control_rejected");
    let end = payload(next_event(&mut stream, output("shell_command_end")).await);
    assert_eq!(end["result"], Value::Null);
    assert_eq!(end["error"], rejected["message"]);

    let (status, missing) = fixture
        .call("DELETE", "/api/sessions/missing/shell", None)
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

fn binding(list: &Value, action: &str) -> Value {
    list["bindings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|binding| binding["action"] == action)
        .unwrap()
        .clone()
}

#[tokio::test]
async fn serves_pi_keybindings_over_defaults() {
    let fixture = Fixture::new(None).await;
    let (status, defaults) = fixture.call("GET", "/api/pi/keybindings", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(defaults["warnings"], json!([]));
    let submit = binding(&defaults, "tui.input.submit");
    assert_eq!(submit["keys"], json!(["enter"]));
    assert_eq!(submit["source"], "default");

    let agent = fixture._directory.path().join(".pi/agent");
    fs::create_dir_all(&agent).unwrap();
    fs::write(
        agent.join("keybindings.json"),
        r#"{"app.session.new": "ctrl+shift+n", "app.exit": []}"#,
    )
    .unwrap();
    let (_, overridden) = fixture.call("GET", "/api/pi/keybindings", None).await;
    let new = binding(&overridden, "app.session.new");
    assert_eq!(new["keys"], json!(["ctrl+shift+n"]));
    assert_eq!(new["source"], "user");
    let exit = binding(&overridden, "app.exit");
    assert_eq!(exit["keys"], json!([]));
    assert_eq!(exit["default_keys"], json!(["ctrl+d"]));

    fs::write(agent.join("keybindings.json"), "{broken").unwrap();
    let (status, invalid) = fixture.call("GET", "/api/pi/keybindings", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(invalid["warnings"].as_array().unwrap().len(), 1);
    assert_eq!(binding(&invalid, "app.exit")["keys"], json!(["ctrl+d"]));
}

#[tokio::test]
async fn reads_the_session_tree_and_branches_through_pi() {
    let fixture = Fixture::new(None).await;
    let (_, started) = fixture
        .call(
            "POST",
            "/api/sessions",
            Some(json!({"workspace_id": fixture.workspace_id})),
        )
        .await;
    let base = format!("/api/sessions/{}", started["id"].as_str().unwrap());

    // The fake Pi reports `session.jsonl` in its working directory.
    let lines = [
        native_header(&fixture, "native", None),
        r#"{"type":"message","id":"a1","parentId":null,"timestamp":"t1","message":{"role":"user","content":"Fix the login bug"}}"#.to_owned(),
        "not json".to_owned(),
        r#"{"type":"message","id":"b2","parentId":"a1","timestamp":"t2","message":{"role":"assistant","content":[{"type":"text","text":"Done"}]}}"#.to_owned(),
        r#"{"type":"message","id":"c3","parentId":"a1","timestamp":"t3","message":{"role":"user","content":"Try again"}}"#.to_owned(),
    ];
    fs::write(
        fixture.workspace_root.join("session.jsonl"),
        lines.join("\n"),
    )
    .unwrap();

    let (status, tree) = fixture.call("GET", &format!("{base}/tree"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(tree["leaf_id"], "c3");
    assert_eq!(tree["truncated"], false);
    assert_eq!(
        tree["entries"][1],
        json!({"id": "b2", "parent_id": "a1", "kind": "message", "role": "assistant", "preview": "Done", "timestamp": "t2"})
    );
    assert_eq!(tree["entries"].as_array().unwrap().len(), 3);

    let (status, branch) = fixture
        .call(
            "POST",
            &format!("{base}/branch"),
            Some(json!({"entry_id": "a1"})),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        branch,
        json!({"text": "Fix the login bug", "cancelled": false})
    );

    let (status, rejected) = fixture
        .call(
            "POST",
            &format!("{base}/branch"),
            Some(json!({"entry_id": "missing"})),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(rejected["code"], "control_rejected");
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
    assert_eq!(started["native_session_id"], "native");
    assert_eq!(started["thinking_level"], "medium");
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

#[tokio::test]
async fn returns_the_conversation_of_a_resumed_and_compacted_session() {
    let fixture = Fixture::new(None).await;
    let user = json!({"role": "user", "content": "Fix the login bug", "timestamp": 10});
    let reply = json!({"role": "assistant", "content": [{"type": "text", "text": "Done"}], "timestamp": 11});
    let file = [
        native_header(&fixture, "resumed", None),
        // The fake Pi reads messages from lines that start with the type.
        format!(r#"{{"type":"message","message":{user}}}"#),
        format!(r#"{{"type":"message","message":{reply}}}"#),
    ]
    .join("\n");
    write_native_session(&fixture, "2026_resumed.jsonl", &file);
    let (status, started) = fixture
        .call(
            "POST",
            "/api/sessions",
            Some(json!({"workspace_id": fixture.workspace_id, "native_session_id": "resumed"})),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let base = format!("/api/sessions/{}", started["id"].as_str().unwrap());

    let sequence = fixture.events.last_sequence();
    let (status, history) = fixture.call("GET", &format!("{base}/messages"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        history,
        json!({"sequence": sequence, "messages": [user, reply], "truncated": false})
    );

    let mut stream = fixture.events.subscribe(None);
    let (status, _) = fixture
        .call("POST", &format!("{base}/compact"), Some(json!({})))
        .await;
    assert_eq!(status, StatusCode::OK);
    next_event(&mut stream, output("compaction_end")).await;
    let sequence = fixture.events.last_sequence();
    let (_, history) = fixture.call("GET", &format!("{base}/messages"), None).await;
    assert_eq!(history["sequence"], sequence);
    let messages = history["messages"].as_array().unwrap();
    assert_eq!(messages[0]["role"], "compactionSummary");
    assert_eq!(messages[0]["summary"], "Short summary");
    assert_eq!(messages[1..], [user, reply]);

    let (status, error) = fixture
        .call("GET", "/api/sessions/missing/messages", None)
        .await;
    assert_eq!(
        (status, error["code"].as_str()),
        (StatusCode::NOT_FOUND, Some("not_found"))
    );
}

fn session_field(field: &'static str, value: &'static str) -> impl FnMut(&ServerEvent) -> bool {
    move |event| {
        event.kind == ServerEventKind::SessionChanged
            && serde_json::from_str::<Value>(&event.payload).unwrap()[field] == value
    }
}

#[tokio::test]
async fn reports_native_session_state_as_pi_changes_it() {
    let fixture = Fixture::new(None).await;
    let mut stream = fixture.events.subscribe(None);
    let (_, started) = fixture.start(None).await;
    assert_eq!(started["native_session_id"], "native");
    assert_eq!(started["thinking_level"], "medium");
    assert_eq!(
        started["thinking_levels"],
        json!(["off", "minimal", "low", "medium", "high", "xhigh"])
    );
    let id = started["id"].as_str().unwrap();
    let base = format!("/api/sessions/{id}");

    let level = json!({"level": "xhigh"});
    fixture
        .call("PUT", &format!("{base}/thinking-level"), Some(level))
        .await;
    next_event(&mut stream, session_field("thinking_level", "xhigh")).await;

    // Pi clamps the level when the new model cannot reason, and the model
    // offers only `off`.
    let model = json!({"provider": "fixture", "model_id": "model-two"});
    fixture
        .call("PUT", &format!("{base}/model"), Some(model))
        .await;
    let changed = next_event(&mut stream, session_field("thinking_level", "off")).await;
    let changed: Value = serde_json::from_str(&changed.payload).unwrap();
    assert_eq!(changed["thinking_levels"], json!(["off"]));

    // A branch moves the session to a new native session.
    fixture
        .call(
            "POST",
            &format!("{base}/branch"),
            Some(json!({"entry_id": "a1"})),
        )
        .await;
    let branched = next_event(&mut stream, session_field("native_session_id", "forked")).await;
    let branched: Value = serde_json::from_str(&branched.payload).unwrap();
    assert_eq!(branched["thinking_level"], "off");
    let (_, current) = fixture.call("GET", &base, None).await;
    assert_eq!(current["native_session_id"], "forked");
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
        // Other clients learn that the dialog was answered.
        next_event(&mut stream, |event| {
            let payload: Value = serde_json::from_str(&event.payload).unwrap();
            payload["type"] == "extension_ui_resolved"
                && payload["id"] == id
                && payload["reason"] == "answered"
        })
        .await;
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
    assert_eq!(status, StatusCode::OK);
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

#[tokio::test]
async fn searches_the_persisted_conversation() {
    let fixture = Fixture::new(None).await;
    let (_, started) = fixture
        .call(
            "POST",
            "/api/sessions",
            Some(json!({"workspace_id": fixture.workspace_id})),
        )
        .await;
    let base = format!("/api/sessions/{}", started["id"].as_str().unwrap());
    let lines = [
        native_header(&fixture, "native", None),
        r#"{"type":"message","id":"a1","parentId":null,"timestamp":"t1","message":{"role":"user","content":"Fix the Login bug"}}"#.to_owned(),
        r#"{"type":"message","id":"b2","parentId":"a1","timestamp":"t2","message":{"role":"assistant","content":[{"type":"text","text":"login fixed"}]}}"#.to_owned(),
    ];
    fs::write(
        fixture.workspace_root.join("session.jsonl"),
        lines.join("\n"),
    )
    .unwrap();

    let (status, found) = fixture
        .call("GET", &format!("{base}/search?q=LOGIN"), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(found["truncated"], false);
    assert_eq!(
        found["matches"][0],
        json!({"entry_id": "b2", "role": "assistant", "snippet": "login fixed", "match_start": 0, "match_end": 5, "timestamp": "t2"})
    );
    assert_eq!(found["matches"][1]["entry_id"], "a1");

    let (_, limited) = fixture
        .call("GET", &format!("{base}/search?q=login&limit=1"), None)
        .await;
    assert_eq!(limited["matches"].as_array().unwrap().len(), 1);
    assert_eq!(limited["truncated"], true);

    let (status, blank) = fixture.call("GET", &format!("{base}/search"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(blank["matches"], json!([]));
}
