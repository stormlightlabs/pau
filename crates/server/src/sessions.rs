//! Live Pi sessions over HTTP and the event stream.
//!
//! HTTP routes start, control, and stop sessions and return once Pi accepts or
//! rejects the request. Session progress arrives on `/api/events`:
//! `session_changed` carries an [`AgentSession`] whenever the lifecycle state
//! changes, and `session_output` carries each native Pi event.

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
        AgentSession, SessionAutoCompactionRequest, SessionCapabilities, SessionCommand,
        SessionCommandSource, SessionCompactRequest, SessionCompactionResult, SessionMessageQueue,
        SessionMessageRequest, SessionModelSelection, SessionPromptRequest, SessionQueue,
        SessionStatus, SessionThinkingLevel, SessionThinkingLevelRequest, StartSessionRequest,
    },
};
use pau_pi::{
    DiscoverPiOptions, PiCommand, PiCommandSource, PiProcessError, PiProcessOutput, PiSession,
    PiSessionError, PiSessionOutput, PiSessionRegistry, PiSessionRegistryError, PiShutdownTimeouts,
    StartPiProcessOptions, StartRegisteredPiSession, discover_pi,
};
use serde_json::Value;
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
                    self.events.publish(
                        diagnostic_timestamp(),
                        Some(tagged.workspace_id),
                        Some(tagged.session_id.clone()),
                        ServerEventKind::SessionOutput,
                        event.to_string(),
                    );
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
        compaction: capabilities.compaction,
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

/// Starts an unsandboxed Pi session in a registered workspace.
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
                arguments: Vec::new(),
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
    let (_, session) = api.live(&session_id).await?;
    session.interrupt().await?;
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

/// Lists the slash commands the session offers.
pub(crate) async fn list_session_commands(
    State(state): State<ApiState>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<Json<Vec<SessionCommand>>, ApiError> {
    let (_, session) = session_api(&state)?.live(&session_id).await?;
    let commands = session.commands().await?;
    Ok(Json(commands.into_iter().map(session_command).collect()))
}

#[cfg(all(test, unix))]
mod tests;
