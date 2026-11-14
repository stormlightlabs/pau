#![cfg(unix)]

use pau_agent::{ClaudeDiscoveryErrorCode, DiscoverClaudeOptions, discover_claude};
use std::ffi::OsString;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

fn write_script(directory: &Path, name: &str, body: &str) -> PathBuf {
    let path = directory.join(name);
    fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn on_path(directory: &Path) -> DiscoverClaudeOptions {
    DiscoverClaudeOptions {
        executable_path: None,
        bridge_path: None,
        path: OsString::from(directory),
    }
}

#[test]
fn finds_claude_and_the_bridge_on_path_and_builds_the_launch() {
    let directory = tempfile::tempdir().unwrap();
    let claude = write_script(directory.path(), "claude", "echo '2.1.281 (Claude Code)'");
    let bridge = write_script(directory.path(), "pau-claude-bridge", "exit 0");

    let discovery = discover_claude(&on_path(directory.path())).unwrap();
    assert_eq!(discovery.executable_path, claude);
    assert_eq!(discovery.bridge_path, bridge);
    assert_eq!(discovery.version.to_string(), "2.1.281");

    let launch = discovery.bridge_options(PathBuf::from("/work"), Some("native-1"));
    assert_eq!(launch.executable_path, bridge);
    assert_eq!(launch.working_directory, PathBuf::from("/work"));
    let arguments: Vec<OsString> = vec![
        "--claude".into(),
        claude.into(),
        "--cwd".into(),
        "/work".into(),
        "--resume".into(),
        "native-1".into(),
    ];
    assert_eq!(launch.arguments, arguments);
}

#[test]
fn reports_a_missing_claude() {
    let directory = tempfile::tempdir().unwrap();
    let error = discover_claude(&on_path(directory.path())).unwrap_err();
    assert_eq!(error.code(), ClaudeDiscoveryErrorCode::NotFound);
    assert_eq!(error.executable_path(), None);
    assert!(error.to_string().contains("Claude Code was not found"));

    let configured = directory.path().join("missing-claude");
    let error = discover_claude(&DiscoverClaudeOptions {
        executable_path: Some(configured.clone()),
        ..on_path(directory.path())
    })
    .unwrap_err();
    assert_eq!(error.code(), ClaudeDiscoveryErrorCode::NotFound);
    assert_eq!(error.executable_path(), Some(configured.as_path()));
}

#[test]
fn skips_relative_path_entries() {
    let directory = tempfile::tempdir().unwrap();
    write_script(directory.path(), "claude", "echo '2.1.281 (Claude Code)'");
    write_script(directory.path(), "pau-claude-bridge", "exit 0");
    // The same directory, named relative to the test's working directory.
    let up = std::env::current_dir().unwrap().components().count() - 1;
    let relative = Path::new(&"../".repeat(up)).join(directory.path().strip_prefix("/").unwrap());
    assert!(relative.join("claude").is_file());

    let error = discover_claude(&DiscoverClaudeOptions {
        path: std::env::join_paths([relative.as_path(), Path::new("")]).unwrap(),
        ..on_path(directory.path())
    })
    .unwrap_err();
    assert_eq!(error.code(), ClaudeDiscoveryErrorCode::NotFound);

    // A configured relative path reaches the bridge as an absolute one.
    let discovery = discover_claude(&DiscoverClaudeOptions {
        executable_path: Some(relative.join("claude")),
        bridge_path: Some(relative.join("pau-claude-bridge")),
        path: OsString::new(),
    })
    .unwrap();
    assert!(discovery.executable_path.is_absolute());
    assert!(discovery.bridge_path.is_absolute());
}

#[test]
fn reports_a_non_executable_claude() {
    let directory = tempfile::tempdir().unwrap();
    fs::write(directory.path().join("claude"), "").unwrap();
    let error = discover_claude(&on_path(directory.path())).unwrap_err();
    assert_eq!(error.code(), ClaudeDiscoveryErrorCode::NotExecutable);
}

#[test]
fn rejects_an_old_or_unreadable_claude_version() {
    let directory = tempfile::tempdir().unwrap();
    write_script(directory.path(), "pau-claude-bridge", "exit 0");
    write_script(directory.path(), "claude", "echo '2.1.0 (Claude Code)'");
    let error = discover_claude(&on_path(directory.path())).unwrap_err();
    assert_eq!(error.code(), ClaudeDiscoveryErrorCode::UnsupportedVersion);
    assert_eq!(
        error.version().map(ToString::to_string).as_deref(),
        Some("2.1.0")
    );
    assert!(error.to_string().contains("2.1.259 or newer"));

    write_script(directory.path(), "claude", "echo 'Claude Code'");
    let error = discover_claude(&on_path(directory.path())).unwrap_err();
    assert_eq!(error.code(), ClaudeDiscoveryErrorCode::InvalidVersion);

    write_script(directory.path(), "claude", "exit 3");
    let error = discover_claude(&on_path(directory.path())).unwrap_err();
    assert_eq!(error.code(), ClaudeDiscoveryErrorCode::VersionCommandFailed);
}

#[test]
fn reports_a_missing_bridge_after_a_supported_claude() {
    let directory = tempfile::tempdir().unwrap();
    let claude = write_script(directory.path(), "claude", "echo 2.1.259");
    let error = discover_claude(&on_path(directory.path())).unwrap_err();
    assert_eq!(error.code(), ClaudeDiscoveryErrorCode::BridgeNotFound);
    assert_eq!(error.executable_path(), Some(claude.as_path()));
    assert!(error.to_string().contains("pau-claude-bridge"));
}

#[test]
fn reads_the_version_when_a_background_process_holds_its_output() {
    let directory = tempfile::tempdir().unwrap();
    write_script(directory.path(), "pau-claude-bridge", "exit 0");
    write_script(
        directory.path(),
        "claude",
        "sleep 12 &\necho '2.1.281 (Claude Code)'",
    );

    let started = Instant::now();
    let discovery = discover_claude(&on_path(directory.path())).unwrap();
    assert_eq!(discovery.version.to_string(), "2.1.281");
    // The background `sleep` keeps the output open for 12 seconds. Discovery
    // stops waiting at its 5-second deadline.
    assert!(
        started.elapsed() < Duration::from_secs(8),
        "{:?}",
        started.elapsed()
    );
}
