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

/// A host environment variable selected for future credential brokerage.
///
/// The reference and its destination set are configuration. The variable's
/// value is resolved at launch and is never part of this serializable type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SandboxCredentialReference {
    /// Name of the variable in Pau's host environment.
    pub source: String,
    /// TLS destinations that may receive the credential.
    pub destinations: Vec<String>,
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
    /// Opt-in references to host credentials. Only source names and
    /// destinations are persisted.
    #[serde(default)]
    pub credential_references: Vec<SandboxCredentialReference>,
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
            credential_references: Vec::new(),
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
    let mut sources = std::collections::BTreeSet::new();
    for reference in &settings.credential_references {
        let mut characters = reference.source.chars();
        let valid_source = characters
            .next()
            .is_some_and(|character| character.is_ascii_alphabetic() || character == '_')
            && characters.all(|character| character.is_ascii_alphanumeric() || character == '_');
        if !valid_source {
            return Err(SandboxError::Invalid(format!(
                "{:?} is not an environment variable name",
                reference.source
            )));
        }
        if !sources.insert(&reference.source) {
            return Err(SandboxError::Invalid(format!(
                "credential source {} is listed more than once",
                reference.source
            )));
        }
        if is_model_credential(&reference.source) {
            return Err(SandboxError::Invalid(format!(
                "{} is a model credential and cannot be brokered to sandboxed tools",
                reference.source
            )));
        }
        if reference.destinations.is_empty() {
            return Err(SandboxError::Invalid(format!(
                "credential source {} needs at least one destination",
                reference.source
            )));
        }
        for destination in &reference.destinations {
            validate_domain(destination)?;
        }
    }
    Ok(())
}

fn is_model_credential(source: &str) -> bool {
    matches!(
        source,
        "ANTHROPIC_API_KEY"
            | "OPENAI_API_KEY"
            | "GOOGLE_API_KEY"
            | "GEMINI_API_KEY"
            | "AZURE_OPENAI_API_KEY"
            | "AWS_BEARER_TOKEN_BEDROCK"
    )
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
    fn validates_credential_reference_sources_and_destinations() {
        let mut settings = SandboxSettings::workspace_write();
        settings.credential_references = vec![SandboxCredentialReference {
            source: "PACKAGE_TOKEN".to_owned(),
            destinations: vec!["registry.example.com:443".to_owned()],
        }];
        let selection = |settings: &SandboxSettings| SandboxSelection::Sandboxed {
            settings: settings.clone(),
        };
        assert!(validate_selection(&selection(&settings)).is_ok());

        for source in ["", "9TOKEN", "PACKAGE-TOKEN", "TOKEN=value"] {
            settings.credential_references[0].source = source.to_owned();
            assert!(
                validate_selection(&selection(&settings)).is_err(),
                "{source:?}"
            );
        }
        settings.credential_references[0].source = "ANTHROPIC_API_KEY".to_owned();
        assert!(validate_selection(&selection(&settings)).is_err());

        settings.credential_references[0].source = "PACKAGE_TOKEN".to_owned();
        settings.credential_references[0].destinations = vec!["https://example.com".to_owned()];
        assert!(validate_selection(&selection(&settings)).is_err());
        settings.credential_references[0].destinations.clear();
        assert!(validate_selection(&selection(&settings)).is_err());

        settings.credential_references[0].destinations = vec!["example.com".to_owned()];
        settings
            .credential_references
            .push(settings.credential_references[0].clone());
        assert!(validate_selection(&selection(&settings)).is_err());
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
