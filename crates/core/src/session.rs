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
    /// The process still runs but stopped answering. Commands to the session
    /// fail with `agent_not_responding` until it writes output again;
    /// stopping it still works.
    NotResponding,
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
    /// Whether the session reports context-window, token, and cost usage.
    pub usage: bool,
    /// Whether the session can compact its context and toggle automatic
    /// compaction.
    pub compaction: bool,
    /// Whether the session exposes its entry tree and can branch from it.
    pub branching: bool,
    /// Whether the session can send a failed turn's prompt again and manage
    /// automatic retry.
    pub retry: bool,
    /// Whether the session can be renamed.
    pub rename: bool,
    /// Whether the session can be cloned into a new stored session.
    pub clone_session: bool,
    /// Whether the session can export its conversation to a file.
    pub export_transcript: bool,
    /// Whether the session can run shell commands outside a model turn and
    /// stop them.
    pub shell_commands: bool,
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
    /// The agent the session runs, such as `pi` or `claude`.
    pub agent: String,
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
    /// Identifier of the native session the agent is running. For Pi it
    /// matches a saved session's `id` and changes when the session branches.
    /// Absent until the agent reports it; Claude reports it after its first
    /// turn.
    #[serde(default)]
    pub native_session_id: Option<String>,
    /// Thinking level Pi currently applies, after any clamping to the model.
    /// Absent until Pi reports it.
    #[serde(default)]
    pub thinking_level: Option<SessionThinkingLevel>,
    /// Thinking levels the current model supports, in the order Pi lists
    /// them. A model without reasoning support offers only `off`. The list
    /// follows the model and changes with it. Empty until Pi reports it.
    #[serde(default)]
    pub thinking_levels: Vec<SessionThinkingLevel>,
    /// Display name Pi stores in the session file. Absent until the session
    /// is named or while Pi has not reported it.
    #[serde(default)]
    pub name: Option<String>,
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
    /// The agent to start, by its readiness identifier, such as `pi` or
    /// `claude`. Pi starts when this is absent.
    #[serde(default)]
    pub agent: Option<String>,
    /// Workspace in which the agent runs.
    pub workspace_id: String,
    /// Model to select before the session accepts work. The agent's configured
    /// default applies when this is absent.
    pub model: Option<SessionModelSelection>,
    /// Native session to resume, from the workspace's native session list.
    /// A new native session starts when this is absent.
    #[serde(default)]
    pub native_session_id: Option<String>,
}

/// A session the agent stored on disk for a workspace, which a new live
/// session can resume.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct NativeSessionSummary {
    /// Identifier to pass as `native_session_id` when starting a session.
    pub id: String,
    /// Name the user gave the session.
    pub name: Option<String>,
    /// Start of the first user message, for sessions without a name.
    pub first_message: Option<String>,
    /// RFC 3339 timestamp at which the agent created the session.
    pub created_at: String,
    /// RFC 3339 timestamp of the last change to the session file.
    pub modified_at: Option<String>,
    /// Absolute path of the session file.
    pub path: String,
}

/// A stored session file that could not be listed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct NativeSessionWarning {
    /// Absolute path of the skipped file.
    pub path: String,
    /// Why the file was skipped.
    pub message: String,
}

/// The sessions the agent stored for a workspace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct NativeSessionList {
    /// Readable sessions, most recently changed first.
    pub sessions: Vec<NativeSessionSummary>,
    /// Files that were skipped because they could not be read.
    pub warnings: Vec<NativeSessionWarning>,
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

/// An image attached to a prompt, steer, or follow-up message.
///
/// The server accepts PNG, JPEG, GIF, and WebP images of up to 5 MiB each and
/// 10 MiB per request, measured after decoding, and only for a model that
/// accepts image input.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionImage {
    /// The image's MIME type, such as `image/png`.
    pub mime_type: String,
    /// The image bytes, base64-encoded.
    pub data: String,
}

/// Sends a prompt to a session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionPromptRequest {
    /// Prompt text.
    pub message: String,
    /// Queue for a prompt sent during an active run. A running session rejects
    /// a prompt without one.
    pub queue: Option<SessionQueue>,
    /// Images sent with the prompt.
    pub images: Option<Vec<SessionImage>>,
}

/// Sends a steer or follow-up message during an active run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionMessageRequest {
    /// Message text.
    pub message: String,
    /// Images sent with the message.
    pub images: Option<Vec<SessionImage>>,
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

/// How full the model's context window is.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
pub struct SessionContextUsage {
    /// Estimated tokens in the context window, or `null` until the agent has
    /// a usage report for the current context (for example right after a
    /// compaction).
    pub tokens: Option<u64>,
    /// The model's context window size in tokens.
    pub context_window: u64,
    /// Percent of the window in use, from 0 to 100, or `null` when `tokens`
    /// is unknown.
    pub percent: Option<f64>,
}

