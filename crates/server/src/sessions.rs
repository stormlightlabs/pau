//! Live agent sessions over HTTP and the event stream.
//!
//! HTTP routes start, control, and stop sessions and return once the agent
//! accepts or rejects the request. Session progress arrives on `/api/events`:
//! `session_changed` carries an [`AgentSession`] whenever the lifecycle state
//! changes, and `session_output` carries each native agent event.
//!
//! # Agents
//!
//! A start request names its agent by the identifier the readiness report
//! uses, and Pi starts when it names none. Pi sessions run through `pau-pi`
//! and offer every route below. Claude sessions run through the Claude bridge
//! in `pau-agent` and offer the controls in
//! [`pau_agent::CLAUDE_BRIDGE_CAPABILITIES`]: prompt, interrupt, and stop. A
//! route for any other control answers `501 unsupported_control` for them.
//! Their `session_output` events are the bridge's events, as
//! `{"sequence", "event", "payload"}`. See the `claude` module.
//!
//! # Usage
//!
//! `GET /api/sessions/{id}/usage` returns the session's model context fill and
//! cumulative token and cost usage. Usage changes far more often than
//! lifecycle state and is not part of [`AgentSession`], so `session_changed`
//! stays small and needs no agent round trip. Instead, after each assistant
//! `message_end` and each `agent_settled` the API reads the usage once and
//! publishes a synthetic `session_usage` `session_output` event whose `usage`
//! field has the same shape as the route's response. Clients fetch the route
//! when they open a session, then apply those events instead of polling.
//! Model usage is separate from the machine resource use that the resource
//! monitor reports.
//!
//! # Extension UI
//!
//! Pi extension requests reach clients as `session_output` events, but those
//! events are transient: snapshots omit them, so a client that reconnects would
//! never learn about a dialog still waiting for an answer. The API therefore
//! also keeps each session's current extension UI (unanswered dialogs, status
//! lines, and widgets) and serves it from `GET /api/sessions/{id}/extension-ui`.
//! When a dialog stops waiting (answered, timed out, or cleared by an
//! interrupt or exit), the API publishes a synthetic `extension_ui_resolved`
//! `session_output` event with the request `id` and a `reason`, so live clients
//! can close it without refetching. Notifications are transient by nature and
//! stay output-only.
//!
//! # Interrupts
//!
//! `POST /api/sessions/{id}/interrupt` publishes a synthetic
//! `session_interrupted` `session_output` event before it asks Pi to abort a
//! running session. The abort ends with the same `running` to `idle`
//! `session_changed` as a finished turn, and the event comes first so clients
//! can tell the two apart, for example to skip a "turn finished"
//! notification.
//!
//! # Shell commands
//!
//! `POST /api/sessions/{id}/shell` runs a command through Pi's `bash` RPC
//! command and returns a [`SessionShellResult`] once it finishes. `DELETE` on
//! the same path stops every running command, and each stopped command
//! returns with `cancelled` set. Before Pi runs the command, the API publishes
//! a synthetic `shell_command_start` `session_output` event with the command
//! `id`, `command`, and `exclude_from_context`. Pi then streams the output as
//! native `bash_execution_update` events with the same `id` and a `delta`.
//! When the command finishes, a synthetic `shell_command_end` event carries
//! the `id` and either the `result` or an `error` message, with the other
//! field `null`. Every client can therefore show a command that another
//! client started. Commands run while the agent works as well as while it is
//! idle.
//!
//! # Conversation history
//!
//! The event buffer holds recent output only, and a resumed or branched
//! session starts with turns that never streamed. `GET
//! /api/sessions/{id}/messages` therefore returns Pi's own `get_messages`
//! answer for the current branch, passed through as native JSON like
//! `session_output`, with the last event sequence published before Pi was
//! asked. A client builds its transcript from the messages and then applies
//! only `session_output` events after that sequence. Pi can stream a message
//! while it answers, so that message may arrive in both; clients key messages
//! by their native identity to apply it once. At most
//! [`MAX_SESSION_MESSAGES`] of the newest messages return.
//!
//! `POST /api/sessions/{id}/export` saves the whole conversation as Pi's HTML
//! export, the page Pi's own `/export` command writes, to the absolute path in
//! a [`SessionExportRequest`]. See [`PiSession::export_html`] for how the file is
//! written. An unusable destination is `400 invalid_destination`. A folder Pau
//! may not write is `403 permission_denied`, a read-only disk `403 read_only`,
//! and a full disk `507 storage_full`. Any other failed write is
//! `500 export_failed`.

use std::{
    collections::HashMap,
    ffi::{OsStr, OsString},
    fs,
    os::unix::fs::DirBuilderExt,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Json,
    extract::{Path as AxumPath, Query, State},
    http::StatusCode,
};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use pau_agent::{
    AgentCapabilities, AgentControl, AgentControlError, AgentKind, AgentMessageQueue,
    AgentSessionStatus, ClaudeSession, DiscoverClaudeOptions, PromptQueueChoice, ThinkingLevel,
};
use pau_core::audit::{AuditActor, AuditEntry, AuditLog, AuditOperation, AuditResult};
use pau_core::readiness::AgentReadinessReport;
use pau_core::sandbox::{SandboxError, SandboxSettings};
use pau_core::{
    ServerEventKind,
    keybindings::{
        AgentKeybinding, AgentKeybindingSource, AgentKeybindingWarning, AgentKeybindings,
    },
    session::{
        AgentSession, ExtensionDialog, ExtensionStatus, ExtensionUiResponse, ExtensionWidget,
        ExtensionWidgetPlacement, NativeSessionList, NativeSessionSummary, NativeSessionWarning,
        SessionAutoCompactionRequest, SessionAutoRetryRequest, SessionBranchRequest,
        SessionBranchResult, SessionCapabilities, SessionCloneResult, SessionCommand,
        SessionCommandSource, SessionCompactRequest, SessionCompactionResult, SessionContextUsage,
        SessionExportRequest, SessionExtensionUi, SessionImage, SessionMessageQueue,
        SessionMessageRequest, SessionMessages, SessionModel, SessionModelSelection,
        SessionPromptRequest, SessionQueue, SessionRenameRequest, SessionSearchMatch,
        SessionSearchResult, SessionShellRequest, SessionShellResult, SessionStatus,
        SessionThinkingLevel, SessionThinkingLevelRequest, SessionTokenUsage, SessionTree,
        SessionTreeEntry, SessionUsage, StartSessionRequest,
    },
};
use pau_pi::{
    DiscoverPiMcpOptions, DiscoverPiOptions, PiCommand, PiCommandSource, PiDiscovery,
    PiExtensionUiRequest, PiExtensionUiResponse, PiExtensionWidgetPlacement, PiImage,
    PiKeybindingSource, PiMcpAdapterState, PiModel, PiProcessError, PiProcessOutput,
    PiSandboxLaunch, PiSession, PiSessionError, PiSessionOutput, PiSessionRegistry,
    PiSessionRegistryError, PiSessionUsage, PreparePiSandbox, StartRegisteredPiSession,
    discover_pi, discover_pi_mcp, find_pi_session_file, list_pi_session_files,
    pi_configuration_paths, prepare_pi_sandbox, read_pi_keybindings,
};
use serde::Deserialize;
use serde_json::Value;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::{sync::broadcast, task::JoinSet};

use crate::{
    ApiError, ApiState, EventHub, SandboxApi,
    audit::{PendingAudit, export_target},
    build_info::Channel,
    credential_environment, diagnostic_timestamp, stop_or_kill, workspace_service,
};

/// The `packages/sandbox` directory of the checkout this server was built
/// from, which development builds load the sandbox extension from.
const SANDBOX_PACKAGE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../packages/sandbox");

/// Directory under the desktop app's resources that holds the bundled
/// sandbox package: its sources, `package.json` and production
/// `node_modules`.
const BUNDLED_SANDBOX_PACKAGE: &str = "sandbox";

/// Where sandboxed Pi sessions load the sandbox extension from, and the
/// directories its tool host may read to run it.
///
/// The tool host runs Pi's `node` on the extension's sources and their
/// dependencies, which a profile that hides the home directory must still let
/// it read. The read grants name only those directories, never the checkout
/// or app bundle around them: a checkout can hold secrets such as `.env`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SandboxExtension {
    package: PathBuf,
    runtime_roots: Vec<PathBuf>,
}

impl SandboxExtension {
    /// The package in this server's checkout, with the checkout's
    /// `node_modules`, where pnpm keeps the package's dependencies.
    pub(crate) fn checkout() -> Self {
        let package = PathBuf::from(SANDBOX_PACKAGE);
        Self {
            runtime_roots: vec![package.clone(), package.join("../../node_modules")],
            package,
        }
    }

    /// The bundled package for a release build that runs from an app with
    /// `resources`, and the checkout's otherwise. Release builds are made in
    /// a temporary checkout that is gone once the app is installed, and
    /// development builds never ship the bundle.
    ///
    /// The bundled package carries its own `node_modules` and is the only
    /// directory granted, so the tool host cannot read the rest of the app.
    pub(crate) fn locate(channel: Channel, resources: Option<&Path>) -> Self {
        match (channel, resources) {
            (Channel::Release, Some(resources)) => {
                let package = resources.join(BUNDLED_SANDBOX_PACKAGE);
                Self {
                    runtime_roots: vec![package.clone()],
                    package,
                }
            }
            _ => Self::checkout(),
        }
    }

    /// The extension Pi loads.
    fn entry(&self) -> PathBuf {
        self.package.join("src/pi-extension.ts")
    }
}

/// Status key under which the sandbox extension reports whether a session's
/// tool host started. Pau consumes the record and never shows it.
const SANDBOX_STATUS_KEY: &str = "pau.sandbox";

/// How long a sandboxed start waits for the sandbox extension's report.
const SANDBOX_START_TIMEOUT: Duration = Duration::from_secs(30);

/// Matches a search returns when the request sets no limit.
const DEFAULT_SEARCH_MATCHES: usize = 50;

/// Most messages the history route returns. A long session keeps its newest
/// turns, and the response stays small enough to parse on every reconnect.
pub(crate) const MAX_SESSION_MESSAGES: usize = 2000;

