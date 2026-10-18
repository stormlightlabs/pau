use std::{fs, os::unix::fs::PermissionsExt, path::Path, path::PathBuf};

use pau_core::persistence::Database;
use tempfile::TempDir;

use super::*;
use crate::EventHub;

/// A Pi stand-in that reports `version`, logs each RPC launch, and lists
/// `models` (a JSON array) for `get_available_models`.
fn write_pi(directory: &Path, version: &str, models: &str) -> PathBuf {
    let path = directory.join("pi");
    fs::write(
        &path,
        format!(
            r#"#!/bin/sh
if [ "$1" = '--version' ]; then echo {version}; exit 0; fi
if [ "$1" = '--help' ]; then echo '--mode rpc'; exit 0; fi
echo launch >> "$PWD/launches.txt"
while IFS= read -r command; do
    id=$(printf '%s' "$command" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
    printf '{{"id":"%s","type":"response","command":"get_available_models","success":true,"data":{{"models":{models}}}}}\n' "$id"
done
"#
        ),
    )
    .unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path
}

async fn api(directory: &TempDir, executable_path: PathBuf) -> SessionApi {
    let database = Database::open(":memory:").await.unwrap();
    SessionApi::new(
        pau_pi::PiSessionRegistry::new(database.processes()),
        DiscoverPiOptions {
            executable_path: Some(executable_path),
            path: Default::default(),
            home_directory: Some(directory.path().to_path_buf()),
            agent_directory: None,
            session_directory: None,
            working_directory: directory.path().to_path_buf(),
        },
        EventHub::default(),
    )
}

async fn pi_readiness(api: &SessionApi, refresh: bool) -> AgentReadiness {
    api.readiness(refresh).await.agents.remove(0)
}

fn launches(directory: &TempDir) -> usize {
    fs::read_to_string(directory.path().join("launches.txt"))
        .map(|log| log.lines().count())
        .unwrap_or(0)
}

#[tokio::test]
async fn reports_a_ready_pi_and_reuses_the_report() {
    let directory = tempfile::tempdir().unwrap();
    let pi = write_pi(
        directory.path(),
        "1.0.0",
        r#"[{"id":"a","provider":"p"},{"id":"b","provider":"p"}]"#,
    );
    let api = api(&directory, pi.clone()).await;

    let ready = pi_readiness(&api, false).await;
    assert_eq!(ready.agent, "pi");
    assert!(ready.found && ready.version_supported && ready.ready);
    assert_eq!(ready.version.as_deref(), Some("1.0.0"));
    assert_eq!(ready.model_count, Some(2));
    assert_eq!(ready.executable_path, Some(pi.display().to_string()));
    assert_eq!(ready.reason, None);

    pi_readiness(&api, false).await;
    assert_eq!(launches(&directory), 1);
    pi_readiness(&api, true).await;
    assert_eq!(launches(&directory), 2);
}

#[tokio::test]
async fn reports_a_pi_without_models() {
    let directory = tempfile::tempdir().unwrap();
    let pi = write_pi(directory.path(), "1.0.0", "[]");
    let readiness = pi_readiness(&api(&directory, pi).await, false).await;

    assert!(readiness.found && readiness.version_supported);
    assert!(!readiness.ready);
    assert_eq!(readiness.model_count, Some(0));
    assert!(readiness.reason.unwrap().contains("no models"));
}

#[tokio::test]
async fn reports_a_missing_executable() {
    let directory = tempfile::tempdir().unwrap();
    let missing = directory.path().join("missing");
    let readiness = pi_readiness(&api(&directory, missing).await, false).await;

    assert!(!readiness.found && !readiness.ready);
    assert_eq!(readiness.version, None);
    assert_eq!(readiness.model_count, None);
    assert!(readiness.reason.unwrap().contains("does not exist"));
}

#[tokio::test]
async fn reports_an_unsupported_version_without_starting_pi() {
    let directory = tempfile::tempdir().unwrap();
    let pi = write_pi(directory.path(), "0.50.0", "[]");
    let readiness = pi_readiness(&api(&directory, pi).await, false).await;

    assert!(readiness.found && !readiness.version_supported && !readiness.ready);
    assert_eq!(readiness.version.as_deref(), Some("0.50.0"));
    assert_eq!(readiness.model_count, None);
    assert!(readiness.reason.unwrap().contains("unsupported"));
    assert_eq!(launches(&directory), 0);
}
