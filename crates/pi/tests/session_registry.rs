#![cfg(unix)]

use pau_agent::AgentSessionStatus;
use pau_core::persistence::{Database, ProcessMetadata, Workspace};
use pau_pi::{
    PiProcessOutput, PiReplyTimeouts, PiSessionRegistry, PiShutdownTimeouts, StartPiProcessOptions,
    StartRegisteredPiSession,
};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::time::Duration;
use tempfile::TempDir;

const STARTED_AT: &str = "2026-03-11T10:00:00Z";
const ENDED_AT: &str = "2026-03-11T11:00:00Z";

#[tokio::test]
async fn interleaves_sessions_and_stops_only_the_selected_process() {
    let fixture = FakePi::new();
    let database = Database::open(fixture.root.path().join("pau.sqlite3"))
        .await
        .unwrap();
    register_workspaces(&database, &fixture).await;
    let registry = PiSessionRegistry::new(database.processes());
    let mut output = registry.subscribe();

    let alpha = registry.start(fixture.request("alpha")).await.unwrap();
    let beta = registry.start(fixture.request("beta")).await.unwrap();
    let (alpha_prompt, beta_prompt) = tokio::join!(
        alpha.prompt("alpha work", Vec::new(), None),
        beta.prompt("beta work", Vec::new(), None)
    );
    alpha_prompt.unwrap();
    beta_prompt.unwrap();

    let mut interleaved = Vec::new();
    while interleaved.len() < 4 {
        let event = tokio::time::timeout(Duration::from_secs(2), output.recv())
            .await
            .unwrap()
            .unwrap();
        if let PiProcessOutput::Event(payload) = event.output
            && payload["type"] == "fixture_event"
        {
            interleaved.push((
                event.session_id,
                payload["label"].as_str().unwrap().to_owned(),
            ));
        }
    }
    assert_eq!(
        interleaved,
        [
            ("alpha".to_owned(), "alpha-1".to_owned()),
            ("beta".to_owned(), "beta-1".to_owned()),
            ("alpha".to_owned(), "alpha-2".to_owned()),
            ("beta".to_owned(), "beta-2".to_owned()),
        ]
    );

    registry.stop("alpha", ENDED_AT).await.unwrap();
    assert_eq!(registry.active_ids().await, ["beta"]);
    assert_eq!(beta.status().await, AgentSessionStatus::Running);

    registry.stop("beta", ENDED_AT).await.unwrap();
    assert!(registry.active_ids().await.is_empty());
}

#[tokio::test]
async fn a_start_subscription_keeps_its_session_output_through_other_sessions_traffic() {
    let fixture = FakePi::new();
    let database = Database::open(fixture.root.path().join("pau.sqlite3"))
        .await
        .unwrap();
    register_workspaces(&database, &fixture).await;
    let registry = PiSessionRegistry::new(database.processes());
    let (alpha, mut own) = registry
        .start_subscribed(fixture.request("alpha"))
        .await
        .unwrap();
    let beta = registry.start(fixture.request("beta")).await.unwrap();
    let mut shared = registry.subscribe();
    let mut watch = registry.subscribe();

    // Alpha writes its record, then beta writes more output than a
    // subscription holds before anyone reads either.
    alpha.prompt("mark", Vec::new(), None).await.unwrap();
    read_until(&mut watch, "alpha", "mark").await;
    beta.prompt("flood", Vec::new(), None).await.unwrap();
    read_until(&mut watch, "beta", "flood-299").await;

    let labels = |outputs: Vec<PiProcessOutput>| -> Vec<String> {
        outputs
            .into_iter()
            .filter_map(|output| match output {
                PiProcessOutput::Event(event) => event["label"].as_str().map(str::to_owned),
                _ => None,
            })
            .collect()
    };
    let mut lagged = false;
    let from_shared = std::iter::from_fn(|| {
        loop {
            match shared.try_recv() {
                Ok(tagged) => return Some(tagged.output),
                Err(tokio::sync::broadcast::error::TryRecvError::Lagged(_)) => lagged = true,
                Err(_) => return None,
            }
        }
    })
    .collect();
    // The shared subscription lagged and lost alpha's record.
    assert!(!labels(from_shared).contains(&"mark".to_owned()));
    assert!(lagged);
    let from_own = std::iter::from_fn(|| own.try_recv().ok()).collect();
    assert_eq!(labels(from_own), ["mark"]);
}

