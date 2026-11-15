//! Claude sessions, run through the Claude bridge host in `pau-agent`.
//!
//! The bridge owns Claude's native protocol, so the API only starts the host,
//! sends prompts, interrupts, and stops it. Each bridge event is published
//! unchanged as a `session_output` event. A `turn.completed` event also
//! publishes the session as idle and records the Claude session ID it
//! carries. A failed turn leaves the session idle too, because a failed API
//! call ends the turn and not the session. Its error reaches clients in that
//! event and the server log. Bridge diagnostics stay out of the event stream,
//! as Pi's stderr does.

use std::sync::Arc;

use axum::http::StatusCode;
use pau_agent::{
    AgentControl, AgentControlError, AgentKind, CLAUDE_BRIDGE_CAPABILITIES, ClaudeBridgeOutput,
    ClaudeBridgeProcessError, ClaudeSession, ClaudeSessionError, discover_claude,
};
use pau_core::{
    ServerEventKind,
    session::{
        AgentSession, SessionPromptRequest, SessionQueue, SessionStatus, StartSessionRequest,
    },
};
use pau_pi::PiSessionError;
use serde_json::json;
use tokio::sync::broadcast;

use super::{SessionApi, SessionRecord, describe, session_status};
use crate::{ApiError, diagnostic_timestamp};

#[cfg(all(test, unix))]
mod tests;

impl SessionApi {
    pub(super) fn claude_session(&self, id: &str) -> Option<Arc<ClaudeSession>> {
        self.claude
            .lock()
            .expect("Claude sessions lock poisoned")
            .get(id)
            .cloned()
    }

    pub(super) fn claude_ids(&self) -> Vec<String> {
        self.claude
            .lock()
            .expect("Claude sessions lock poisoned")
            .keys()
            .cloned()
            .collect()
    }

    pub(super) async fn claude_summary(&self, id: &str) -> Option<AgentSession> {
        let session = self.claude_session(id)?;
        let record = self.record(id)?;
        Some(describe(
            id,
            &record,
            session_status(session.status().await),
        ))
    }

    pub(super) async fn stop_all_claude(&self) {
        for id in self.claude_ids() {
            let Some(session) = self.claude_session(&id) else {
                continue;
            };
            if let Err(error) = session.stop().await {
                tracing::warn!(
                    event = "session.stop_failed",
                    session_id = %id,
                    %error,
                    "could not stop a Claude session during shutdown"
                );
            }
        }
    }

    /// Discovers Claude Code and starts a bridge host for it in `root`,
    /// resuming the Claude session the request names.
    ///
    /// The bridge cannot select a model, so a request that names one is
    /// refused before anything starts. So is a native session ID that is not
    /// a hyphenated UUID, the form Claude Code gives its sessions, because
    /// the ID reaches the bridge's command line as the `--resume` value.
    pub(super) async fn start_claude(
        &self,
        request: StartSessionRequest,
        root: std::path::PathBuf,
    ) -> Result<AgentSession, ApiError> {
        if request.model.is_some() {
            return Err(session_error(ClaudeSessionError::Control(
                AgentControlError::Unsupported {
                    control: AgentControl::SelectModel,
                },
            )));
        }
        if let Some(id) = request.native_session_id.as_deref()
            && (id.len() != 36 || uuid::Uuid::try_parse(id).is_err())
        {
            return Err(ApiError::Agent(
                StatusCode::BAD_REQUEST,
                "invalid_native_session_id",
                format!("`{id}` is not a Claude Code session ID."),
            ));
        }
        let options = self.claude_discovery.clone();
        let discovery = tokio::task::spawn_blocking(move || discover_claude(&options))
            .await
            .map_err(|error| unavailable(error.to_string()))?
            .map_err(|error| unavailable(error.to_string()))?;
        let launch = discovery.bridge_options(root, request.native_session_id.as_deref());
        let session = ClaudeSession::start(launch)
            .await
            .map_err(|error| unavailable(error.to_string()))?;
        // Subscribe before the session is visible, so no prompt's output can
        // be missed.
        let output = session.subscribe();
        let session = Arc::new(session);

        let id = uuid::Uuid::new_v4().to_string();
        let record = SessionRecord {
            agent: AgentKind::Claude,
            workspace_id: request.workspace_id,
            started_at: diagnostic_timestamp(),
            capabilities: CLAUDE_BRIDGE_CAPABILITIES,
            native: Arc::default(),
            sandbox_directory: None,
        };
        // A resumed session reports its ID only after its first turn, so the
        // requested ID stands in until then. Without it, stopping the session
        // before that turn would lose the conversation it resumed.
        record
            .native
            .lock()
            .expect("native state lock poisoned")
            .session_id = session
            .native_session_id()
            .await
            .or(request.native_session_id);
        self.records
            .lock()
            .expect("session records lock poisoned")
            .insert(id.clone(), record.clone());
        self.claude
            .lock()
            .expect("Claude sessions lock poisoned")
            .insert(id.clone(), Arc::clone(&session));
        tokio::spawn(self.clone().forward_claude(id.clone(), output));

        let summary = describe(&id, &record, session_status(session.status().await));
        self.publish(&summary);
        Ok(summary)
    }

