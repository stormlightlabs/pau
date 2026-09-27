//! Operator sandbox selections and their validation.

use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{SANDBOXED_PI_TOOLS, SandboxError, network::validate_domain};

/// Pau sandbox profiles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(rename_all = "kebab-case")]
pub enum SandboxProfileName {
    /// Writes are allowed in the workspace and the session temporary directory.
    WorkspaceWrite,
    /// Writes are allowed only in the session temporary directory.
    ReadOnly,
}

/// Explicit access added to a profile. Every grant widens the profile, so the
/// effective profile names each one before sandboxed work starts.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SandboxGrants {
    /// Hosts in sandbox-runtime syntax, such as `example.com`,
    /// `*.example.com`, or `127.0.0.1:8080`.
    #[serde(default)]
    pub domains: Vec<String>,
    /// Absolute writable directories outside the workspace.
    #[serde(default)]
    pub writable_roots: Vec<String>,
    /// Allows every Unix socket. Linux cannot filter sockets by path.
    #[serde(default)]
    pub unix_sockets: bool,
}

/// One sandbox profile and its grants.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SandboxSettings {
    /// Base profile.
    pub profile: SandboxProfileName,
    /// Explicit widening of the base profile.
    #[serde(default)]
    pub grants: SandboxGrants,
    /// Denies reads from the home directory except the workspace and the
    /// directories the tool host needs.
    #[serde(default)]
    pub home_read_deny: bool,
    /// Keeps `/tmp/claude` writable for an operator who shares it with Claude
    /// Code on purpose. Pau denies it by default.
    #[serde(default)]
    pub share_claude_temp: bool,
    /// Tools without a contained launch path that the operator enabled. Each
    /// call runs outside the sandbox after its own approval.
    #[serde(default)]
    pub unsandboxed_tools: Vec<String>,
}

impl SandboxSettings {
    /// Workspace-write profile without grants.
    pub fn workspace_write() -> Self {
        Self {
            profile: SandboxProfileName::WorkspaceWrite,
            grants: SandboxGrants::default(),
            home_read_deny: false,
            share_claude_temp: false,
            unsandboxed_tools: Vec::new(),
        }
    }
}

/// Sandbox selection for model-initiated agent tools.
///
/// It never applies to operator terminals or editors, which need their own
/// explicit selection once their launch path supports containment.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "mode", rename_all = "kebab-case")]
#[ts(tag = "mode", rename_all = "kebab-case")]
pub enum SandboxSelection {
    /// Tools run with the operator's normal access. This is the default.
    #[default]
    Unsandboxed,
    /// Tools run inside the selected profile.
    Sandboxed {
        /// Profile and grants.
        settings: SandboxSettings,
    },
}

impl SandboxSelection {
    /// Returns the settings when this selection enables a sandbox.
    pub fn settings(&self) -> Option<&SandboxSettings> {
        match self {
            Self::Unsandboxed => None,
            Self::Sandboxed { settings } => Some(settings),
        }
    }
}

/// Workspace default and optional session override for one selection.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SandboxSelectionState {
    /// Workspace default. Missing persisted state is unsandboxed.
    pub workspace_default: SandboxSelection,
    /// Session-specific choice, when one has been recorded.
    pub session_override: Option<SandboxSelection>,
}

impl SandboxSelectionState {
    /// Returns the session override or the workspace default.
    pub fn effective(&self) -> &SandboxSelection {
        self.session_override
            .as_ref()
            .unwrap_or(&self.workspace_default)
    }
}

/// A workspace's default sandbox selection for new agent sessions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct WorkspaceSandbox {
    /// Workspace default.
    pub selection: SandboxSelection,
    /// Why no sandbox can start on this host, when that is the case.
    pub unavailable: Option<String>,
}

/// Request for the effective profile of a selection before launch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SandboxPreviewRequest {
    /// Adapter whose boundary would receive the profile.
    pub adapter: SandboxAdapter,
    /// Selection to describe.
    pub selection: SandboxSelection,
}

/// Agent adapter whose execution boundary receives a profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(rename_all = "kebab-case")]
pub enum SandboxAdapter {
    /// Pi's built-in tools run in Pau's sandboxed tool host.
    Pi,
    /// Claude Code runs its Bash tool in its own sandbox.
    Claude,
}

/// Checks a selection without touching the filesystem.
///
/// Launch resolution repeats these checks and also canonicalizes roots.
pub fn validate_selection(selection: &SandboxSelection) -> Result<(), SandboxError> {
    let Some(settings) = selection.settings() else {
        return Ok(());
    };
    for domain in &settings.grants.domains {
        validate_domain(domain)?;
    }
    for root in &settings.grants.writable_roots {
        if !Path::new(root).is_absolute() {
            return Err(SandboxError::Invalid(format!(
                "writable root {root} must be an absolute path"
            )));
        }
    }
    for tool in &settings.unsandboxed_tools {
        if tool.is_empty()
            || !tool
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "_-.:".contains(character))
        {
            return Err(SandboxError::Invalid(format!(
                "{tool:?} is not a tool name"
            )));
        }
        if SANDBOXED_PI_TOOLS.contains(&tool.as_str()) {
            return Err(SandboxError::Invalid(format!(
                "{tool} runs inside the sandbox and cannot be enabled outside it"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_domains_and_tools() {
        let mut settings = SandboxSettings::workspace_write();
        for domain in [
            "example.com",
            "*.example.com",
            "127.0.0.1:8080",
            "[::1]:443",
            "localhost",
        ] {
            settings.grants.domains = vec![domain.to_owned()];
            let selection = SandboxSelection::Sandboxed {
                settings: settings.clone(),
            };
            assert!(validate_selection(&selection).is_ok(), "{domain}");
        }
        for domain in [
            "",
            "*",
            "https://example.com",
            "example.com/path",
            "a b",
            "host:0",
        ] {
            settings.grants.domains = vec![domain.to_owned()];
            let selection = SandboxSelection::Sandboxed {
                settings: settings.clone(),
            };
            assert!(validate_selection(&selection).is_err(), "{domain:?}");
        }
        settings.grants.domains.clear();
        for (tool, valid) in [
            ("mcp", true),
            ("web_fetch", true),
            ("bash", false),
            ("", false),
        ] {
            settings.unsandboxed_tools = vec![tool.to_owned()];
            let selection = SandboxSelection::Sandboxed {
                settings: settings.clone(),
            };
            assert_eq!(validate_selection(&selection).is_ok(), valid, "{tool:?}");
        }
    }

    #[test]
    fn selection_state_prefers_the_session_override() {
        let sandboxed = SandboxSelection::Sandboxed {
            settings: SandboxSettings::workspace_write(),
        };
        let state = SandboxSelectionState {
            workspace_default: sandboxed.clone(),
            session_override: Some(SandboxSelection::Unsandboxed),
        };
        assert_eq!(state.effective(), &SandboxSelection::Unsandboxed);
        assert_eq!(
            SandboxSelectionState::default().effective(),
            &SandboxSelection::Unsandboxed
        );
        let json = serde_json::to_value(&sandboxed).unwrap();
        assert_eq!(json["mode"], "sandboxed");
        assert_eq!(json["settings"]["profile"], "workspace-write");
    }
}
