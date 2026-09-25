#![cfg(unix)]

use pau_agent::AgentSessionStatus;
use pau_core::persistence::{Database, Workspace};
use pau_pi::{
    PiProcessOutput, PiSessionRegistry, PiShutdownTimeouts, StartPiProcessOptions,
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
        alpha.prompt("alpha work", None),
        beta.prompt("beta work", None)
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
                shutdown_timeouts: PiShutdownTimeouts {
                    protocol: Duration::from_secs(1),
                    interrupt: Duration::from_secs(1),
                    terminate: Duration::from_secs(1),
                    kill: Duration::from_secs(1),
                },
            },
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