/// What the API needs to describe a live session beyond its process.
#[derive(Clone)]
struct SessionRecord {
    agent: AgentKind,
    workspace_id: String,
    started_at: String,
    capabilities: AgentCapabilities,
    /// What Pi last reported about the session. Shared between clones so
    /// output forwarding describes the latest state.
    native: Arc<Mutex<NativeState>>,
    /// Pau-owned directory that holds a sandboxed session's policy and
    /// temporary files, removed when the process exits.
    sandbox_directory: Option<PathBuf>,
    /// Whether the session still waits for its sandbox to confirm. Until it
    /// does, its tools might run with full access, so [`SessionApi::live`]
    /// treats it as absent: it is not listed and refuses every control,
    /// including prompts.
    pending: bool,
}

/// The session state Pi owns, refreshed from `get_state`.
///
/// Pi reports it only on request, so the API reads it when the session starts
/// and after the controls that change it (model, thinking level, branch,
/// rename) instead of on every event.
#[derive(Clone, Default, PartialEq)]
struct NativeState {
    session_id: Option<String>,
    thinking_level: Option<SessionThinkingLevel>,
    /// Levels the current model supports, from `get_available_thinking_levels`.
    thinking_levels: Vec<SessionThinkingLevel>,
    name: Option<String>,
}

/// Starts agent sessions and publishes their lifecycle and output events.
#[derive(Clone)]
pub(crate) struct SessionApi {
    registry: Arc<PiSessionRegistry>,
    /// Pi discovery settings captured at startup. Each launch replaces the
    /// working directory with the workspace root.
    discovery: DiscoverPiOptions,
    /// Claude Code and bridge discovery settings captured at startup.
    claude_discovery: DiscoverClaudeOptions,
    /// Live Claude sessions. Pi sessions live in `registry`.
    claude: Arc<Mutex<HashMap<String, Arc<ClaudeSession>>>>,
    /// Sessions this API started. A record is inserted before its process
    /// starts, so output that races the start response still has a session to
    /// describe, and is removed when the process exits.
    records: Arc<Mutex<HashMap<String, SessionRecord>>>,
    /// Current extension UI per live session. See the module documentation.
    extension_ui: Arc<Mutex<HashMap<String, SessionExtensionUi>>>,
    events: EventHub,
    /// Records process starts and stops. See the `audit` module.
    audit: AuditLog,
    /// The last agent readiness report and when it was made. See `readiness`.
    readiness: Arc<tokio::sync::Mutex<Option<(std::time::Instant, AgentReadinessReport)>>>,
}

impl std::fmt::Debug for SessionApi {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("SessionApi").finish_non_exhaustive()
    }
}

impl SessionApi {
    /// Creates the service, starts forwarding registry output to `events`,
    /// and records process starts and stops in `audit`.
    ///
    /// Claude discovery searches the same `PATH` as `discovery`, and every
    /// agent process receives it.
    ///
    /// Must be called inside a Tokio runtime.
    pub(crate) fn new(
        registry: PiSessionRegistry,
        discovery: DiscoverPiOptions,
        events: EventHub,
        audit: AuditLog,
    ) -> Self {
        let api = Self {
            registry: Arc::new(registry),
            claude_discovery: DiscoverClaudeOptions {
                path: discovery.path.clone(),
                ..DiscoverClaudeOptions::default()
            },
            discovery,
            claude: Arc::default(),
            records: Arc::default(),
            extension_ui: Arc::default(),
            events,
            audit,
            readiness: Arc::default(),
        };
        tokio::spawn(api.clone().forward(api.registry.subscribe()));
        api
    }

    /// Forgets a session whose start failed, stops its process if it runs,
    /// and removes its sandbox directory. Clients never saw the session, so
    /// its exit is not published.
    async fn discard(&self, id: &str) {
        let record = self
            .records
            .lock()
            .expect("session records lock poisoned")
            .remove(id);
        let _ = self.registry.stop(id, diagnostic_timestamp()).await;
        if let Some(directory) = record.and_then(|record| record.sandbox_directory) {
            remove_sandbox_directory(&directory);
        }
    }

    /// Replaces the Claude discovery settings, which otherwise search the
    /// Pi discovery `PATH`.
    #[cfg(test)]
    pub(crate) fn with_claude_discovery(mut self, discovery: DiscoverClaudeOptions) -> Self {
        self.claude_discovery = discovery;
        self
    }

    /// Stops every live session at once through staged shutdown, and
    /// records each stop as Pau's.
    ///
    /// A session still stopping at `kill_at` is killed with its children,
    /// and so is one whose staged stop failed, so no agent process outlives
    /// shutdown.
    pub(crate) async fn stop_all(&self, kill_at: tokio::time::Instant) {
        let mut stopping = JoinSet::new();
        for id in self.claude_ids() {
            stopping.spawn(self.clone().stop_claude_at_shutdown(id, kill_at));
        }
        for id in self.registry.active_ids().await {
            stopping.spawn(self.clone().stop_pi_at_shutdown(id, kill_at));
        }
        stopping.join_all().await;
    }

    /// The agent process of each live session, for resource sampling.
    pub(crate) async fn usage_roots(&self) -> Vec<crate::process_usage::UsageRoot> {
        let root = |id: String, pid: u32| {
            self.record(&id)
                .map(|record| crate::process_usage::UsageRoot {
                    workspace_id: record.workspace_id,
                    agent: record.agent.id().to_owned(),
                    session_id: id,
                    pid,
                })
        };
        let mut roots: Vec<_> = self
            .claude_ids()
            .into_iter()
            .filter_map(|id| {
                let pid = self.claude_session(&id)?.process_id();
                root(id, pid)
            })
            .collect();
        for id in self.registry.active_ids().await {
            if let Some(session) = self.registry.get(&id).await {
                roots.extend(root(id, session.process_id()));
            }
        }
        roots
    }

    async fn stop_pi_at_shutdown(self, id: String, kill_at: tokio::time::Instant) {
        let Some(session) = self.registry.get(&id).await else {
            return;
        };
        let record = self.record(&id);
        let stopped = stop_or_kill(
            self.registry.stop(&id, diagnostic_timestamp()),
            kill_at,
            || session.kill(),
        )
        .await;
        self.audit.record(shutdown_stop(
            record,
            &id,
            stopped.as_ref().ok().copied().flatten(),
            stopped.is_ok(),
        ));
        if let Err(error) = stopped {
            session.kill();
            tracing::warn!(
                event = "session.stop_failed",
                session_id = %id,
                %error,
                "could not stop a Pi session during shutdown"
            );
        }
    }

    /// Pi's session storage for `root`, resolved without starting Pi.
    fn sessions_directory(&self, root: &std::path::Path) -> Result<std::path::PathBuf, ApiError> {
        let mut discovery = self.discovery.clone();
        discovery.working_directory = root.to_path_buf();
        pi_configuration_paths(&discovery)
            .map(|paths| paths.sessions_directory)
            .map_err(|error| ApiError::PiUnavailable(error.to_string()))
    }

    /// Pi's user-level keybindings file, resolved without starting Pi.
    fn keybindings_path(&self) -> Result<std::path::PathBuf, ApiError> {
        pi_configuration_paths(&self.discovery)
            .map(|paths| paths.keybindings)
            .map_err(|error| ApiError::PiUnavailable(error.to_string()))
    }

    fn record(&self, id: &str) -> Option<SessionRecord> {
        self.records
            .lock()
            .expect("session records lock poisoned")
            .get(id)
            .cloned()
    }

    async fn summary(&self, id: &str) -> Result<AgentSession, ApiError> {
        if let Some(summary) = self.claude_summary(id).await {
            return Ok(summary);
        }
        let (record, session) = self.live(id).await?;
        Ok(describe(
            id,
            &record,
            session_status(session.status().await),
        ))
    }

    /// Returns a live Pi session. A Claude session with this ID is refused as
    /// an unsupported control, since only Pi offers the routes that call this.
    async fn live(&self, id: &str) -> Result<(SessionRecord, Arc<PiSession>), ApiError> {
        if self.claude_session(id).is_some() {
            return Err(claude::unsupported());
        }
        let not_found = || ApiError::from(PiSessionRegistryError::NotFound(id.to_owned()));
        let record = self
            .record(id)
            .filter(|record| !record.pending)
            .ok_or_else(not_found)?;
        let session = self.registry.get(id).await.ok_or_else(not_found)?;
        Ok((record, session))
    }

    fn extension_ui(&self, id: &str) -> SessionExtensionUi {
        self.extension_ui
            .lock()
            .expect("extension UI lock poisoned")
            .get(id)
            .cloned()
            .unwrap_or_default()
    }

    /// Tells live clients a dialog no longer waits for an answer.
    fn publish_resolved(&self, workspace_id: &str, session_id: &str, request: &str, reason: &str) {
        self.events.publish(
            diagnostic_timestamp(),
            Some(workspace_id.to_owned()),
            Some(session_id.to_owned()),
            ServerEventKind::SessionOutput,
            serde_json::json!({"type": "extension_ui_resolved", "id": request, "reason": reason})
                .to_string(),
        );
    }

    /// Reads the session's usage in the background and publishes it.
    ///
    /// The read is a round trip to Pi, so it must not hold up output
    /// forwarding. A session that cannot report usage, or has already exited,
    /// publishes nothing.
    fn publish_usage(&self, workspace_id: String, session_id: String) {
        let api = self.clone();
        tokio::spawn(async move {
            let Ok((record, session)) = api.live(&session_id).await else {
                return;
            };
            if !record.capabilities.usage {
                return;
            }
            let Ok(usage) = session.usage().await else {
                return;
            };
            api.events.publish(
                diagnostic_timestamp(),
                Some(workspace_id),
                Some(session_id),
                ServerEventKind::SessionOutput,
                serde_json::json!({"type": "session_usage", "usage": session_usage(usage)})
                    .to_string(),
            );
        });
    }

    /// Tells clients that the operator interrupted a running turn, so the
    /// idle status that follows is not read as a finished turn.
    ///
    /// Callers publish it before they interrupt the agent, so it precedes
    /// every `session_changed` the interrupt causes, including one forwarded
    /// from the agent's own events.
    fn announce_interrupt(&self, session_id: &str, workspace_id: &str) {
        self.events.publish(
            diagnostic_timestamp(),
            Some(workspace_id.to_owned()),
            Some(session_id.to_owned()),
            ServerEventKind::SessionOutput,
            serde_json::json!({"type": "session_interrupted"}).to_string(),
        );
    }

