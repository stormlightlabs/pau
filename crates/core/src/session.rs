//! Wire types for live agent sessions.
//!
//! Agent adapters own their native protocols. These types carry only the
//! session state and controls that clients use across adapters.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The lifecycle state of a live agent session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum SessionStatus {
    /// The process is starting.
    Starting,
    /// The agent can accept a new prompt.
    Idle,
    /// The agent is processing work or settling callbacks.
    Running,
    /// The agent is waiting for operator input.
    Waiting,
    /// The process is shutting down.
    Stopping,
    /// The process stopped after a request to stop it.
    Stopped,
    /// The process exited unexpectedly or the adapter failed.
    Failed,
}

/// Controls a session accepts.
///
/// Clients hide or disable a control the session does not support. The server
/// rejects an unsupported control with `unsupported_control`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionCapabilities {
    /// Whether the session accepts prompts.
    pub prompt: bool,
    /// Whether the session can queue follow-up work during a run.
    pub follow_up: bool,
    /// Whether the session can steer an active run.
    pub steer: bool,
    /// Whether the session can interrupt an active run.
    pub interrupt: bool,
    /// Whether the session exposes and can clear its queued messages.
    pub message_queue: bool,
    /// Whether the session can select a model.
    pub model_selection: bool,
    /// Whether the session can change the thinking level.
    pub thinking_level: bool,
    /// Whether the session can list its slash commands.
    pub command_discovery: bool,
    /// Whether the session can compact its context and toggle automatic
    /// compaction.
    pub compaction: bool,
    /// Whether the session can stop its process.
    pub stop: bool,
}

/// A live or just-ended agent session.
///
/// `session_changed` events carry this value as their payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AgentSession {
    /// Stable Pau session identifier.
    pub id: String,
    /// Workspace in which the agent runs.
    pub workspace_id: String,
    /// Latest observed lifecycle state.
    pub status: SessionStatus,
    /// RFC 3339 timestamp at which Pau started the process.
    pub started_at: String,
    /// RFC 3339 timestamp at which the process exited, once it has.
    pub ended_at: Option<String>,
    /// Process exit code, when the process exited with one.
    pub exit_code: Option<i32>,
    /// Controls this session accepts.
    pub capabilities: SessionCapabilities,
}

/// A provider model to select.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionModelSelection {
    /// Provider that serves the model.
    pub provider: String,
    /// The provider's model identifier.
    pub model_id: String,
}

/// Starts an agent session in a registered workspace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct StartSessionRequest {
    /// Workspace in which the agent runs.
    pub workspace_id: String,
    /// Model to select before the session accepts work. The agent's configured
    /// default applies when this is absent.
    pub model: Option<SessionModelSelection>,
}

/// Where a prompt sent during an active run waits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum SessionQueue {
    /// Deliver the prompt after the current assistant turn and its tool calls.
    Steer,
    /// Deliver the prompt after all current work finishes.
    FollowUp,
}

/// Sends a prompt to a session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionPromptRequest {
    /// Prompt text.
    pub message: String,
    /// Queue for a prompt sent during an active run. A running session rejects
    /// a prompt without one.
    pub queue: Option<SessionQueue>,
}

/// Sends a steer or follow-up message during an active run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionMessageRequest {
    /// Message text.
    pub message: String,
}

/// A reasoning effort level for model turns.
///
/// A model that cannot reason, or that lacks the requested level, may clamp
/// it to the nearest level it supports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum SessionThinkingLevel {
    /// No reasoning.
    Off,
    /// Minimal reasoning.
    Minimal,
    /// Low reasoning.
    Low,
    /// Medium reasoning.
    Medium,
    /// High reasoning.
    High,
    /// Extra-high reasoning, available on some models.
    #[serde(rename = "xhigh")]
    #[ts(rename = "xhigh")]
    ExtraHigh,
    /// The highest reasoning level a model offers.
    Max,
}

/// Selects a session's thinking level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionThinkingLevelRequest {
    /// Level for later model turns.
    pub level: SessionThinkingLevel,
}

/// Compacts a session's context.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionCompactRequest {
    /// Guidance for what the summary should preserve.
    pub custom_instructions: Option<String>,
}

/// The summary that replaced a session's older context.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionCompactionResult {
    /// The summary that replaces older context.
    pub summary: String,
    /// The first session entry kept verbatim after the summary.
    pub first_kept_entry_id: Option<String>,
    /// Context tokens before compaction.
    pub tokens_before: Option<u64>,
    /// Estimated context tokens after compaction.
    pub estimated_tokens_after: Option<u64>,
    /// The agent's complete native result.
    #[ts(type = "unknown")]
    pub native: serde_json::Value,
}

/// Turns automatic compaction on or off.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionAutoCompactionRequest {
    /// Whether the session compacts when its context is nearly full.
    pub enabled: bool,
}

/// Messages waiting in a session's steer and follow-up queues.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionMessageQueue {
    /// Messages delivered after the current assistant turn and its tool calls.
    pub steering: Vec<String>,
    /// Messages delivered after all current work finishes.
    pub follow_up: Vec<String>,
}

/// The kind of resource that provides a slash command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum SessionCommandSource {
    /// A command registered by an extension.
    Extension,
    /// A prompt template.
    Prompt,
    /// A skill.
    Skill,
}

/// A slash command a session offers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionCommand {
    /// The name typed after the slash, without the leading `/`.
    pub name: String,
    /// The command's description, when it has one.
    pub description: Option<String>,
    /// The kind of resource that provides the command.
    pub source: SessionCommandSource,
    /// The file that defines the command, when the agent reports one.
    pub path: Option<String>,
}