/// Reads the shared output until session `id` sends the event labelled
/// `label`, skipping past any lag.
async fn read_until(
    output: &mut tokio::sync::broadcast::Receiver<pau_pi::PiSessionOutput>,
    id: &str,
    label: &str,
) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match output.recv().await {
                Ok(tagged)
                    if tagged.session_id == id
                        && matches!(&tagged.output, PiProcessOutput::Event(event) if event["label"] == label) =>
                {
                    return;
                }
                Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(error) => panic!("{error}"),
            }
        }
    })
    .await
    .expect("the event never arrived");
}

#[tokio::test]
async fn rediscovers_native_records_after_registry_restart() {
    let fixture = FakePi::new();
    let database_path = fixture.root.path().join("pau.sqlite3");
    let database = Database::open(&database_path).await.unwrap();
    register_workspaces(&database, &fixture).await;
    let registry = PiSessionRegistry::new(database.processes());

    registry.start(fixture.request("alpha")).await.unwrap();
    registry.start(fixture.request("beta")).await.unwrap();
    registry.stop("alpha", ENDED_AT).await.unwrap();
    registry.stop("beta", ENDED_AT).await.unwrap();
    drop(registry);
    drop(database);

    let restarted_database = Database::open(database_path).await.unwrap();
    let restarted = PiSessionRegistry::new(restarted_database.processes());
    let records = restarted.discover().await.unwrap();

    assert_eq!(records.len(), 2);
    assert_eq!(records[0].id, "alpha");
    assert_eq!(records[0].workspace_id.as_deref(), Some("workspace-alpha"));
    assert_eq!(records[0].native_session_id, "native-alpha");
    assert_eq!(records[0].ended_at.as_deref(), Some(ENDED_AT));
    assert_eq!(records[1].id, "beta");
    assert_eq!(records[1].native_session_id, "native-beta");
}

#[tokio::test]
async fn records_placeholders_and_removes_leftovers_before_a_sandboxed_launch() {
    let fixture = FakePi::new();
    let database = Database::open(fixture.root.path().join("pau.sqlite3"))
        .await
        .unwrap();
    register_workspaces(&database, &fixture).await;
    let alpha = fixture.workspace("alpha");
    let beta = fixture.workspace("beta");
    // A crashed Pau left an empty placeholder and one the operator later
    // filled in.
    fs::write(alpha.join(".mcp.json"), "").unwrap();
    fs::write(alpha.join(".bashrc"), "export KEEP=1\n").unwrap();
    database
        .processes()
        .upsert(ProcessMetadata {
            id: "crashed".to_owned(),
            workspace_id: Some("workspace-alpha".to_owned()),
            process_kind: "pi".to_owned(),
            native_session_id: None,
            started_at: STARTED_AT.to_owned(),
            ended_at: None,
            exit_code: None,
            sandbox_placeholders: [".mcp.json", ".bashrc"]
                .map(|name| alpha.join(name).to_string_lossy().into_owned())
                .to_vec(),
        })
        .await
        .unwrap();
    let registry = PiSessionRegistry::new(database.processes());

    let mut request = fixture.request("beta");
    request.sandbox_placeholders = vec![beta.join(".claude")];
    registry.start(request).await.unwrap();

    assert!(!alpha.join(".mcp.json").exists());
    assert!(alpha.join(".bashrc").exists());
    let crashed = database.processes().get("crashed").await.unwrap().unwrap();
    assert!(crashed.sandbox_placeholders.is_empty());
    let recorded = database.processes().get("beta").await.unwrap().unwrap();
    assert_eq!(
        recorded.sandbox_placeholders,
        [beta.join(".claude").to_string_lossy().into_owned()]
    );

    // The fake Pi never starts a sandbox, so stop removes the placeholder the
    // runtime would have cleaned up.
    fs::create_dir(beta.join(".claude")).unwrap();
    registry.stop("beta", ENDED_AT).await.unwrap();
    assert!(!beta.join(".claude").exists());
    let stopped = database.processes().get("beta").await.unwrap().unwrap();
    assert!(stopped.sandbox_placeholders.is_empty());
}