    /// Drops every unanswered dialog of a session and announces each one.
    fn clear_dialogs(&self, session_id: &str, workspace_id: &str, reason: &str) {
        let cleared = self
            .extension_ui
            .lock()
            .expect("extension UI lock poisoned")
            .get_mut(session_id)
            .map(|state| std::mem::take(&mut state.dialogs))
            .unwrap_or_default();
        for dialog in cleared {
            self.publish_resolved(workspace_id, session_id, dialog.id(), reason);
        }
    }

    /// Removes one unanswered dialog, returning whether it was still waiting.
    fn take_dialog(&self, session_id: &str, request: &str) -> bool {
        let mut states = self
            .extension_ui
            .lock()
            .expect("extension UI lock poisoned");
        let Some(state) = states.get_mut(session_id) else {
            return false;
        };
        let before = state.dialogs.len();
        state.dialogs.retain(|dialog| dialog.id() != request);
        state.dialogs.len() != before
    }

    /// Applies a request from Pi to the session's current extension UI.
    fn apply_extension_request(&self, workspace_id: &str, session_id: &str, event: &Value) {
        let Ok(request) = PiExtensionUiRequest::try_from(event) else {
            return;
        };
        let mut timeout = None;
        {
            let mut states = self
                .extension_ui
                .lock()
                .expect("extension UI lock poisoned");
            let state = states.entry(session_id.to_owned()).or_default();
            match request {
                PiExtensionUiRequest::Select {
                    id,
                    title,
                    options,
                    timeout: ms,
                } => {
                    timeout = ms.map(|ms| (id.clone(), ms));
                    state.dialogs.push(ExtensionDialog::Select {
                        id,
                        title,
                        options,
                        timeout_ms: ms,
                    });
                }
                PiExtensionUiRequest::Confirm {
                    id,
                    title,
                    message,
                    timeout: ms,
                } => {
                    timeout = ms.map(|ms| (id.clone(), ms));
                    state.dialogs.push(ExtensionDialog::Confirm {
                        id,
                        title,
                        message,
                        timeout_ms: ms,
                    });
                }
                PiExtensionUiRequest::Input {
                    id,
                    title,
                    placeholder,
                    timeout: ms,
                } => {
                    timeout = ms.map(|ms| (id.clone(), ms));
                    state.dialogs.push(ExtensionDialog::Input {
                        id,
                        title,
                        placeholder,
                        timeout_ms: ms,
                    });
                }
                PiExtensionUiRequest::Editor { id, title, prefill } => {
                    state
                        .dialogs
                        .push(ExtensionDialog::Editor { id, title, prefill });
                }
                PiExtensionUiRequest::Status { key, text, .. } => {
                    state.statuses.retain(|status| status.key != key);
                    if let Some(text) = text {
                        state.statuses.push(ExtensionStatus { key, text });
                    }
                }
                PiExtensionUiRequest::Widget {
                    key,
                    lines,
                    placement,
                    ..
                } => {
                    state.widgets.retain(|widget| widget.key != key);
                    if let Some(lines) = lines {
                        state.widgets.push(ExtensionWidget {
                            key,
                            lines,
                            placement: match placement {
                                PiExtensionWidgetPlacement::AboveEditor => {
                                    ExtensionWidgetPlacement::AboveEditor
                                }
                                PiExtensionWidgetPlacement::BelowEditor => {
                                    ExtensionWidgetPlacement::BelowEditor
                                }
                            },
                        });
                    }
                }
                // Pi sends these without waiting for an answer.
                PiExtensionUiRequest::Unsupported { method, .. }
                    if matches!(method.as_str(), "setTitle" | "set_editor_text") => {}
                PiExtensionUiRequest::Unsupported { id, method } => {
                    state
                        .dialogs
                        .push(ExtensionDialog::Unsupported { id, method });
                }
                PiExtensionUiRequest::Notification { .. } => {}
            }
        }
        // Pi resolves a timed-out dialog itself and sends nothing, so the API
        // expires it on the same clock.
        if let Some((id, ms)) = timeout {
            let api = self.clone();
            let (workspace_id, session_id) = (workspace_id.to_owned(), session_id.to_owned());
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
                if api.take_dialog(&session_id, &id) {
                    api.publish_resolved(&workspace_id, &session_id, &id, "timed_out");
                }
            });
        }
    }

    /// Reads Pi's session identifier, thinking level, and name into the
    /// record and reports whether any changed. A failed read keeps the last values.
    async fn refresh_native(&self, record: &SessionRecord, session: &PiSession) -> bool {
        let Ok(state) = session.state().await else {
            return false;
        };
        let mut native = record.native.lock().expect("native state lock poisoned");
        let fresh = NativeState {
            session_id: state.native_id,
            thinking_level: state.thinking_level.map(session_thinking_level),
            thinking_levels: native.thinking_levels.clone(),
            name: state.name,
        };
        let changed = *native != fresh;
        *native = fresh;
        changed
    }

    /// Reads the thinking levels the current model supports into the record
    /// and reports whether they changed. A failed read keeps the last levels.
    ///
    /// Only the model decides the levels, so the API reads them when the
    /// session starts and after a model change rather than on every refresh.
    async fn refresh_thinking_levels(&self, record: &SessionRecord, session: &PiSession) -> bool {
        let Ok(levels) = session.thinking_levels().await else {
            return false;
        };
        let levels: Vec<_> = levels.into_iter().map(session_thinking_level).collect();
        let mut native = record.native.lock().expect("native state lock poisoned");
        let changed = native.thinking_levels != levels;
        native.thinking_levels = levels;
        changed
    }

    /// Refreshes the native state after a control that can change it and
    /// publishes the session when it did.
    async fn refresh_and_publish(&self, id: &str) {
        let Ok((record, session)) = self.live(id).await else {
            return;
        };
        if self.refresh_native(&record, &session).await {
            self.publish_current(id).await;
        }
    }

    fn publish(&self, session: &AgentSession) {
        self.events.publish(
            diagnostic_timestamp(),
            Some(session.workspace_id.clone()),
            Some(session.id.clone()),
            ServerEventKind::SessionChanged,
            serde_json::to_string(session).expect("sessions are serializable"),
        );
    }

    async fn publish_current(&self, id: &str) {
        if let Ok(session) = self.summary(id).await {
            self.publish(&session);
        }
    }

    /// Publishes native output and the lifecycle changes it implies.
    async fn forward(self, mut output: broadcast::Receiver<PiSessionOutput>) {
        loop {
            let tagged = match output.recv().await {
                Ok(tagged) => tagged,
                Err(broadcast::error::RecvError::Lagged(count)) => {
                    tracing::warn!(
                        event = "session.output_dropped",
                        count,
                        "dropped Pi session output"
                    );
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => return,
            };
            let Some(record) = self.record(&tagged.session_id) else {
                continue;
            };
            match tagged.output {
                // Pau's own record, which `start_session` consumes.
                PiProcessOutput::Event(event) if sandbox_status(&event).is_some() => {}
                PiProcessOutput::Event(event) => {
                    if event.get("type").and_then(Value::as_str) == Some("extension_ui_request") {
                        self.apply_extension_request(
                            &tagged.workspace_id,
                            &tagged.session_id,
                            &event,
                        );
                    }
                    self.events.publish(
                        diagnostic_timestamp(),
                        Some(tagged.workspace_id.clone()),
                        Some(tagged.session_id.clone()),
                        ServerEventKind::SessionOutput,
                        event.to_string(),
                    );
                    if reports_usage(&event) {
                        self.publish_usage(tagged.workspace_id, tagged.session_id.clone());
                    }
                    if let Some(status) = lifecycle_status(&event) {
                        self.publish(&describe(&tagged.session_id, &record, status));
                    }
                }
                // A session whose sandbox is unconfirmed stays unlisted.
                PiProcessOutput::NotResponding if record.pending => {}
                PiProcessOutput::NotResponding => {
                    self.publish(&describe(
                        &tagged.session_id,
                        &record,
                        SessionStatus::NotResponding,
                    ));
                }
                // Pi wrote again, so the session returns to the status its
                // events set. The record that showed it follows and publishes
                // any lifecycle change it carries.
                PiProcessOutput::Responding => self.publish_current(&tagged.session_id).await,
                // Stderr can contain anything Pi or its extensions print,
                // including secrets, so it stays out of the event stream.
                PiProcessOutput::Diagnostic(_) => {}
                PiProcessOutput::Exit(exit) => {
                    self.records
                        .lock()
                        .expect("session records lock poisoned")
                        .remove(&tagged.session_id);
                    if let Some(directory) = &record.sandbox_directory {
                        remove_sandbox_directory(directory);
                    }
                    self.clear_dialogs(&tagged.session_id, &tagged.workspace_id, "exited");
                    self.extension_ui
                        .lock()
                        .expect("extension UI lock poisoned")
                        .remove(&tagged.session_id);
                    let status = if exit.requested {
                        SessionStatus::Stopped
                    } else {
                        // A requested stop is recorded by whoever asked.
                        self.audit
                            .record(unrequested_stop(&tagged.session_id, &record, exit.code));
                        SessionStatus::Failed
                    };
                    let mut session = describe(&tagged.session_id, &record, status);
                    session.ended_at = Some(diagnostic_timestamp());
                    session.exit_code = exit.code;
                    self.publish(&session);
                }
            }
        }
    }
}

/// The record of a session process that exited without being asked to.
fn unrequested_stop(id: &str, record: &SessionRecord, exit_code: Option<i32>) -> AuditEntry {
    AuditEntry {
        workspace_id: Some(record.workspace_id.clone()),
        session_id: Some(id.to_owned()),
        target: Some(record.agent.id().to_owned()),
        exit_code,
        ..AuditEntry::new(
            AuditActor::Process,
            AuditOperation::SessionStop,
            AuditResult::Failed,
        )
    }
}

