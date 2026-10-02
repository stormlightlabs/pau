//! Local process sandbox policy.
//!
//! Pau owns the sandbox policy in Rust. This module validates an operator's
//! selection, pins the containment executables, and resolves one launch into
//! the sandbox-runtime configuration, the tool environment, the placeholders
//! the runtime will create, and the effective profile shown to the operator.
//! The Pi extension and tool host in `packages/sandbox` only consume the
//! resolved policy file, so the profile shown before launch is the one that
//! runs.
//!
//! Permission modes are separate guardrails. Nothing here asks for approval,
//! and an approval never widens what this policy grants.

mod claude;
mod executables;
#[cfg(test)]
mod fixtures;
mod network;
mod placeholders;
mod policy;
mod selection;

use std::{fmt, io};

pub use claude::{ClaudeSandboxLaunch, claude_settings, prepare_claude_sandbox};
pub use executables::{SandboxExecutable, SandboxExecutables};
pub use placeholders::{is_placeholder, remove_placeholders};
pub use policy::{
    EffectiveSandbox, ResolvedSandbox, SandboxCredentialAccess, SandboxLaunchInput,
    SandboxNetworkAccess, SandboxPolicyFile, SandboxReadAccess, SandboxedMcpServer,
    prepare_sandbox, resolve_sandbox, write_private_file,
};
pub use selection::{
    SandboxAdapter, SandboxCredentialReference, SandboxGrants, SandboxPreviewRequest,
    SandboxProfileName, SandboxSelection, SandboxSelectionState, SandboxSettings, WorkspaceSandbox,
    validate_selection,
};

/// Current version of the policy file read by `packages/sandbox`.
pub const SANDBOX_POLICY_VERSION: u32 = 1;

/// Pi built-in tools that run in the sandboxed tool host.
pub const SANDBOXED_PI_TOOLS: [&str; 7] = ["read", "bash", "edit", "write", "grep", "find", "ls"];

/// A sandbox selection or launch that Pau refuses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SandboxError {
    /// This operating system has no supported sandbox.
    UnsupportedPlatform(String),
    /// A containment executable is missing or unsuitable.
    Executable(String),
    /// The selection names an invalid grant, root, or tool.
    Invalid(String),
    /// A path could not be canonicalized or written.
    Io(String),
}

impl fmt::Display for SandboxError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedPlatform(platform) => {
                write!(formatter, "the local sandbox does not support {platform}")
            }
            Self::Executable(message) | Self::Invalid(message) | Self::Io(message) => {
                formatter.write_str(message)
            }
        }
    }
}

impl std::error::Error for SandboxError {}

impl From<io::Error> for SandboxError {
    fn from(error: io::Error) -> Self {
        Self::Io(error.to_string())
    }
}
