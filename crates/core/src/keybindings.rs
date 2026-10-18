//! Wire types for the agent's key bindings.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Where an action's keys come from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum AgentKeybindingSource {
    /// The agent's built-in assignment.
    Default,
    /// The operator's own configuration.
    User,
}

/// One agent action and the keys that trigger it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AgentKeybinding {
    /// The agent's action identifier, such as `app.session.new`.
    pub action: String,
    /// The effective keys, such as `ctrl+shift+n`. Empty when the action is
    /// unbound.
    pub keys: Vec<String>,
    /// The agent's built-in keys for the action.
    pub default_keys: Vec<String>,
    /// Whether `keys` is the built-in assignment or the operator's override.
    pub source: AgentKeybindingSource,
}

/// A problem with the operator's key binding configuration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AgentKeybindingWarning {
    /// Absolute path of the configuration file.
    pub path: String,
    /// What was ignored and why.
    pub message: String,
}

/// The agent's effective key bindings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AgentKeybindings {
    /// Every known action with its effective keys.
    pub bindings: Vec<AgentKeybinding>,
    /// Parts of the operator's configuration that were ignored.
    pub warnings: Vec<AgentKeybindingWarning>,
}