/// The record of a session Pau stopped while shutting down.
fn shutdown_stop(
    record: Option<SessionRecord>,
    id: &str,
    exit_code: Option<i32>,
    stopped: bool,
) -> AuditEntry {
    AuditEntry {
        workspace_id: record.as_ref().map(|record| record.workspace_id.clone()),
        session_id: Some(id.to_owned()),
        target: record.map(|record| record.agent.id().to_owned()),
        exit_code,
        ..AuditEntry::new(
            AuditActor::Pau,
            AuditOperation::SessionStop,
            if stopped {
                AuditResult::Succeeded
            } else {
                AuditResult::Failed
            },
        )
    }
}

/// The status Pi's run lifecycle events imply. This mirrors the transitions
/// [`PiSession`] applies, so a published state never waits on its observer.
fn lifecycle_status(event: &Value) -> Option<SessionStatus> {
    match event.get("type").and_then(Value::as_str) {
        Some("agent_start") => Some(SessionStatus::Running),
        Some("agent_settled") => Some(SessionStatus::Idle),
        _ => None,
    }
}

/// Whether the event is the end of an assistant message or run, the points
/// where Pi's usage totals change.
fn reports_usage(event: &Value) -> bool {
    match event.get("type").and_then(Value::as_str) {
        Some("agent_settled") => true,
        Some("message_end") => {
            event.pointer("/message/role").and_then(Value::as_str) == Some("assistant")
        }
        _ => false,
    }
}

fn session_usage(usage: PiSessionUsage) -> SessionUsage {
    SessionUsage {
        context: usage.context.map(|context| SessionContextUsage {
            tokens: context.tokens,
            context_window: context.context_window,
            percent: context.percent,
        }),
        tokens: SessionTokenUsage {
            input: usage.tokens.input,
            output: usage.tokens.output,
            cache_read: usage.tokens.cache_read,
            cache_write: usage.tokens.cache_write,
            total: usage.tokens.total,
        },
        cost: usage.cost,
    }
}

fn describe(id: &str, record: &SessionRecord, status: SessionStatus) -> AgentSession {
    let native = record
        .native
        .lock()
        .expect("native state lock poisoned")
        .clone();
    AgentSession {
        id: id.to_owned(),
        agent: record.agent.id().to_owned(),
        workspace_id: record.workspace_id.clone(),
        status,
        started_at: record.started_at.clone(),
        ended_at: None,
        exit_code: None,
        native_session_id: native.session_id,
        thinking_level: native.thinking_level,
        thinking_levels: native.thinking_levels,
        name: native.name,
        capabilities: session_capabilities(record.capabilities),
    }
}

fn session_status(status: AgentSessionStatus) -> SessionStatus {
    match status {
        AgentSessionStatus::Starting => SessionStatus::Starting,
        AgentSessionStatus::Idle => SessionStatus::Idle,
        AgentSessionStatus::Running => SessionStatus::Running,
        AgentSessionStatus::Waiting => SessionStatus::Waiting,
        AgentSessionStatus::NotResponding => SessionStatus::NotResponding,
        AgentSessionStatus::Stopping => SessionStatus::Stopping,
        AgentSessionStatus::Stopped => SessionStatus::Stopped,
        AgentSessionStatus::Failed => SessionStatus::Failed,
    }
}

fn session_capabilities(capabilities: AgentCapabilities) -> SessionCapabilities {
    SessionCapabilities {
        prompt: capabilities.prompt,
        follow_up: capabilities.follow_up,
        steer: capabilities.steer,
        interrupt: capabilities.interrupt,
        message_queue: capabilities.message_queue,
        model_selection: capabilities.model_selection,
        thinking_level: capabilities.thinking_level,
        command_discovery: capabilities.command_discovery,
        usage: capabilities.usage,
        compaction: capabilities.compaction,
        branching: capabilities.branching,
        retry: capabilities.retry,
        rename: capabilities.rename,
        clone_session: capabilities.clone_session,
        export_transcript: capabilities.export_transcript,
        shell_commands: capabilities.shell_commands,
        stop: capabilities.stop,
    }
}

fn message_queue(queue: AgentMessageQueue) -> SessionMessageQueue {
    SessionMessageQueue {
        steering: queue.steering,
        follow_up: queue.follow_up,
    }
}

fn session_command(command: PiCommand) -> SessionCommand {
    SessionCommand {
        name: command.name,
        description: command.description,
        source: match command.source {
            PiCommandSource::Extension => SessionCommandSource::Extension,
            PiCommandSource::Prompt => SessionCommandSource::Prompt,
            PiCommandSource::Skill => SessionCommandSource::Skill,
        },
        path: command.path,
    }
}

fn session_model(model: PiModel) -> SessionModel {
    SessionModel {
        provider: model.provider,
        id: model.id,
        name: model.name,
        reasoning: model.reasoning,
        current: model.current,
    }
}

fn session_thinking_level(level: ThinkingLevel) -> SessionThinkingLevel {
    match level {
        ThinkingLevel::Off => SessionThinkingLevel::Off,
        ThinkingLevel::Minimal => SessionThinkingLevel::Minimal,
        ThinkingLevel::Low => SessionThinkingLevel::Low,
        ThinkingLevel::Medium => SessionThinkingLevel::Medium,
        ThinkingLevel::High => SessionThinkingLevel::High,
        ThinkingLevel::ExtraHigh => SessionThinkingLevel::ExtraHigh,
        ThinkingLevel::Max => SessionThinkingLevel::Max,
    }
}

fn thinking_level(level: SessionThinkingLevel) -> ThinkingLevel {
    match level {
        SessionThinkingLevel::Off => ThinkingLevel::Off,
        SessionThinkingLevel::Minimal => ThinkingLevel::Minimal,
        SessionThinkingLevel::Low => ThinkingLevel::Low,
        SessionThinkingLevel::Medium => ThinkingLevel::Medium,
        SessionThinkingLevel::High => ThinkingLevel::High,
        SessionThinkingLevel::ExtraHigh => ThinkingLevel::ExtraHigh,
        SessionThinkingLevel::Max => ThinkingLevel::Max,
    }
}

/// HTTP status, stable code and message for a session failure.
///
/// Controls distinguish three caller-visible cases: the agent cannot perform
/// the control at all (`unsupported_control`), the session is in the wrong
/// state (`invalid_session_state`), and the agent refused the request
/// (`control_rejected`). A process that exits before it answers is
/// `session_exited`, and one that stops answering while it runs is
/// `agent_not_responding`.
///
/// A failed transcript write gets fixed text rather than the I/O error's,
/// which can name the temporary file and its folder.
pub(crate) fn error_response(error: &PiSessionRegistryError) -> (StatusCode, &'static str, String) {
    if let PiSessionRegistryError::Session(PiSessionError::Export(error)) = error {
        let (status, code, message) = match error.kind() {
            std::io::ErrorKind::InvalidInput => {
                return (
                    StatusCode::BAD_REQUEST,
                    "invalid_destination",
                    error.to_string(),
                );
            }
            std::io::ErrorKind::PermissionDenied => (
                StatusCode::FORBIDDEN,
                "permission_denied",
                "Pau may not write to that folder",
            ),
            std::io::ErrorKind::ReadOnlyFilesystem => {
                (StatusCode::FORBIDDEN, "read_only", "the disk is read-only")
            }
            std::io::ErrorKind::StorageFull => (
                StatusCode::INSUFFICIENT_STORAGE,
                "storage_full",
                "the disk is full",
            ),
            std::io::ErrorKind::TimedOut => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "export_failed",
                "Pi did not finish the export in time",
            ),
            _ => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "export_failed",
                "the file could not be written",
            ),
        };
        return (status, code, message.to_owned());
    }
    let (status, code) = match error {
        PiSessionRegistryError::InvalidId => (StatusCode::BAD_REQUEST, "invalid_session_id"),
        PiSessionRegistryError::AlreadyExists(_) => (StatusCode::CONFLICT, "session_exists"),
        PiSessionRegistryError::NotFound(_) => (StatusCode::NOT_FOUND, "not_found"),
        PiSessionRegistryError::Persistence(_) => {
            (StatusCode::INTERNAL_SERVER_ERROR, "internal_error")
        }
        PiSessionRegistryError::Session(error) => match error {
            PiSessionError::Control(AgentControlError::Unsupported { .. }) => {
                (StatusCode::NOT_IMPLEMENTED, "unsupported_control")
            }
            PiSessionError::Control(AgentControlError::InvalidState { .. }) => {
                (StatusCode::CONFLICT, "invalid_session_state")
            }
            PiSessionError::Control(AgentControlError::Rejected { .. }) => {
                (StatusCode::UNPROCESSABLE_ENTITY, "control_rejected")
            }
            PiSessionError::NativeSession(_) => (StatusCode::BAD_GATEWAY, "invalid_agent_response"),
            PiSessionError::Process(PiProcessError::Exited(_) | PiProcessError::Write(_)) => {
                (StatusCode::GONE, "session_exited")
            }
            PiSessionError::Process(PiProcessError::Start(_)) => {
                (StatusCode::SERVICE_UNAVAILABLE, "pi_unavailable")
            }
            PiSessionError::Process(PiProcessError::NotResponding { .. }) => {
                (StatusCode::GATEWAY_TIMEOUT, "agent_not_responding")
            }
            PiSessionError::Process(_) | PiSessionError::Export(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "internal_error")
            }
        },
    };
    (status, code, error.to_string())
}

fn session_api(state: &ApiState) -> Result<&SessionApi, ApiError> {
    state.sessions.as_ref().ok_or(ApiError::ServiceUnavailable)
}

/// Pi's effective key bindings: its defaults under the operator's overrides.
pub(crate) async fn get_pi_keybindings(
    State(state): State<ApiState>,
) -> Result<Json<AgentKeybindings>, ApiError> {
    let path = session_api(&state)?.keybindings_path()?;
    let keybindings = tokio::task::spawn_blocking(move || read_pi_keybindings(&path))
        .await
        .map_err(|error| ApiError::PiUnavailable(error.to_string()))?;
    for warning in &keybindings.warnings {
        tracing::warn!(
            event = "pi.keybindings_ignored",
            path = %warning.path,
            message = %warning.message,
            "ignored part of Pi's keybindings file"
        );
    }
    Ok(Json(AgentKeybindings {
        bindings: keybindings
            .bindings
            .into_iter()
            .map(|binding| AgentKeybinding {
                action: binding.action,
                keys: binding.keys,
                default_keys: binding.default_keys,
                source: match binding.source {
                    PiKeybindingSource::Default => AgentKeybindingSource::Default,
                    PiKeybindingSource::User => AgentKeybindingSource::User,
                },
            })
            .collect(),
        warnings: keybindings
            .warnings
            .into_iter()
            .map(|warning| AgentKeybindingWarning {
                path: warning.path,
                message: warning.message,
            })
            .collect(),
    }))
}

