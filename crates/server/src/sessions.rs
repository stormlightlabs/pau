//! Live Pi sessions over HTTP and the event stream.
//!
//! HTTP routes start, control, and stop sessions and return once Pi accepts or
//! rejects the request. Session progress arrives on `/api/events`:
//! `session_changed` carries an [`AgentSession`] whenever the lifecycle state
//! changes, and `session_output` carries each native Pi event.
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
//! interrupt), the API publishes a synthetic `extension_ui_resolved`
//! `session_output` event with the request `id` and a `reason`, so live clients
//! can close it without refetching. Notifications are transient by nature and
//! stay output-only.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use axum::{
    Json,
    extract::{Path as AxumPath, State},
    http::StatusCode,
};
use pau_agent::{
    AgentCapabilities, AgentControlError, AgentMessageQueue, AgentSessionStatus, PromptQueueChoice,
    ThinkingLevel,
};
use pau_core::{
    ServerEventKind,
    session::{
        AgentSession, ExtensionDialog, ExtensionStatus, ExtensionUiResponse, ExtensionWidget,
        ExtensionWidgetPlacement, NativeSessionList, NativeSessionSummary, NativeSessionWarning,
        SessionAutoCompactionRequest, SessionAutoRetryRequest, SessionCapabilities, SessionCommand,
        SessionCommandSource, SessionCompactRequest, SessionCompactionResult, SessionContextUsage,
        SessionExtensionUi, SessionMessageQueue, SessionMessageRequest, SessionModel,
        SessionModelSelection, SessionPromptRequest, SessionQueue, SessionStatus,
        SessionThinkingLevel, SessionThinkingLevelRequest, SessionTokenUsage, SessionUsage,
        StartSessionRequest,
    },
};
use pau_pi::{
    DiscoverPiOptions, PiCommand, PiCommandSource, PiExtensionUiRequest, PiExtensionUiResponse,
    PiExtensionWidgetPlacement, PiModel, PiProcessError, PiProcessOutput, PiSession,
    PiSessionError, PiSessionOutput, PiSessionRegistry, PiSessionRegistryError, PiSessionUsage,
    PiShutdownTimeouts, StartPiProcessOptions, StartRegisteredPiSession, discover_pi,
    find_pi_session_file, list_pi_session_files, pi_configuration_paths,
};
use serde_json::Value;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::sync::broadcast;

use crate::{ApiError, ApiState, EventHub, diagnostic_timestamp, workspace_service};

/// What the API needs to describe a live session beyond the Pi process.
#[derive(Clone)]
struct SessionRecord {
    workspace_id: String,
    started_at: String,
    capabilities: AgentCapabilities,
}

/// Starts Pi sessions and publishes their lifecycle and output events.
#[derive(Clone)]
pub(crate) struct SessionApi {
    registry: Arc<PiSessionRegistry>,
    /// Pi discovery settings captured at startup. Each launch replaces the
    /// working directory with the workspace root.
    discovery: DiscoverPiOptions,
    /// Sessions this API started. A record is inserted before its process
    /// starts, so output that races the start response still has a session to
    /// describe, and is removed when the process exits.
    records: Arc<Mutex<HashMap<String, SessionRecord>>>,
    /// Current extension UI per live session. See the module documentation.
    extension_ui: Arc<Mutex<HashMap<String, SessionExtensionUi>>>,
    events: EventHub,
}

impl std::fmt::Debug for SessionApi {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("SessionApi").finish_non_exhaustive()
    }
}

impl SessionApi {
    /// Creates the service and starts forwarding registry output to `events`.
    ///
    /// Must be called inside a Tokio runtime.
    pub(crate) fn new(
        registry: PiSessionRegistry,
        discovery: DiscoverPiOptions,
        events: EventHub,
    ) -> Self {
        let api = Self {
            registry: Arc::new(registry),
            discovery,
            records: Arc::default(),
            extension_ui: Arc::default(),
            events,
        };
        tokio::spawn(api.clone().forward(api.registry.subscribe()));
        api
    }

