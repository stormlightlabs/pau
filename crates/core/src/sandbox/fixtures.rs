//! Shared launch fixtures for sandbox tests.

use std::{collections::BTreeMap, fs, path::PathBuf};

use serde_json::Value;

use super::{
    ResolvedSandbox, SandboxAdapter, SandboxError, SandboxExecutable, SandboxExecutables,
    SandboxLaunchInput, SandboxSettings, executables::SandboxPlatform, resolve_sandbox,
};

pub(super) fn executables() -> SandboxExecutables {
    SandboxExecutables {
        platform: SandboxPlatform::Linux,
        bubblewrap: Some(SandboxExecutable {
            name: "bwrap".into(),
            path: "/pinned/bwrap".into(),
            version: Some("0.12.0".into()),
        }),
        socat: Some(SandboxExecutable {
            name: "socat".into(),
            path: "/pinned/socat".into(),
            version: None,
        }),
        ripgrep: SandboxExecutable {
            name: "rg".into(),
            path: "/pinned/rg".into(),
            version: None,
        },
    }
}

pub(super) struct Fixture {
    pub(super) _directory: tempfile::TempDir,
    pub(super) workspace: PathBuf,
    pub(super) home: PathBuf,
    pub(super) session: PathBuf,
    pub(super) outside: PathBuf,
}

pub(super) fn fixture() -> Fixture {
    let directory = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(directory.path()).unwrap();
    let home = root.join("home");
    let workspace = home.join("project");
    let outside = root.join("outside");
    fs::create_dir_all(workspace.join(".git")).unwrap();
    fs::create_dir_all(&outside).unwrap();
    Fixture {
        _directory: directory,
        session: root.join("state/session"),
        workspace,
        home,
        outside,
    }
}

pub(super) fn resolve(
    fixture: &Fixture,
    adapter: SandboxAdapter,
    settings: &SandboxSettings,
) -> Result<ResolvedSandbox, SandboxError> {
    let executables = executables();
    let credential_environment = settings
        .credential_references
        .iter()
        .map(|reference| (reference.source.clone(), "fixture-secret".to_owned()))
        .collect::<BTreeMap<_, _>>();
    resolve_sandbox(&SandboxLaunchInput {
        adapter,
        settings,
        workspace: &fixture.workspace,
        home: &fixture.home,
        session_directory: &fixture.session,
        executables: &executables,
        runtime_roots: &[fixture.home.join("runtime")],
        tool_path: "/usr/bin:/bin",
        credential_environment: &credential_environment,
    })
}

pub(super) fn array(value: &Value) -> Vec<String> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry.as_str().unwrap().to_owned())
        .collect()
}