/// Lists live sessions, oldest first.
pub(crate) async fn list_sessions(
    State(state): State<ApiState>,
) -> Result<Json<Vec<AgentSession>>, ApiError> {
    let api = session_api(&state)?;
    let mut sessions = Vec::new();
    for id in api
        .registry
        .active_ids()
        .await
        .into_iter()
        .chain(api.claude_ids())
    {
        if let Ok(session) = api.summary(&id).await {
            sessions.push(session);
        }
    }
    sessions.sort_by(|left, right| left.started_at.cmp(&right.started_at));
    Ok(Json(sessions))
}

/// Lists the sessions Pi stored on disk for a workspace, newest first.
///
/// Unreadable and malformed files are reported as warnings so one bad file
/// never hides the others.
pub(crate) async fn list_native_sessions(
    State(state): State<ApiState>,
    AxumPath(workspace_id): AxumPath<String>,
) -> Result<Json<NativeSessionList>, ApiError> {
    let api = session_api(&state)?;
    let root = workspace_service(&state)?.root(&workspace_id).await?;
    let sessions_directory = api.sessions_directory(&root)?;
    let files =
        tokio::task::spawn_blocking(move || list_pi_session_files(&sessions_directory, &root))
            .await
            .map_err(|error| ApiError::PiUnavailable(error.to_string()))?;
    for warning in &files.warnings {
        tracing::warn!(
            event = "session.native_file_skipped",
            path = %warning.path.display(),
            message = %warning.message,
            "skipped a Pi session file"
        );
    }
    Ok(Json(NativeSessionList {
        sessions: files
            .sessions
            .into_iter()
            .map(|session| NativeSessionSummary {
                id: session.id,
                name: session.name,
                first_message: session.first_message,
                created_at: session.created_at,
                modified_at: session
                    .modified_at
                    .and_then(|time| OffsetDateTime::from(time).format(&Rfc3339).ok()),
                path: session.path.to_string_lossy().into_owned(),
            })
            .collect(),
        warnings: files
            .warnings
            .into_iter()
            .map(|warning| NativeSessionWarning {
                path: warning.path.to_string_lossy().into_owned(),
                message: warning.message,
            })
            .collect(),
    }))
}

/// Starts a session of the requested agent in a registered workspace,
/// resuming a stored native session when the request names one.
///
/// When the workspace selects a sandbox, Pi starts with the sandbox extension
/// and the start returns only after the extension reports that its tool host
/// runs inside the sandbox. A sandbox that cannot start stops Pi and answers
/// `503 sandbox_unavailable` with the reason. A sandboxed Claude session is
/// `501 sandboxed_session_unsupported`.
///
/// An unknown agent is `400 unknown_agent`. A missing or unsupported Pi is
/// `503 pi_unavailable`, and any other agent that cannot start is
/// `503 agent_unavailable`, each with discovery's corrective message. Once
/// shutdown begins, a start is `503 shutting_down`, as [`crate::StartGate`]
/// describes.
pub(crate) async fn start_session(
    State(state): State<ApiState>,
    Json(request): Json<StartSessionRequest>,
) -> Result<(StatusCode, Json<AgentSession>), ApiError> {
    let mut audit = Some(PendingAudit::operator(
        &state.audit,
        AuditOperation::SessionStart,
        Some(request.workspace_id.clone()),
        Some(
            request
                .agent
                .clone()
                .unwrap_or_else(|| AgentKind::Pi.id().to_owned()),
        ),
    ));
    let result = state
        .starts
        .run(start_agent_session(&state, request, &mut audit))
        .await;
    if let Some(audit) = audit {
        finish_start_audit(audit, &result);
    }
    result
}

/// Records a session start's result, naming the session it started.
fn finish_start_audit(
    mut audit: PendingAudit,
    result: &Result<(StatusCode, Json<AgentSession>), ApiError>,
) {
    if let Ok((_, Json(session))) = result {
        audit.session(session.id.clone());
    }
    audit.finish(result);
}

/// Starts the session `request` asks for. A Pi launch takes `audit` and
/// records its own result, since it outlives a cancelled request.
async fn start_agent_session(
    state: &ApiState,
    request: StartSessionRequest,
    audit: &mut Option<PendingAudit>,
) -> Result<(StatusCode, Json<AgentSession>), ApiError> {
    let api = session_api(state)?;
    let agent = match request.agent.as_deref() {
        None => AgentKind::Pi,
        Some(id) => AgentKind::from_id(id).ok_or_else(|| unknown_agent(id))?,
    };
    let root = workspace_service(state)?
        .root(&request.workspace_id)
        .await?;
    let sandbox = match &state.sandbox {
        Some(sandbox) => sandbox
            .selections
            .get(&request.workspace_id, None)
            .await
            .map_err(|error| ApiError::from(pau_core::workspace::WorkspaceError::from(error)))?
            .effective()
            .settings()
            .map(|settings| (sandbox.clone(), settings.clone())),
        None => None,
    };
    if agent == AgentKind::Claude {
        // Refusing keeps a sandboxed workspace from running Claude's tools
        // with full access.
        if sandbox.is_some() {
            return Err(ApiError::SandboxedSessionUnsupported);
        }
        let summary = api.start_claude(request, root).await?;
        return Ok((StatusCode::CREATED, Json(summary)));
    }

    // Resolve the stored session before launching Pi. Only the workspace's own
    // session files can match.
    let mut arguments = Vec::new();
    if let Some(native_id) = &request.native_session_id {
        let sessions_directory = api.sessions_directory(&root)?;
        let (lookup_root, lookup_id) = (root.clone(), native_id.clone());
        let file = tokio::task::spawn_blocking(move || {
            find_pi_session_file(&sessions_directory, &lookup_root, &lookup_id)
        })
        .await
        .map_err(|error| ApiError::PiUnavailable(error.to_string()))?
        .map_err(ApiError::NativeSession)?;
        arguments.push("--session".into());
        arguments.push(file.into_os_string());
    }

    let mut discovery = api.discovery.clone();
    discovery.working_directory = root.clone();
    let pi = tokio::task::spawn_blocking(move || discover_pi(&discovery))
        .await
        .map_err(|error| ApiError::PiUnavailable(error.to_string()))?
        .map_err(|error| ApiError::PiUnavailable(error.to_string()))?;

    // The launch runs in its own task, so a client that cancels the request
    // cannot leave a started session behind whose sandbox nobody confirmed.
    // The task confirms the sandbox, or stops Pi and discards the session.
    // It passes the start gate itself and owns the audit record, so shutdown
    // waits for it and its result is recorded even after a cancellation.
    let api = api.clone();
    let starts = state.starts.clone();
    let audit = audit.take();
    tokio::spawn(async move {
        let result = starts
            .run(launch_pi(api, pi, root, arguments, sandbox, request))
            .await;
        if let Some(audit) = audit {
            finish_start_audit(audit, &result);
        }
        result
    })
    .await
    .map_err(|error| ApiError::PiUnavailable(error.to_string()))?
}

/// Launches Pi for `request`, confirms its sandbox when it has one, and
/// publishes the new session. A launch that fails discards the session.
async fn launch_pi(
    api: SessionApi,
    pi: PiDiscovery,
    root: PathBuf,
    arguments: Vec<OsString>,
    sandbox: Option<(SandboxApi, SandboxSettings)>,
    request: StartSessionRequest,
) -> Result<(StatusCode, Json<AgentSession>), ApiError> {
    let id = uuid::Uuid::new_v4().to_string();
    let mut process = pi.process_options(root.clone(), arguments);
    let mut sandbox_placeholders = Vec::new();
    let mut sandbox_directory = None;
    if let Some((sandbox, settings)) = sandbox {
        let prepare = PiSandboxRequest {
            sandbox,
            settings,
            workspace: root,
            id: id.clone(),
            agent_directory: pi.configuration.agent_directory.clone(),
        };
        // The directory guard removes the directory when preparing fails
        // or panics.
        let (directory, launch) = tokio::task::spawn_blocking(move || prepare.prepare())
            .await
            .map_err(|error| ApiError::SandboxUnavailable(error.to_string()))??;
        launch.apply(&mut process);
        sandbox_placeholders = launch.placeholders;
        sandbox_directory = Some(directory.keep());
    }
    let record = SessionRecord {
        agent: AgentKind::Pi,
        workspace_id: request.workspace_id.clone(),
        started_at: diagnostic_timestamp(),
        capabilities: pau_pi::PI_RPC_CAPABILITIES,
        native: Arc::default(),
        pending: sandbox_directory.is_some(),
        sandbox_directory,
    };
    api.records
        .lock()
        .expect("session records lock poisoned")
        .insert(id.clone(), record.clone());
    // The session's own output, subscribed before Pi starts, so the
    // sandbox report can be neither missed nor crowded out by other
    // sessions' output.
    let started = api
        .registry
        .start_subscribed(StartRegisteredPiSession {
            id: id.clone(),
            workspace_id: request.workspace_id,
            started_at: record.started_at.clone(),
            process,
            sandbox_placeholders,
        })
        .await;
    let (session, mut output) = match started {
        Ok(started) => started,
        Err(error) => {
            api.discard(&id).await;
            return Err(error.into());
        }
    };
    if record.pending {
        if let Err(reason) = sandbox_started(&mut output).await {
            api.discard(&id).await;
            return Err(ApiError::SandboxUnavailable(format!(
                "The sandbox could not start: {}.",
                reason.trim_end_matches('.')
            )));
        }
        if let Some(record) = api
            .records
            .lock()
            .expect("session records lock poisoned")
            .get_mut(&id)
        {
            record.pending = false;
        }
    }
    drop(output);
    if let Some(SessionModelSelection { provider, model_id }) = request.model
        && let Err(error) = session.select_model(provider, model_id).await
    {
        api.discard(&id).await;
        return Err(error.into());
    }

    api.refresh_native(&record, &session).await;
    api.refresh_thinking_levels(&record, &session).await;
    let summary = describe(&id, &record, session_status(session.status().await));
    api.publish(&summary);
    Ok((StatusCode::CREATED, Json(summary)))
}