/// Cumulative model tokens a session has used.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionTokenUsage {
    /// Input tokens.
    pub input: u64,
    /// Output tokens.
    pub output: u64,
    /// Tokens read from the provider's prompt cache.
    pub cache_read: u64,
    /// Tokens written to the provider's prompt cache.
    pub cache_write: u64,
    /// All tokens the agent counted.
    pub total: u64,
}

/// Model context, token, and cost usage for a session.
///
/// This is model usage only. Machine resource use (CPU, memory) is reported
/// separately by the resource monitor.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
pub struct SessionUsage {
    /// Current context-window fill, or `null` when the agent has no model or
    /// window size to report.
    pub context: Option<SessionContextUsage>,
    /// Tokens used across the whole session.
    pub tokens: SessionTokenUsage,
    /// Cumulative cost in US dollars as the agent computes it.
    pub cost: f64,
}

/// Turns automatic compaction on or off.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionAutoCompactionRequest {
    /// Whether the session compacts when its context is nearly full.
    pub enabled: bool,
}

/// Turns automatic retry of transient provider errors on or off.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionAutoRetryRequest {
    /// Whether the session retries overloaded, rate-limited, and 5xx failures.
    pub enabled: bool,
}

/// Renames a session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionRenameRequest {
    /// The display name stored with the session.
    pub name: String,
}

/// Saves the session's transcript to a file the operator chose.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionExportRequest {
    /// Absolute path of the file to write. A file already there is replaced.
    pub destination: String,
}

/// The stored session a clone continues in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionCloneResult {
    /// Identifier of the new native session. The live session now continues
    /// it, and the original stays in the workspace's native session list.
    pub native_session_id: String,
}

/// Runs a shell command in a session outside a model turn.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionShellRequest {
    /// The command line, run by the agent's shell in the session's working
    /// directory.
    pub command: String,
    /// Whether to keep the command and its output out of the model context.
    /// The session still stores them.
    pub exclude_from_context: bool,
}

/// How a session shell command finished.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionShellResult {
    /// Identifier of the command, matching the `id` of the
    /// `shell_command_start`, `bash_execution_update`, and
    /// `shell_command_end` events it produced.
    pub id: String,
    /// Combined stdout and stderr, truncated when it was long.
    pub output: String,
    /// The exit code, or `null` when the command was stopped or killed.
    pub exit_code: Option<i32>,
    /// Whether a stop request ended the command.
    pub cancelled: bool,
    /// Whether `output` holds only the end of the output.
    pub truncated: bool,
    /// The file that holds the complete output when it was truncated.
    pub full_output_path: Option<String>,
}

/// Messages waiting in a session's steer and follow-up queues.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionMessageQueue {
    /// Messages delivered after the current assistant turn and its tool calls.
    pub steering: Vec<String>,
    /// Messages delivered after all current work finishes.
    pub follow_up: Vec<String>,
}

/// One entry in a session's tree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionTreeEntry {
    /// The agent's entry identifier, usable as a branch point.
    pub id: String,
    /// The entry this one continues, or none for a root.
    pub parent_id: Option<String>,
    /// The agent's entry type, such as `message` or `compaction`.
    pub kind: String,
    /// The message role, for message entries.
    pub role: Option<String>,
    /// The start of the entry's text, empty when it has none.
    pub preview: String,
    /// The entry's ISO 8601 time, when recorded.
    pub timestamp: Option<String>,
}

/// A session's entry tree in the order the agent recorded it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionTree {
    /// Entries, oldest first. Follow `parent_id` to rebuild branches.
    pub entries: Vec<SessionTreeEntry>,
    /// The entry the session currently continues from.
    pub leaf_id: Option<String>,
    /// Whether older entries were left out to bound the response.
    pub truncated: bool,
}

/// One entry of a session's conversation that contains a search query.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionSearchMatch {
    /// The agent's entry identifier.
    pub entry_id: String,
    /// The message role, or none for summaries.
    pub role: Option<String>,
    /// Whitespace-collapsed text around the first occurrence.
    pub snippet: String,
    /// Start of the occurrence in `snippet`, in UTF-16 code units.
    #[ts(type = "number")]
    pub match_start: usize,
    /// End of the occurrence in `snippet`, in UTF-16 code units.
    #[ts(type = "number")]
    pub match_end: usize,
    /// The entry's ISO 8601 time, when recorded.
    pub timestamp: Option<String>,
}

/// The matches of a transcript search over the whole persisted conversation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionSearchResult {
    /// Matching entries, newest first, one per entry.
    pub matches: Vec<SessionSearchMatch>,
    /// Whether older matches were left out to honour the limit.
    pub truncated: bool,
}

