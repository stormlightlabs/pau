//! Claude Code's own sandbox settings.

use std::{ffi::OsString, path::PathBuf};

use serde_json::{Value, json};

use super::{
    EffectiveSandbox, ResolvedSandbox, SandboxAdapter, SandboxError, SandboxLaunchInput,
    prepare_sandbox, resolve_sandbox, write_private_file,
};

/// A prepared Claude launch.
#[derive(Debug, Clone, PartialEq)]
pub struct ClaudeSandboxLaunch {
    /// Profile to show before sandboxed work starts.
    pub effective: EffectiveSandbox,
    /// Placeholders to record with the process metadata.
    pub placeholders: Vec<PathBuf>,
    /// Arguments for the Claude bridge host: `--settings <file>`.
    pub bridge_arguments: Vec<OsString>,
}

/// Resolves a Claude launch and writes Claude's settings file.
///
/// Claude runs as its own sandbox host, so Pau passes the profile to Claude
/// instead of wrapping Claude. The bridge then also disables Claude's MCP
/// servers, which Claude would start outside its sandbox.
pub fn prepare_claude_sandbox(
    input: &SandboxLaunchInput<'_>,
) -> Result<ClaudeSandboxLaunch, SandboxError> {
    let resolved = resolve_sandbox(&SandboxLaunchInput {
        adapter: SandboxAdapter::Claude,
        settings: input.settings,
        workspace: input.workspace,
        home: input.home,
        session_directory: input.session_directory,
        executables: input.executables,
        runtime_roots: input.runtime_roots,
        tool_path: input.tool_path,
        credential_environment: input.credential_environment,
    })?;
    prepare_sandbox(&resolved)?;
    let settings_file = resolved.host_directory.join("claude-settings.json");
    write_private_file(
        &settings_file,
        &serde_json::to_vec_pretty(&claude_settings(&resolved)).expect("settings are serializable"),
    )?;
    Ok(ClaudeSandboxLaunch {
        effective: resolved.effective,
        placeholders: resolved.placeholders,
        bridge_arguments: vec!["--settings".into(), settings_file.into()],
    })
}

/// Builds the Claude Code `--settings` document that starts Claude with its
/// own sandbox and the same profile.
///
/// Claude's sandbox covers its Bash tool and that tool's descendants. Web
/// tools are denied unless the operator enabled them, and enabled tools ask
/// on every call.
pub fn claude_settings(resolved: &ResolvedSandbox) -> Value {
    let filesystem = &resolved.policy.runtime_config["filesystem"];
    let network = &resolved.policy.runtime_config["network"];
    let web_tools = ["WebFetch", "WebSearch"];
    let enabled = &resolved.policy.unsandboxed_tools;
    let deny = web_tools
        .iter()
        .filter(|tool| !enabled.iter().any(|enabled| enabled == *tool))
        .collect::<Vec<_>>();
    // The working directory is Claude's own write root, so only extra roots
    // are listed.
    let allow_write = filesystem["allowWrite"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|path| path.as_str() != Some(resolved.policy.workspace.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    json!({
        "sandbox": {
            "enabled": true,
            "failIfUnavailable": true,
            "allowUnsandboxedCommands": false,
            "network": {
                "allowedDomains": network["allowedDomains"],
                "strictAllowlist": true,
                "allowAllUnixSockets": network["allowAllUnixSockets"],
                "allowLocalBinding": false,
            },
            "filesystem": {
                "allowWrite": allow_write,
                "denyWrite": filesystem["denyWrite"],
                "denyRead": filesystem["denyRead"],
                "allowRead": filesystem["allowRead"],
            },
        },
        "permissions": { "deny": deny, "ask": enabled },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::{
        SandboxAdapter, SandboxSettings,
        fixtures::{array, fixture, resolve},
        policy::path_string,
    };

    #[test]
    fn prepares_the_bridge_settings_file() {
        let fixture = fixture();
        let executables = crate::sandbox::fixtures::executables();
        let launch = prepare_claude_sandbox(&SandboxLaunchInput {
            adapter: SandboxAdapter::Pi,
            settings: &SandboxSettings::workspace_write(),
            workspace: &fixture.workspace,
            home: &fixture.home,
            session_directory: &fixture.session,
            executables: &executables,
            runtime_roots: &[],
            tool_path: "/usr/bin",
            credential_environment: &Default::default(),
        })
        .unwrap();
        let file = fixture.session.join("host/claude-settings.json");
        assert_eq!(
            launch.bridge_arguments,
            [OsString::from("--settings"), file.clone().into()]
        );
        assert_eq!(launch.effective.adapter, SandboxAdapter::Claude);
        let written: Value = serde_json::from_slice(&std::fs::read(file).unwrap()).unwrap();
        assert_eq!(written["sandbox"]["enabled"], true);
    }

    #[test]
    fn claude_settings_start_claude_with_a_strict_sandbox() {
        let fixture = fixture();
        let mut settings = SandboxSettings::workspace_write();
        settings.grants.domains = vec!["registry.npmjs.org".into()];
        settings.unsandboxed_tools = vec!["WebFetch".into()];
        let resolved = resolve(&fixture, SandboxAdapter::Claude, &settings).unwrap();
        let claude = claude_settings(&resolved);
        assert_eq!(claude["sandbox"]["enabled"], true);
        assert_eq!(claude["sandbox"]["failIfUnavailable"], true);
        assert_eq!(claude["sandbox"]["allowUnsandboxedCommands"], false);
        assert_eq!(claude["sandbox"]["network"]["strictAllowlist"], true);
        assert_eq!(
            claude["sandbox"]["network"]["allowedDomains"],
            json!(["registry.npmjs.org"])
        );
        assert_eq!(claude["permissions"]["deny"], json!(["WebSearch"]));
        assert_eq!(claude["permissions"]["ask"], json!(["WebFetch"]));
        assert!(
            !array(&claude["sandbox"]["filesystem"]["allowWrite"])
                .contains(&path_string(&fixture.workspace))
        );
    }
}