/// A new per-session sandbox directory, removed when the guard drops unless
/// [`SessionDirectory::keep`] hands it to the session record.
struct SessionDirectory(Option<PathBuf>);

impl SessionDirectory {
    /// Creates the directory for session `id` under `parent`, readable only
    /// by the current user.
    ///
    /// The name is a prefix of `id`, short so MCP relay sockets fit the Unix
    /// socket path limit. Creation is exclusive: when another session holds
    /// the name, a longer prefix is tried, so a session never reuses, and
    /// later removes, another session's directory.
    fn create(parent: &Path, id: &str) -> std::io::Result<Self> {
        fs::create_dir_all(parent)?;
        let mut length = 8.min(id.len());
        loop {
            let path = parent.join(&id[..length]);
            match fs::DirBuilder::new().mode(0o700).create(&path) {
                Ok(()) => return Ok(Self(Some(path))),
                Err(error)
                    if error.kind() == std::io::ErrorKind::AlreadyExists && length < id.len() =>
                {
                    length = (length + 4).min(id.len());
                }
                Err(error) => return Err(error),
            }
        }
    }

    fn path(&self) -> &Path {
        self.0.as_deref().expect("directory is kept only once")
    }

    /// Keeps the directory and returns its path. The session record now owns
    /// its removal.
    fn keep(mut self) -> PathBuf {
        self.0.take().expect("directory is kept only once")
    }
}

impl Drop for SessionDirectory {
    fn drop(&mut self) {
        if let Some(path) = &self.0 {
            remove_sandbox_directory(path);
        }
    }
}

/// One sandboxed Pi launch to prepare.
struct PiSandboxRequest {
    sandbox: SandboxApi,
    settings: SandboxSettings,
    workspace: PathBuf,
    /// Session ID, which names the session's sandbox directory.
    id: String,
    /// Pi's agent directory, whose settings say whether pi-mcp-adapter runs.
    agent_directory: PathBuf,
}

impl PiSandboxRequest {
    /// Creates the session's directory, then resolves the policy and writes
    /// the policy file and session MCP configuration into it. Blocks on the
    /// filesystem.
    fn prepare(self) -> Result<(SessionDirectory, PiSandboxLaunch), ApiError> {
        let executables = self
            .sandbox
            .executables
            .as_ref()
            .map_err(|error| ApiError::SandboxUnavailable(error.clone()))?;
        let extension = self.sandbox.extension.entry();
        if !extension.is_file() {
            return Err(ApiError::SandboxUnavailable(format!(
                "This build of Pau cannot find its sandbox extension at {}. Turn off the sandbox for this workspace to start a session.",
                extension.display()
            )));
        }
        let mut runtime_roots = self.sandbox.extension.runtime_roots.clone();
        runtime_roots.extend(node_directory(OsStr::new(&self.sandbox.tool_path)));
        runtime_roots.extend(denial_preload_library());
        // pi-mcp-adapter would start every server in the Pi process, outside
        // the sandbox, unless Pi gets a session configuration of contained
        // servers in exclusive mode.
        let mcp = discover_pi_mcp(&DiscoverPiMcpOptions {
            home_directory: self.sandbox.home.clone(),
            agent_directory: self.agent_directory,
            workspace: self.workspace.clone(),
        })
        .map_err(|error| {
            ApiError::SandboxUnavailable(format!(
                "Pau could not read Pi's MCP configuration, so it cannot keep MCP servers inside the sandbox: {error}"
            ))
        })?;
        // Whenever Pi loads the adapter, from a settings package or not, it
        // gets the session configuration, empty when no server is contained.
        // Without the adapter, Pi rejects the configuration's flag and exits.
        let adapter_loads = mcp.adapter.state == PiMcpAdapterState::Ready || mcp.adapter_extension;
        let mcp_servers = adapter_loads.then_some(mcp.configuration.servers);
        let directory =
            SessionDirectory::create(&self.sandbox.sessions, &self.id).map_err(|error| {
                ApiError::SandboxUnavailable(format!(
                    "Pau could not create the session's sandbox directory: {error}"
                ))
            })?;
        let launch = prepare_pi_sandbox(&PreparePiSandbox {
            settings: &self.settings,
            workspace: &self.workspace,
            home: &self.sandbox.home,
            session_directory: directory.path(),
            executables,
            extension: &extension,
            runtime_roots: &runtime_roots,
            tool_path: &self.sandbox.tool_path,
            credential_environment: &credential_environment(&self.settings),
            mcp_servers: mcp_servers.as_deref(),
        })
        .map_err(|error| match error {
            SandboxError::Invalid(message) => ApiError::InvalidSandbox(message),
            other => ApiError::SandboxUnavailable(other.to_string()),
        })?;
        Ok((directory, launch))
    }
}

/// On Linux, the denial preload library the tool host loads into each tool,
/// found the way the sandbox package finds it: `PAU_SANDBOX_DENIAL_PRELOAD`,
/// or the checkout's build for `PAU_SANDBOX_PRELOAD_PROFILE`.
fn denial_preload_library() -> Option<PathBuf> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    std::env::var_os("PAU_SANDBOX_DENIAL_PRELOAD")
        .map(PathBuf::from)
        .or_else(|| {
            let profile = match std::env::var("PAU_SANDBOX_PRELOAD_PROFILE").as_deref() {
                Ok("release") => "release",
                _ => "debug",
            };
            Some(
                Path::new(SANDBOX_PACKAGE)
                    .join("../../target")
                    .join(profile)
                    .join("libpau_sandbox_denial_preload.so"),
            )
        })
}

/// The directory of the first `node` on `path`, after following links.
fn node_directory(path: &OsStr) -> Option<PathBuf> {
    pau_agent::absolute_path_entries(path)
        .map(|directory| directory.join("node"))
        .find(|candidate| candidate.is_file())
        .and_then(|node| fs::canonicalize(node).ok())
        .and_then(|node| node.parent().map(Path::to_path_buf))
}

/// What the sandbox extension reports once a session's tool host started
/// or failed to start, as the text of its [`SANDBOX_STATUS_KEY`] status.
#[derive(Deserialize)]
#[serde(tag = "state", rename_all = "lowercase")]
enum SandboxReadiness {
    Ready,
    Unavailable { message: String },
}

/// The text of a sandbox extension status record, if `event` is one.
fn sandbox_status(event: &Value) -> Option<&str> {
    (event.get("type")?.as_str()? == "extension_ui_request"
        && event.get("method")?.as_str()? == "setStatus"
        && event.get("statusKey")?.as_str()? == SANDBOX_STATUS_KEY)
        .then(|| {
            event
                .get("statusText")
                .and_then(Value::as_str)
                .unwrap_or("")
        })
}

/// Waits for the sandbox extension to report, on its session's own `output`,
/// whether the session's tool host runs inside the sandbox, and returns why
/// not.
///
/// Pi keeps running when an extension fails to load, and its built-in tools
/// would then run with full access, so a session that never reports fails
/// too.
async fn sandbox_started(output: &mut broadcast::Receiver<PiProcessOutput>) -> Result<(), String> {
    let report = async {
        loop {
            let output = match output.recv().await {
                Ok(output) => output,
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => {
                    return Err("Pau stopped before the sandbox started".to_owned());
                }
            };
            match output {
                PiProcessOutput::Event(event) => {
                    let Some(text) = sandbox_status(&event) else {
                        continue;
                    };
                    return match serde_json::from_str(text) {
                        Ok(SandboxReadiness::Ready) => Ok(()),
                        Ok(SandboxReadiness::Unavailable { message }) => Err(message),
                        Err(_) => {
                            Err("the sandbox extension sent a report Pau cannot read".to_owned())
                        }
                    };
                }
                PiProcessOutput::Exit(_) => {
                    return Err("Pi exited before the sandbox started".to_owned());
                }
                PiProcessOutput::Diagnostic(_)
                | PiProcessOutput::NotResponding
                | PiProcessOutput::Responding => {}
            }
        }
    };
    tokio::time::timeout(SANDBOX_START_TIMEOUT, report).await.unwrap_or_else(|_| {
        Err(format!(
            "Pi did not confirm the sandbox within {} seconds. Check that Pi can load Pau's sandbox extension.",
            SANDBOX_START_TIMEOUT.as_secs()
        ))
    })
}

/// Removes a sandboxed session's directory. A failure leaves only Pau's own
/// files behind, so it is logged rather than reported.
fn remove_sandbox_directory(directory: &Path) {
    if let Err(error) = fs::remove_dir_all(directory)
        && error.kind() != std::io::ErrorKind::NotFound
    {
        tracing::warn!(
            event = "session.sandbox_cleanup_failed",
            path = %directory.display(),
            %error,
            "could not remove a sandboxed session's directory"
        );
    }
}

/// The refusal of a start request that names an agent Pau does not support.
fn unknown_agent(id: &str) -> ApiError {
    let supported = AgentKind::ALL.map(AgentKind::id).join(", ");
    ApiError::Agent(
        StatusCode::BAD_REQUEST,
        "unknown_agent",
        format!("Pau does not support the agent `{id}`. Choose one of: {supported}."),
    )
}