async fn register_workspaces(database: &Database, fixture: &FakePi) {
    for name in ["alpha", "beta"] {
        database
            .workspaces()
            .upsert(Workspace {
                id: format!("workspace-{name}"),
                path: fixture.workspace(name).to_string_lossy().into_owned(),
                name: Some(name.to_owned()),
                created_at: STARTED_AT.to_owned(),
                updated_at: STARTED_AT.to_owned(),
            })
            .await
            .unwrap();
    }
}

struct FakePi {
    root: TempDir,
    executable: PathBuf,
}

impl FakePi {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("alpha")).unwrap();
        fs::create_dir(root.path().join("beta")).unwrap();
        let executable = root.path().join("fake pi");
        fs::write(&executable, FAKE_PI).unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
        Self { root, executable }
    }

    fn workspace(&self, name: &str) -> PathBuf {
        self.root.path().join(name)
    }

    fn request(&self, name: &str) -> StartRegisteredPiSession {
        StartRegisteredPiSession {
            id: name.to_owned(),
            workspace_id: format!("workspace-{name}"),
            started_at: STARTED_AT.to_owned(),
            process: StartPiProcessOptions {
                executable_path: self.executable.clone(),
                working_directory: self.workspace(name),
                arguments: Vec::new(),
                environment: Vec::new(),
                reply_timeouts: PiReplyTimeouts::default(),
                shutdown_timeouts: PiShutdownTimeouts {
                    protocol: Duration::from_secs(1),
                    interrupt: Duration::from_secs(1),
                    terminate: Duration::from_secs(1),
                    kill: Duration::from_secs(1),
                },
            },
            sandbox_placeholders: Vec::new(),
        }
    }
}

const FAKE_PI: &str = r#"#!/bin/sh
[ "$1" = '--mode' ] && [ "$2" = 'rpc' ] || exit 64
name=$(basename "$PWD")
root=$(dirname "$PWD")
while IFS= read -r command; do
    id=$(printf '%s' "$command" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
    case "$command" in
        *'"type":"get_state"'*)
            printf '{"id":"%s","type":"response","command":"get_state","success":true,"data":{"sessionId":"native-%s","sessionFile":"%s/session.jsonl"}}\n' "$id" "$name" "$PWD"
            ;;
        *'"message":"mark"'*)
            printf '{"id":"%s","type":"response","command":"prompt","success":true}\n' "$id"
            printf '{"type":"fixture_event","label":"mark"}\n'
            ;;
        *'"message":"flood"'*)
            printf '{"id":"%s","type":"response","command":"prompt","success":true}\n' "$id"
            i=0
            while [ "$i" -lt 300 ]; do
                printf '{"type":"fixture_event","label":"flood-%s"}\n' "$i"
                i=$((i + 1))
            done
            ;;
        *'"type":"prompt"'*)
            printf '{"id":"%s","type":"response","command":"prompt","success":true}\n' "$id"
            printf '{"type":"agent_start"}\n'
            if [ "$name" = alpha ]; then
                printf '{"type":"fixture_event","label":"alpha-1"}\n'
                : > "$root/alpha-1"
                while [ ! -e "$root/beta-1" ]; do sleep 0.01; done
                printf '{"type":"fixture_event","label":"alpha-2"}\n'
                : > "$root/alpha-2"
            else
                while [ ! -e "$root/alpha-1" ]; do sleep 0.01; done
                printf '{"type":"fixture_event","label":"beta-1"}\n'
                : > "$root/beta-1"
                while [ ! -e "$root/alpha-2" ]; do sleep 0.01; done
                printf '{"type":"fixture_event","label":"beta-2"}\n'
            fi
            ;;
        *) exit 65 ;;
    esac
done
"#;
