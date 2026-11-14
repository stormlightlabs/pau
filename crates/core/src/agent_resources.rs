//! Wire types for the skills, prompts, extensions, themes, and packages an
//! agent loads for a workspace.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Kind of agent resource.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum AgentResourceKind {
    /// Instructions the agent loads on demand.
    Skill,
    /// Prompt template run as a slash command.
    Prompt,
    /// Code that adds tools, commands, or UI to the agent.
    Extension,
    /// Color theme.
    Theme,
    /// Installed bundle of the other kinds.
    Package,
}

/// Whose configuration a resource belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum AgentResourceScope {
    /// The operator's own configuration, shared by every workspace.
    User,
    /// The workspace's configuration.
    Project,
}

/// How the agent finds a resource.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum AgentResourceSourceKind {
    /// A directory the agent scans by convention.
    Directory,
    /// A path or package listed in a settings file.
    Setting,
    /// A package the resource ships in.
    Package,
}

/// Whether the agent loads a resource's scope.
///
/// User resources are always trusted. Project resources follow the agent's
/// saved project trust decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum AgentResourceTrust {
    /// The agent loads it.
    Trusted,
    /// The operator declined the project, so the agent skips it.
    Untrusted,
    /// No decision is saved, so a desktop session skips it.
    Undecided,
}

/// Whether a resource loads, apart from trust.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum AgentResourceStatus {
    /// It loads. Warnings may still describe problems the agent tolerates.
    Ready,
    /// Another resource with the same name loads instead; see `winner`.
    Duplicate,
    /// The file is invalid and does not load; see `warnings`.
    Invalid,
    /// A declared package is not installed.
    Missing,
}

/// One resource and where it comes from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AgentResource {
    /// Stable identity within one index: the path, or for a package its
    /// scope and declared source.
    pub id: String,
    /// Resource kind.
    pub kind: AgentResourceKind,
    /// Skill, prompt, extension, or theme name, or a package's declared
    /// source.
    pub name: String,
    /// What the resource does, when its file says.
    pub description: Option<String>,
    /// Absolute path of the resource file, or of an installed package's
    /// directory.
    pub path: Option<String>,
    /// User or project.
    pub scope: AgentResourceScope,
    /// How the agent finds it.
    pub source_kind: AgentResourceSourceKind,
    /// The scanned directory, the settings file, or the package source.
    pub source: String,
    /// Whether the agent loads the resource's scope.
    pub trust: AgentResourceTrust,
    /// Whether the resource loads.
    pub status: AgentResourceStatus,
    /// Path of the resource that loads instead, for a duplicate.
    pub winner: Option<String>,
    /// Problems found in this resource.
    pub warnings: Vec<String>,
}

/// A discovery problem that belongs to no single resource, such as an
/// unreadable settings file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AgentResourceWarning {
    /// File or directory the warning is about.
    pub path: String,
    /// What was ignored and why.
    pub message: String,
}

/// Every resource the agent finds for a workspace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AgentResourceIndex {
    /// Loaded resources in the agent's lookup order, which decides
    /// duplicates, then resources that do not load, then packages.
    pub resources: Vec<AgentResource>,
    /// Problems that belong to no single resource.
    pub warnings: Vec<AgentResourceWarning>,
    /// Trust of the workspace's project resources.
    pub project_trust: AgentResourceTrust,
}