/// The conversation a live session continues, as the agent reports it.
///
/// Messages stay in the agent's native JSON, the same shapes its
/// `message_end` events carry, just as `session_output` passes native events
/// through. Clients then project history and live output with one reducer, and
/// newer agent fields reach them unchanged.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct SessionMessages {
    /// The last event sequence published before the agent was asked. Clients
    /// apply only `session_output` events after it on top of `messages`.
    /// Output published while the agent answered can also appear in
    /// `messages`, so clients must apply those events idempotently.
    pub sequence: u64,
    /// Native messages, oldest first. After a compaction the first message is
    /// the agent's summary of the older context.
    #[ts(type = "unknown[]")]
    pub messages: Vec<serde_json::Value>,
    /// Whether older messages were left out to bound the response.
    pub truncated: bool,
}

/// Continues a session from an earlier user message in a new branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionBranchRequest {
    /// The user message entry to branch from.
    pub entry_id: String,
}

/// The outcome of a branch request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionBranchResult {
    /// The text of the message branched from, for the prompt editor.
    pub text: Option<String>,
    /// Whether an extension cancelled the branch.
    pub cancelled: bool,
}

/// A model a session can use.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionModel {
    /// The provider the model is routed through.
    pub provider: String,
    /// The model identifier within the provider.
    pub id: String,
    /// The model's display name, when the agent reports one.
    pub name: Option<String>,
    /// Whether the model supports reasoning.
    pub reasoning: bool,
    /// Whether the session currently uses this model.
    pub current: bool,
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

/// A blocking request from a Pi extension that waits for the operator.
///
/// Clients answer it with [`ExtensionUiResponse`]. Pi resolves a dialog that
/// has a timeout on its own when the timeout passes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(tag = "kind", rename_all = "snake_case")]
pub enum ExtensionDialog {
    /// Choose one of the offered strings.
    Select {
        /// Request identifier to answer.
        id: String,
        /// Dialog heading.
        title: String,
        /// Values offered by the extension.
        options: Vec<String>,
        /// Milliseconds after which Pi resolves the dialog itself.
        timeout_ms: Option<u64>,
    },
    /// Confirm or decline an action.
    Confirm {
        /// Request identifier to answer.
        id: String,
        /// Dialog heading.
        title: String,
        /// Question or consequence shown below the heading.
        message: String,
        /// Milliseconds after which Pi resolves the dialog itself.
        timeout_ms: Option<u64>,
    },
    /// Enter one line of text.
    Input {
        /// Request identifier to answer.
        id: String,
        /// Dialog heading.
        title: String,
        /// Hint shown in the empty field.
        placeholder: Option<String>,
        /// Milliseconds after which Pi resolves the dialog itself.
        timeout_ms: Option<u64>,
    },
    /// Edit multi-line text.
    Editor {
        /// Request identifier to answer.
        id: String,
        /// Dialog heading.
        title: String,
        /// Initial content.
        prefill: Option<String>,
    },
    /// A request Pau cannot render. Only a cancellation answers it.
    Unsupported {
        /// Request identifier to answer.
        id: String,
        /// Pi's name for the request method.
        method: String,
    },
}

impl ExtensionDialog {
    /// The identifier a response must carry.
    pub fn id(&self) -> &str {
        match self {
            Self::Select { id, .. }
            | Self::Confirm { id, .. }
            | Self::Input { id, .. }
            | Self::Editor { id, .. }
            | Self::Unsupported { id, .. } => id,
        }
    }
}

/// Where a widget sits relative to the prompt editor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(rename_all = "kebab-case")]
pub enum ExtensionWidgetPlacement {
    /// Before the editor.
    AboveEditor,
    /// After the editor.
    BelowEditor,
}

/// One keyed status line set by an extension.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ExtensionStatus {
    /// Extension-owned key.
    pub key: String,
    /// Status text.
    pub text: String,
}

/// One string-only widget set by an extension.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ExtensionWidget {
    /// Extension-owned key.
    pub key: String,
    /// Widget lines.
    pub lines: Vec<String>,
    /// Position relative to the prompt editor.
    pub placement: ExtensionWidgetPlacement,
}

/// Extension UI that is still current for a session.
///
/// Notifications are not part of this state. They are transient and arrive
/// only as native `session_output` events.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionExtensionUi {
    /// Unanswered dialogs, oldest first.
    pub dialogs: Vec<ExtensionDialog>,
    /// Status lines in the order they were first set.
    pub statuses: Vec<ExtensionStatus>,
    /// Widgets in the order they were first set.
    pub widgets: Vec<ExtensionWidget>,
}

/// An operator's answer to an [`ExtensionDialog`].
///
/// `select`, `input`, and `editor` dialogs take a value, `confirm` takes a
/// decision, and any dialog accepts a cancellation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum ExtensionUiResponse {
    /// The selected, entered, or edited text.
    Value {
        /// The text.
        value: String,
    },
    /// The decision for a confirmation.
    Confirmed {
        /// Whether the operator confirmed.
        confirmed: bool,
    },
    /// The operator dismissed the dialog.
    Cancelled {
        /// Always `true`.
        cancelled: bool,
    },
}