    /// Publishes one Claude session's bridge events and lifecycle changes
    /// until its host exits.
    async fn forward_claude(self, id: String, mut output: broadcast::Receiver<ClaudeBridgeOutput>) {
        loop {
            let item = match output.recv().await {
                Ok(item) => item,
                Err(broadcast::error::RecvError::Lagged(count)) => {
                    tracing::warn!(
                        event = "session.output_dropped",
                        session_id = %id,
                        count,
                        "dropped Claude session output"
                    );
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => return,
            };
            let Some(record) = self.record(&id) else {
                return;
            };
            match item {
                ClaudeBridgeOutput::Event(event) => {
                    self.events.publish(
                        diagnostic_timestamp(),
                        Some(record.workspace_id.clone()),
                        Some(id.clone()),
                        ServerEventKind::SessionOutput,
                        json!({
                            "sequence": event.sequence,
                            "event": event.event,
                            "payload": event.payload,
                        })
                        .to_string(),
                    );
                    if event.event == "turn.completed" {
                        let payload = event.payload.as_ref();
                        if let Some(native_id) = payload
                            .and_then(|payload| payload.get("sessionId"))
                            .and_then(serde_json::Value::as_str)
                        {
                            record
                                .native
                                .lock()
                                .expect("native state lock poisoned")
                                .session_id = Some(native_id.to_owned());
                        }
                        if payload
                            .and_then(|payload| payload.get("status"))
                            .and_then(serde_json::Value::as_str)
                            == Some("failed")
                        {
                            let error = payload
                                .and_then(|payload| payload.get("error"))
                                .and_then(serde_json::Value::as_str)
                                .unwrap_or("no error reported");
                            tracing::warn!(
                                event = "session.turn_failed",
                                session_id = %id,
                                error,
                                "a Claude turn failed"
                            );
                        }
                        // Published directly, because the session's own
                        // observer may not have applied the change yet.
                        self.publish(&describe(&id, &record, SessionStatus::Idle));
                    }
                }
                ClaudeBridgeOutput::Diagnostic(_) => {}
                ClaudeBridgeOutput::Exit(exit) => {
                    self.claude
                        .lock()
                        .expect("Claude sessions lock poisoned")
                        .remove(&id);
                    self.records
                        .lock()
                        .expect("session records lock poisoned")
                        .remove(&id);
                    let status = if exit.requested {
                        SessionStatus::Stopped
                    } else {
                        SessionStatus::Failed
                    };
                    let mut session = describe(&id, &record, status);
                    session.ended_at = Some(diagnostic_timestamp());
                    session.exit_code = exit.code;
                    self.publish(&session);
                    return;
                }
            }
        }
    }
}

/// Sends a prompt to a Claude session. The bridge takes text only, so queued
/// prompts are unsupported controls and images are refused.
pub(super) async fn prompt(
    session: &ClaudeSession,
    request: SessionPromptRequest,
) -> Result<(), ApiError> {
    if let Some(queue) = request.queue {
        let control = match queue {
            SessionQueue::Steer => AgentControl::Steer,
            SessionQueue::FollowUp => AgentControl::FollowUp,
        };
        return Err(session_error(ClaudeSessionError::Control(
            AgentControlError::Unsupported { control },
        )));
    }
    if request.images.is_some_and(|images| !images.is_empty()) {
        return Err(ApiError::InvalidImage(
            "image_input_unsupported",
            "Claude Code sessions do not accept images.".to_owned(),
        ));
    }
    session.prompt(request.message).await.map_err(session_error)
}

/// The refusal of a Pi-only route for a Claude session.
pub(super) fn unsupported() -> ApiError {
    ApiError::Agent(
        StatusCode::NOT_IMPLEMENTED,
        "unsupported_control",
        "Claude Code sessions do not support this control.".to_owned(),
    )
}

fn unavailable(message: String) -> ApiError {
    ApiError::Agent(
        StatusCode::SERVICE_UNAVAILABLE,
        "agent_unavailable",
        message,
    )
}

/// Maps a Claude session failure to the status and code a Pi session failure
/// of the same kind gets.
pub(super) fn session_error(error: ClaudeSessionError) -> ApiError {
    let message = error.to_string();
    match error {
        ClaudeSessionError::Control(error) => PiSessionError::Control(error).into(),
        ClaudeSessionError::Process(
            ClaudeBridgeProcessError::Exited(_) | ClaudeBridgeProcessError::Write(_),
        ) => ApiError::Agent(StatusCode::GONE, "session_exited", message),
        ClaudeSessionError::Process(ClaudeBridgeProcessError::Rejected(_)) => ApiError::Agent(
            StatusCode::UNPROCESSABLE_ENTITY,
            "control_rejected",
            message,
        ),
        ClaudeSessionError::Process(_) => {
            ApiError::Agent(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", message)
        }
    }
}