    /// Stops every live session through staged shutdown.
    pub(crate) async fn stop_all(&self) {
        for id in self.registry.active_ids().await {
            if let Err(error) = self.registry.stop(&id, diagnostic_timestamp()).await {
                tracing::warn!(
                    event = "session.stop_failed",
                    session_id = %id,
                    %error,
                    "could not stop a Pi session during shutdown"
                );
            }
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

    fn record(&self, id: &str) -> Option<SessionRecord> {
        self.records
            .lock()
            .expect("session records lock poisoned")
            .get(id)
            .cloned()
    }

    async fn summary(&self, id: &str) -> Result<AgentSession, ApiError> {
        let (record, session) = self.live(id).await?;
        Ok(describe(
            id,
            &record,
            session_status(session.status().await),
        ))
    }

    async fn live(&self, id: &str) -> Result<(SessionRecord, Arc<PiSession>), ApiError> {
        let not_found = || ApiError::from(PiSessionRegistryError::NotFound(id.to_owned()));
        let record = self.record(id).ok_or_else(not_found)?;
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
                // Stderr can contain anything Pi or its extensions print,
                // including secrets, so it stays out of the event stream.
                PiProcessOutput::Diagnostic(_) => {}
                PiProcessOutput::Exit(exit) => {
                    self.records
                        .lock()
                        .expect("session records lock poisoned")
                        .remove(&tagged.session_id);
                    self.clear_dialogs(&tagged.session_id, &tagged.workspace_id, "exited");
                    self.extension_ui
                        .lock()
                        .expect("extension UI lock poisoned")
                        .remove(&tagged.session_id);
                    let status = if exit.requested {
                        SessionStatus::Stopped
                    } else {
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
    AgentSession {
        id: id.to_owned(),
        workspace_id: record.workspace_id.clone(),
        status,
        started_at: record.started_at.clone(),
        ended_at: None,
        exit_code: None,
        capabilities: session_capabilities(record.capabilities),
    }
}

fn session_status(status: AgentSessionStatus) -> SessionStatus {
    match status {
        AgentSessionStatus::Starting => SessionStatus::Starting,
        AgentSessionStatus::Idle => SessionStatus::Idle,
        AgentSessionStatus::Running => SessionStatus::Running,
        AgentSessionStatus::Waiting => SessionStatus::Waiting,
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
        retry: capabilities.retry,
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

/// HTTP status and stable code for a session failure.
///
/// Controls distinguish three caller-visible cases: the agent cannot perform
/// the control at all (`unsupported_control`), the session is in the wrong
/// state (`invalid_session_state`), and the agent refused the request
/// (`control_rejected`). A process that exits before it answers is
/// `session_exited`.
pub(crate) fn error_status(error: &PiSessionRegistryError) -> (StatusCode, &'static str) {
    match error {
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
            PiSessionError::Process(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal_error"),
        },
    }
}

fn session_api(state: &ApiState) -> Result<&SessionApi, ApiError> {
    state.sessions.as_ref().ok_or(ApiError::ServiceUnavailable)
}

/// Lists live sessions, oldest first.
pub(crate) async fn list_sessions(
    State(state): State<ApiState>,
) -> Result<Json<Vec<AgentSession>>, ApiError> {
    let api = session_api(&state)?;
    let mut sessions = Vec::new();
    for id in api.registry.active_ids().await {
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

/// Starts an unsandboxed Pi session in a registered workspace, resuming a
/// stored Pi session when the request names one.
pub(crate) async fn start_session(
    State(state): State<ApiState>,
    Json(request): Json<StartSessionRequest>,
) -> Result<(StatusCode, Json<AgentSession>), ApiError> {
    let api = session_api(&state)?;
    let root = workspace_service(&state)?
        .root(&request.workspace_id)
        .await?;
    // Sandboxed launches are not wired to the desktop yet. Refusing keeps a
    // sandboxed workspace from silently running tools with full access.
    if let Some(sandbox) = &state.sandbox {
        let selection = sandbox
            .selections
            .get(&request.workspace_id, None)
            .await
            .map_err(|error| ApiError::from(pau_core::workspace::WorkspaceError::from(error)))?;
        if selection.effective().settings().is_some() {
            return Err(ApiError::SandboxedSessionUnsupported);
        }
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

    let id = uuid::Uuid::new_v4().to_string();
    let record = SessionRecord {
        workspace_id: request.workspace_id.clone(),
        started_at: diagnostic_timestamp(),
        capabilities: pau_pi::PI_RPC_CAPABILITIES,
    };
    api.records
        .lock()
        .expect("session records lock poisoned")
        .insert(id.clone(), record.clone());
    let started = api
        .registry
        .start(StartRegisteredPiSession {
            id: id.clone(),
            workspace_id: request.workspace_id,
            started_at: record.started_at.clone(),
            process: StartPiProcessOptions {
                executable_path: pi.executable_path,
                working_directory: root,
                arguments,
                environment: Vec::new(),
                shutdown_timeouts: PiShutdownTimeouts::default(),
            },
            sandbox_placeholders: Vec::new(),
        })
        .await;
    let session = match started {
        Ok(session) => session,
        Err(error) => {
            api.records
                .lock()
                .expect("session records lock poisoned")
                .remove(&id);
            return Err(error.into());
        }
    };
    if let Some(SessionModelSelection { provider, model_id }) = request.model
        && let Err(error) = session.select_model(provider, model_id).await
    {
        // Clients never saw this session, so its exit is not published.
        api.records
            .lock()
            .expect("session records lock poisoned")
            .remove(&id);
        let _ = api.registry.stop(&id, diagnostic_timestamp()).await;
        return Err(error.into());
    }

    let summary = describe(&id, &record, session_status(session.status().await));
    api.publish(&summary);
    Ok((StatusCode::CREATED, Json(summary)))
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
    let api = session_api(&state)?;
    api.live(&session_id).await?;
    api.registry
        .stop(&session_id, diagnostic_timestamp())
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Starts work, or queues it during a run when the request names a queue.
pub(crate) async fn prompt_session(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<SessionPromptRequest>,
) -> Result<StatusCode, ApiError> {
    let api = session_api(&state)?;
    let (_, session) = api.live(&session_id).await?;
    let queue = request.queue.map(|queue| match queue {
        SessionQueue::Steer => PromptQueueChoice::Steer,
        SessionQueue::FollowUp => PromptQueueChoice::FollowUp,
    });
    session.prompt(request.message, queue).await?;
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
    session.steer(request.message).await?;
    Ok(StatusCode::ACCEPTED)
}

/// Queues work to run after the current work finishes.
pub(crate) async fn follow_up_session(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<SessionMessageRequest>,
) -> Result<StatusCode, ApiError> {
    let (_, session) = session_api(&state)?.live(&session_id).await?;
    session.follow_up(request.message).await?;
    Ok(StatusCode::ACCEPTED)
}

/// Aborts the active run and leaves the session ready for another prompt.
pub(crate) async fn interrupt_session(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<StatusCode, ApiError> {
    let api = session_api(&state)?;
    let (record, session) = api.live(&session_id).await?;
    session.interrupt().await?;
    api.clear_dialogs(&session_id, &record.workspace_id, "interrupted");
    api.publish_current(&session_id).await;
    Ok(StatusCode::NO_CONTENT)
}

/// Selects a model and returns Pi's native record for it.
pub(crate) async fn select_session_model(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<SessionModelSelection>,
) -> Result<Json<Value>, ApiError> {
    let (_, session) = session_api(&state)?.live(&session_id).await?;
    session
        .select_model(request.provider, request.model_id)
        .await
        .map(Json)
        .map_err(ApiError::from)
}

/// Selects the thinking level for later model turns.
pub(crate) async fn set_session_thinking_level(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<SessionThinkingLevelRequest>,
) -> Result<StatusCode, ApiError> {
    let (_, session) = session_api(&state)?.live(&session_id).await?;
    session
        .set_thinking_level(thinking_level(request.level))
        .await?;
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

/// Returns the prompts the user sent, newest first, for input recall.
pub(crate) async fn get_session_history(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<Json<Vec<String>>, ApiError> {
    let (_, session) = session_api(&state)?.live(&session_id).await?;
    Ok(Json(session.input_history().await?))
}

/// Runs the last prompt again after a failed assistant turn.
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
    let (_, session) = api.live(&session_id).await?;
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
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(all(test, unix))]
mod tests;