/// Returns one live session.
pub(crate) async fn get_session(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<Json<AgentSession>, ApiError> {
    session_api(&state)?.summary(&session_id).await.map(Json)
}

/// Stops a session. Its final state arrives as a `session_changed` event.
pub(crate) async fn stop_session(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<StatusCode, ApiError> {
    let mut audit = PendingAudit::operator(&state.audit, AuditOperation::SessionStop, None, None);
    audit.session(session_id.clone());
    let stopped = async {
        let api = session_api(&state)?;
        if let Some(record) = api.record(&session_id) {
            audit.workspace(record.workspace_id);
            audit.target(record.agent.id());
        }
        if let Some(session) = api.claude_session(&session_id) {
            return session
                .stop()
                .await
                .map(|exit| exit.code)
                .map_err(claude::session_error);
        }
        api.live(&session_id).await?;
        Ok(api
            .registry
            .stop(&session_id, diagnostic_timestamp())
            .await?)
    }
    .await;
    let exit_code = stopped.as_ref().ok().copied().flatten();
    let result = stopped.map(|_| StatusCode::NO_CONTENT);
    audit.finish_with_exit(&result, exit_code);
    result
}

/// Largest decoded size of one prompt image.
const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
/// Largest combined decoded size of the images in one request.
const MAX_REQUEST_IMAGE_BYTES: usize = 10 * 1024 * 1024;
/// Request body limit for routes that accept images. Base64 inflates the
/// request cap by a third, and the rest covers the message and JSON framing.
pub(crate) const IMAGE_BODY_LIMIT: usize = 16 * 1024 * 1024;
/// MIME types Pi forwards to models.
const IMAGE_MIME_TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/// Validates prompt images and converts them for Pi.
///
/// Every failure is `422` with one of `unsupported_image_type`,
/// `invalid_image_data`, `image_too_large`, `request_images_too_large`, or
/// `image_input_unsupported`. Pi does not check the model's image support, so
/// the current model is checked here.
async fn prepare_images(
    session: &PiSession,
    images: Option<Vec<SessionImage>>,
) -> Result<Vec<PiImage>, ApiError> {
    let images = images.unwrap_or_default();
    if images.is_empty() {
        return Ok(Vec::new());
    }
    let mut total = 0;
    for (index, image) in images.iter().enumerate() {
        let number = index + 1;
        if !IMAGE_MIME_TYPES.contains(&image.mime_type.as_str()) {
            return Err(ApiError::InvalidImage(
                "unsupported_image_type",
                format!(
                    "Image {number} is {}. Attach a PNG, JPEG, GIF, or WebP image.",
                    image.mime_type
                ),
            ));
        }
        let size = BASE64
            .decode(&image.data)
            .map_err(|_| {
                ApiError::InvalidImage(
                    "invalid_image_data",
                    format!("Image {number} is not valid base64."),
                )
            })?
            .len();
        if size > MAX_IMAGE_BYTES {
            return Err(ApiError::InvalidImage(
                "image_too_large",
                format!("Image {number} is larger than 5 MiB."),
            ));
        }
        total += size;
    }
    if total > MAX_REQUEST_IMAGE_BYTES {
        return Err(ApiError::InvalidImage(
            "request_images_too_large",
            "Attached images total more than 10 MiB.".to_owned(),
        ));
    }
    let accepts_images = session
        .models()
        .await?
        .iter()
        .any(|model| model.current && model.image_input);
    if !accepts_images {
        return Err(ApiError::InvalidImage(
            "image_input_unsupported",
            "The selected model does not accept images. Choose a model with image input."
                .to_owned(),
        ));
    }
    Ok(images
        .into_iter()
        .map(|image| PiImage {
            mime_type: image.mime_type,
            data: image.data,
        })
        .collect())
}

/// Starts work, or queues it during a run when the request names a queue.
pub(crate) async fn prompt_session(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<SessionPromptRequest>,
) -> Result<StatusCode, ApiError> {
    let api = session_api(&state)?;
    if let Some(session) = api.claude_session(&session_id) {
        claude::prompt(&session, request).await?;
        api.publish_current(&session_id).await;
        return Ok(StatusCode::ACCEPTED);
    }
    let (_, session) = api.live(&session_id).await?;
    let queue = request.queue.map(|queue| match queue {
        SessionQueue::Steer => PromptQueueChoice::Steer,
        SessionQueue::FollowUp => PromptQueueChoice::FollowUp,
    });
    let images = prepare_images(&session, request.images).await?;
    session.prompt(request.message, images, queue).await?;
    api.publish_current(&session_id).await;
    Ok(StatusCode::ACCEPTED)
}

/// Queues an instruction after the current assistant turn.
pub(crate) async fn steer_session(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<SessionMessageRequest>,
) -> Result<StatusCode, ApiError> {
    let (_, session) = session_api(&state)?.live(&session_id).await?;
    let images = prepare_images(&session, request.images).await?;
    session.steer(request.message, images).await?;
    Ok(StatusCode::ACCEPTED)
}

/// Queues work to run after the current work finishes.
pub(crate) async fn follow_up_session(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<SessionMessageRequest>,
) -> Result<StatusCode, ApiError> {
    let (_, session) = session_api(&state)?.live(&session_id).await?;
    let images = prepare_images(&session, request.images).await?;
    session.follow_up(request.message, images).await?;
    Ok(StatusCode::ACCEPTED)
}

/// Aborts the active run, leaves the session ready for another prompt, and
/// returns the queued messages the interrupt removed so the client can restore
/// their text.
pub(crate) async fn interrupt_session(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<Json<SessionMessageQueue>, ApiError> {
    let api = session_api(&state)?;
    if let Some(session) = api.claude_session(&session_id) {
        if session.status().await == AgentSessionStatus::Running
            && let Some(record) = api.record(&session_id)
        {
            api.announce_interrupt(&session_id, &record.workspace_id);
        }
        // The bridge has no message queues, so an interrupt clears nothing.
        session.interrupt().await.map_err(claude::session_error)?;
        api.publish_current(&session_id).await;
        return Ok(Json(SessionMessageQueue::default()));
    }
    let (record, session) = api.live(&session_id).await?;
    if session.status().await == AgentSessionStatus::Running {
        api.announce_interrupt(&session_id, &record.workspace_id);
    }
    let cleared = session.interrupt().await?;
    api.clear_dialogs(&session_id, &record.workspace_id, "interrupted");
    api.publish_current(&session_id).await;
    Ok(Json(message_queue(cleared)))
}

/// Selects a model and returns Pi's native record for it.
pub(crate) async fn select_session_model(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<SessionModelSelection>,
) -> Result<Json<Value>, ApiError> {
    let api = session_api(&state)?;
    let (record, session) = api.live(&session_id).await?;
    let model = session
        .select_model(request.provider, request.model_id)
        .await?;
    // The new model can offer different levels, and Pi clamps the thinking
    // level to what it supports.
    let levels_changed = api.refresh_thinking_levels(&record, &session).await;
    if api.refresh_native(&record, &session).await || levels_changed {
        api.publish_current(&session_id).await;
    }
    Ok(Json(model))
}

/// Selects the thinking level for later model turns.
pub(crate) async fn set_session_thinking_level(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<SessionThinkingLevelRequest>,
) -> Result<StatusCode, ApiError> {
    let api = session_api(&state)?;
    let (_, session) = api.live(&session_id).await?;
    session
        .set_thinking_level(thinking_level(request.level))
        .await?;
    api.refresh_and_publish(&session_id).await;
    Ok(StatusCode::NO_CONTENT)
}

/// Returns the messages waiting in the steer and follow-up queues.
pub(crate) async fn get_session_queue(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<Json<SessionMessageQueue>, ApiError> {
    let (_, session) = session_api(&state)?.live(&session_id).await?;
    Ok(Json(message_queue(session.message_queue().await?)))
}

/// Empties both queues and returns the messages they held.
pub(crate) async fn clear_session_queue(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<Json<SessionMessageQueue>, ApiError> {
    let (_, session) = session_api(&state)?.live(&session_id).await?;
    Ok(Json(message_queue(session.clear_message_queue().await?)))
}

/// Summarizes older context and returns the summary Pi wrote.
pub(crate) async fn compact_session(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<SessionCompactRequest>,
) -> Result<Json<SessionCompactionResult>, ApiError> {
    let api = session_api(&state)?;
    let (_, session) = api.live(&session_id).await?;
    let result = session.compact(request.custom_instructions).await;
    api.publish_current(&session_id).await;
    let result = result?;
    Ok(Json(SessionCompactionResult {
        summary: result.summary,
        first_kept_entry_id: result.first_kept_entry_id,
        tokens_before: result.tokens_before,
        estimated_tokens_after: result.estimated_tokens_after,
        native: result.native,
    }))
}

/// Turns automatic compaction on or off.
pub(crate) async fn set_session_auto_compaction(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<SessionAutoCompactionRequest>,
) -> Result<StatusCode, ApiError> {
    let (_, session) = session_api(&state)?.live(&session_id).await?;
    session.set_auto_compaction(request.enabled).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Returns the conversation Pi continues, newest [`MAX_SESSION_MESSAGES`] kept.
///
/// The sequence is read before Pi is asked, so no output after it is missing
/// from the response or from the events after it. Output that Pi produced
/// while answering can appear in both. See the module documentation.
pub(crate) async fn get_session_messages(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<Json<SessionMessages>, ApiError> {
    let api = session_api(&state)?;
    let (_, session) = api.live(&session_id).await?;
    let sequence = api.events.last_sequence();
    let mut messages = session.messages().await?;
    let excess = messages.len().saturating_sub(MAX_SESSION_MESSAGES);
    messages.drain(..excess);
    Ok(Json(SessionMessages {
        sequence,
        messages,
        truncated: excess > 0,
    }))
}

/// Saves the whole conversation to the requested file in Pi's HTML export
/// format. See the module documentation.
pub(crate) async fn export_session(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<SessionExportRequest>,
) -> Result<StatusCode, ApiError> {
    let destination = std::path::PathBuf::from(request.destination);
    let mut audit = PendingAudit::operator(
        &state.audit,
        AuditOperation::FileExport,
        None,
        export_target(&destination),
    );
    audit.session(session_id.clone());
    let result = async {
        let (record, session) = session_api(&state)?.live(&session_id).await?;
        audit.workspace(record.workspace_id);
        session.export_html(destination).await?;
        Ok(StatusCode::NO_CONTENT)
    }
    .await;
    audit.finish(&result);
    result
}

/// Sets the session's display name and publishes the updated session.
pub(crate) async fn rename_session(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<SessionRenameRequest>,
) -> Result<StatusCode, ApiError> {
    let api = session_api(&state)?;
    let (record, session) = api.live(&session_id).await?;
    session.rename(request.name).await?;
    // Read the name back from Pi so the record carries what the file stores.
    api.refresh_native(&record, &session).await;
    api.publish_current(&session_id).await;
    Ok(StatusCode::NO_CONTENT)
}

/// Copies the session into a new stored session and continues in the copy.
///
/// Pi's RPC `clone` switches the running process to the copy rather than
/// starting a second process, so the live session keeps its Pau id and the
/// response names the new native session it now continues. The original stays
/// in the workspace's native session list and can be resumed from there. A
/// client that wants both open starts another live session on the original.
pub(crate) async fn clone_session(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<Json<SessionCloneResult>, ApiError> {
    let api = session_api(&state)?;
    let (record, session) = api.live(&session_id).await?;
    let native = session.clone_session().await?;
    // The clone continues in a new native session, so its reported ID changes.
    api.refresh_native(&record, &session).await;
    api.publish_current(&session_id).await;
    Ok(Json(SessionCloneResult {
        native_session_id: native.id,
    }))
}

/// Returns the prompts the user sent, newest first, for input recall.
pub(crate) async fn get_session_history(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<Json<Vec<String>>, ApiError> {
    let (_, session) = session_api(&state)?.live(&session_id).await?;
    Ok(Json(session.input_history().await?))
}

/// Sends the last prompt again as a new message after a failed assistant turn.
pub(crate) async fn retry_session(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<StatusCode, ApiError> {
    let api = session_api(&state)?;
    let (_, session) = api.live(&session_id).await?;
    session.retry().await?;
    api.publish_current(&session_id).await;
    Ok(StatusCode::ACCEPTED)
}

/// Turns automatic retry of transient provider errors on or off.
pub(crate) async fn set_session_auto_retry(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<SessionAutoRetryRequest>,
) -> Result<StatusCode, ApiError> {
    let (_, session) = session_api(&state)?.live(&session_id).await?;
    session.set_auto_retry(request.enabled).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Cancels an automatic retry that is waiting to run.
pub(crate) async fn abort_session_retry(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<StatusCode, ApiError> {
    let (_, session) = session_api(&state)?.live(&session_id).await?;
    session.abort_retry().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Returns the session's context fill and cumulative token and cost usage.
pub(crate) async fn get_session_usage(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<Json<SessionUsage>, ApiError> {
    let (_, session) = session_api(&state)?.live(&session_id).await?;
    Ok(Json(session_usage(session.usage().await?)))
}

/// Lists the models the session can use and marks the current one.
pub(crate) async fn list_session_models(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<Json<Vec<SessionModel>>, ApiError> {
    let (_, session) = session_api(&state)?.live(&session_id).await?;
    let models = session.models().await?;
    Ok(Json(models.into_iter().map(session_model).collect()))
}

/// Returns the entry tree of the session's persisted file.
pub(crate) async fn get_session_tree(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<Json<SessionTree>, ApiError> {
    let (_, session) = session_api(&state)?.live(&session_id).await?;
    let tree = session.tree().await?;
    Ok(Json(SessionTree {
        entries: tree
            .entries
            .into_iter()
            .map(|entry| SessionTreeEntry {
                id: entry.id,
                parent_id: entry.parent_id,
                kind: entry.kind,
                role: entry.role,
                preview: entry.preview,
                timestamp: entry.timestamp,
            })
            .collect(),
        leaf_id: tree.leaf_id,
        truncated: tree.truncated,
    }))
}

/// Query of the transcript search route.
#[derive(Deserialize)]
pub(crate) struct SessionSearchQuery {
    /// The text to find, ignoring case. A blank query matches nothing.
    #[serde(default)]
    q: String,
    /// Most matches to return, capped by the search itself.
    limit: Option<usize>,
}

/// Searches the whole persisted conversation, newest matches first.
///
/// Unlike the messages route this is not limited to the newest messages. See
/// [`pau_pi::search_pi_session_file`] for what is searched and why.
pub(crate) async fn search_session(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
    Query(query): Query<SessionSearchQuery>,
) -> Result<Json<SessionSearchResult>, ApiError> {
    let (_, session) = session_api(&state)?.live(&session_id).await?;
    let result = session
        .search(query.q, query.limit.unwrap_or(DEFAULT_SEARCH_MATCHES))
        .await?;
    Ok(Json(SessionSearchResult {
        matches: result
            .matches
            .into_iter()
            .map(|found| SessionSearchMatch {
                entry_id: found.entry_id,
                role: found.role,
                snippet: found.snippet,
                match_start: found.match_start,
                match_end: found.match_end,
                timestamp: found.timestamp,
            })
            .collect(),
        truncated: result.truncated,
    }))
}

/// Branches the session from an earlier user message through Pi.
pub(crate) async fn branch_session(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<SessionBranchRequest>,
) -> Result<Json<SessionBranchResult>, ApiError> {
    let api = session_api(&state)?;
    let (_, session) = api.live(&session_id).await?;
    let outcome = session.branch(request.entry_id).await?;
    // A branch starts a new native session.
    api.refresh_and_publish(&session_id).await;
    Ok(Json(SessionBranchResult {
        text: outcome.text,
        cancelled: outcome.cancelled,
    }))
}

/// Lists the slash commands the session offers.
pub(crate) async fn list_session_commands(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<Json<Vec<SessionCommand>>, ApiError> {
    let (_, session) = session_api(&state)?.live(&session_id).await?;
    let commands = session.commands().await?;
    Ok(Json(commands.into_iter().map(session_command).collect()))
}

/// Returns the extension UI that is still current for the session.
pub(crate) async fn get_session_extension_ui(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<Json<SessionExtensionUi>, ApiError> {
    let api = session_api(&state)?;
    api.live(&session_id).await?;
    Ok(Json(api.extension_ui(&session_id)))
}

fn stale_request() -> ApiError {
    ApiError::ExtensionRequest(
        StatusCode::NOT_FOUND,
        "extension_request_not_found",
        "That request was already answered, cancelled, or expired.".to_owned(),
    )
}

/// Answers an unanswered extension dialog.
///
/// A request that is unknown, already answered, timed out, or cleared is
/// `404 extension_request_not_found`. An answer of the wrong shape for the
/// dialog is `422 invalid_extension_response` and leaves the dialog waiting.
pub(crate) async fn respond_to_extension_ui(
    State(state): State<ApiState>,
    AxumPath((session_id, request_id)): AxumPath<(String, String)>,
    Json(response): Json<ExtensionUiResponse>,
) -> Result<StatusCode, ApiError> {
    let api = session_api(&state)?;
    let (record, session) = api.live(&session_id).await?;
    let dialog = api
        .extension_ui(&session_id)
        .dialogs
        .into_iter()
        .find(|dialog| dialog.id() == request_id)
        .ok_or_else(stale_request)?;
    let invalid = |message: &str| {
        ApiError::ExtensionRequest(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_extension_response",
            message.to_owned(),
        )
    };
    let id = request_id.clone();
    let native = match (&dialog, response) {
        (_, ExtensionUiResponse::Cancelled { cancelled: true }) => {
            PiExtensionUiResponse::Cancelled { id }
        }
        (_, ExtensionUiResponse::Cancelled { cancelled: false }) => {
            return Err(invalid("cancelled must be true"));
        }
        (ExtensionDialog::Select { options, .. }, ExtensionUiResponse::Value { value }) => {
            if !options.contains(&value) {
                return Err(invalid("The value is not one of the offered options."));
            }
            PiExtensionUiResponse::Value { id, value }
        }
        (
            ExtensionDialog::Input { .. } | ExtensionDialog::Editor { .. },
            ExtensionUiResponse::Value { value },
        ) => PiExtensionUiResponse::Value { id, value },
        (ExtensionDialog::Confirm { .. }, ExtensionUiResponse::Confirmed { confirmed }) => {
            PiExtensionUiResponse::Confirmed { id, confirmed }
        }
        _ => return Err(invalid("The response does not fit this dialog.")),
    };
    // Claiming the dialog first lets concurrent answers race safely: only one
    // caller finds it still waiting.
    if !api.take_dialog(&session_id, &request_id) {
        return Err(stale_request());
    }
    session.respond_to_extension_ui(native).await?;
    // Other clients showing the same dialog close it without a notice.
    api.publish_resolved(&record.workspace_id, &session_id, &request_id, "answered");
    Ok(StatusCode::NO_CONTENT)
}

/// Runs a shell command in the session and returns once it finishes.
///
/// The command is announced and concluded on the event stream so every client
/// can show it, not only the one that asked. See the module documentation.
pub(crate) async fn run_session_shell_command(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<SessionShellRequest>,
) -> Result<Json<SessionShellResult>, ApiError> {
    let api = session_api(&state)?;
    let (record, session) = api.live(&session_id).await?;
    if !record.capabilities.shell_commands {
        return Err(PiSessionError::Control(AgentControlError::Unsupported {
            control: AgentControl::ShellCommand,
        })
        .into());
    }
    let publish = |event: Value| {
        api.events.publish(
            diagnostic_timestamp(),
            Some(record.workspace_id.clone()),
            Some(session_id.clone()),
            ServerEventKind::SessionOutput,
            event.to_string(),
        );
    };
    let id = session.next_command_id();
    publish(serde_json::json!({
        "type": "shell_command_start",
        "id": id,
        "command": request.command,
        "exclude_from_context": request.exclude_from_context,
    }));
    let result = session
        .bash(id.clone(), request.command, request.exclude_from_context)
        .await
        .map(|result| SessionShellResult {
            id: id.clone(),
            output: result.output,
            exit_code: result.exit_code,
            cancelled: result.cancelled,
            truncated: result.truncated,
            full_output_path: result.full_output_path,
        });
    publish(match &result {
        Ok(result) => serde_json::json!({
            "type": "shell_command_end", "id": id, "result": result, "error": null,
        }),
        Err(error) => serde_json::json!({
            "type": "shell_command_end", "id": id, "result": null, "error": error.to_string(),
        }),
    });
    Ok(Json(result?))
}

/// Stops every running shell command in the session.
pub(crate) async fn abort_session_shell_commands(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<StatusCode, ApiError> {
    let (_, session) = session_api(&state)?.live(&session_id).await?;
    session.abort_bash().await?;
    Ok(StatusCode::NO_CONTENT)
}

mod claude;
pub(crate) mod readiness;
pub(crate) mod resources;

#[cfg(all(test, unix))]
mod tests;
