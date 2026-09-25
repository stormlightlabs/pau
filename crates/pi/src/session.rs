use crate::{PiProcess, PiProcessError, PiProcessExit, PiProcessOutput, StartPiProcessOptions};
use pau_agent::{
    AgentCapabilities, AgentControl, AgentControlError, AgentSessionStatus, PromptQueueChoice,
};
use serde_json::{Value, json};
use std::error::Error;
use std::fmt;
use std::sync::Arc;
use tokio::sync::{Mutex, broadcast};

/// Controls supported by the verified Pi RPC protocol.
pub const PI_RPC_CAPABILITIES: AgentCapabilities = AgentCapabilities {
    prompt: true,
    follow_up: true,
    steer: true,
    interrupt: true,
    model_selection: true,
    stop: true,
};

/// A Pi session-control failure.
#[derive(Debug)]
pub enum PiSessionError {
    /// The operation is unsupported, invalid in the current state, or rejected by Pi.
    Control(AgentControlError),
    /// The RPC process failed while handling the operation.
    Process(PiProcessError),
}

impl fmt::Display for PiSessionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Control(error) => error.fmt(formatter),
            Self::Process(error) => error.fmt(formatter),
        }
    }
}

impl Error for PiSessionError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Control(error) => Some(error),
            Self::Process(error) => Some(error),
        }
    }
}

impl From<PiProcessError> for PiSessionError {
    fn from(error: PiProcessError) -> Self {
        Self::Process(error)
    }
}

/// Owns the controls and observed lifecycle state for one Pi RPC process.
pub struct PiSession {
    process: Arc<PiProcess>,
    capabilities: AgentCapabilities,
    status: Arc<Mutex<AgentSessionStatus>>,
}

impl PiSession {
    /// Starts a Pi RPC process with the controls supported by the verified protocol.
    pub fn start(options: StartPiProcessOptions) -> Result<Self, PiProcessError> {
        let process = PiProcess::start(options)?;
        Ok(Self::from_process(process, PI_RPC_CAPABILITIES))
    }

    /// Wraps a started process with the capabilities advertised for that process.
    pub fn from_process(process: PiProcess, capabilities: AgentCapabilities) -> Self {
        let process = Arc::new(process);
        let status = Arc::new(Mutex::new(AgentSessionStatus::Idle));
        observe_lifecycle(process.subscribe(), Arc::clone(&status));
        Self {
            process,
            capabilities,
            status,
        }
    }

    /// Returns the controls available for this session.
    pub fn capabilities(&self) -> AgentCapabilities {
        self.capabilities
    }

    /// Returns the latest session status observed from accepted controls and Pi events.
    pub async fn status(&self) -> AgentSessionStatus {
        *self.status.lock().await
    }

    /// Subscribes to the native process event, diagnostic, and exit stream.
    pub fn subscribe(&self) -> broadcast::Receiver<PiProcessOutput> {
        self.process.subscribe()
    }

    /// Starts work, or queues it during a run when the caller chooses a queue.
    pub async fn prompt(
        &self,
        message: impl Into<String>,
        queue: Option<PromptQueueChoice>,
    ) -> Result<(), PiSessionError> {
        let control = AgentControl::Prompt;
        self.require_capability(control)?;
        let mut status = self.status.lock().await;
        let command = match (*status, queue) {
            (AgentSessionStatus::Idle, _) => json!({
                "type": "prompt",
                "message": message.into(),
            }),
            (AgentSessionStatus::Running, Some(choice)) => json!({
                "type": "prompt",
                "message": message.into(),
                "streamingBehavior": match choice {
                    PromptQueueChoice::Steer => "steer",
                    PromptQueueChoice::FollowUp => "followUp",
                },
            }),
            (AgentSessionStatus::Running, None) => {
                return Err(invalid_state(
                    control,
                    *status,
                    "choose the steer or follow-up queue",
                ));
            }
            _ => return Err(not_ready(control, *status)),
        };
        self.command(control, command).await?;
        *status = AgentSessionStatus::Running;
        Ok(())
    }

    /// Queues work to run after Pi finishes its current work.
    pub async fn follow_up(&self, message: impl Into<String>) -> Result<(), PiSessionError> {
        self.running_message_control(AgentControl::FollowUp, "follow_up", message.into())
            .await
    }

    /// Queues an instruction after the current assistant turn and tool calls.
    pub async fn steer(&self, message: impl Into<String>) -> Result<(), PiSessionError> {
        self.running_message_control(AgentControl::Steer, "steer", message.into())
            .await
    }

    /// Aborts active work while leaving the Pi process available for another prompt.
    pub async fn interrupt(&self) -> Result<(), PiSessionError> {
        let control = AgentControl::Interrupt;
        self.require_capability(control)?;
        let mut status = self.status.lock().await;
        if *status != AgentSessionStatus::Running {
            return Err(invalid_state(
                control,
                *status,
                "only a running session can be interrupted",
            ));
        }
        self.command(control, json!({"type": "abort"})).await?;
        *status = AgentSessionStatus::Idle;
        Ok(())
    }

    /// Selects a configured Pi model while the session is idle.
    pub async fn select_model(
        &self,
        provider: impl Into<String>,
        model_id: impl Into<String>,
    ) -> Result<Value, PiSessionError> {
        let control = AgentControl::SelectModel;
        self.require_capability(control)?;
        let status = self.status.lock().await;
        if *status != AgentSessionStatus::Idle {
            return Err(invalid_state(
                control,
                *status,
                "wait for the session to become idle",
            ));
        }
        let response = self
            .command(
                control,
                json!({
                    "type": "set_model",
                    "provider": provider.into(),
                    "modelId": model_id.into(),
                }),
            )
            .await?;
        Ok(response.get("data").cloned().unwrap_or(Value::Null))
    }

    /// Stops the Pi process through staged shutdown.
    pub async fn stop(&self) -> Result<PiProcessExit, PiSessionError> {
        let control = AgentControl::Stop;
        self.require_capability(control)?;
        let mut status = self.status.lock().await;
        match *status {
            AgentSessionStatus::Starting
            | AgentSessionStatus::Idle
            | AgentSessionStatus::Running
            | AgentSessionStatus::Waiting => {}
            _ => {
                return Err(invalid_state(
                    control,
                    *status,
                    "the session is already stopping or stopped",
                ));
            }
        }
        *status = AgentSessionStatus::Stopping;
        match self.process.shutdown().await {
            Ok(exit) => {
                *status = AgentSessionStatus::Stopped;
                Ok(exit)
            }
            Err(error) => {
                *status = AgentSessionStatus::Failed;
                Err(error.into())
            }
        }
    }

    async fn running_message_control(
        &self,
        control: AgentControl,
        command_type: &'static str,
        message: String,
    ) -> Result<(), PiSessionError> {
        self.require_capability(control)?;
        let status = self.status.lock().await;
        if *status != AgentSessionStatus::Running {
            return Err(invalid_state(
                control,
                *status,
                "this queue accepts messages only during an active run",
            ));
        }
        self.command(control, json!({"type": command_type, "message": message}))
            .await?;
        Ok(())
    }

    fn require_capability(&self, control: AgentControl) -> Result<(), PiSessionError> {
        if self.capabilities.supports(control) {
            Ok(())
        } else {
            Err(PiSessionError::Control(AgentControlError::Unsupported {
                control,
            }))
        }
    }

    async fn command(
        &self,
        control: AgentControl,
        command: Value,
    ) -> Result<Value, PiSessionError> {
        let response = self.process.command(command).await?;
        if response.get("success").and_then(Value::as_bool) == Some(true) {
            return Ok(response);
        }
        let message = response
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Pi returned an invalid command response")
            .to_owned();
        Err(PiSessionError::Control(AgentControlError::Rejected {
            control,
            message,
        }))
    }
}

fn invalid_state(
    control: AgentControl,
    status: AgentSessionStatus,
    reason: &'static str,
) -> PiSessionError {
    PiSessionError::Control(AgentControlError::InvalidState {
        control,
        status,
        reason,
    })
}

fn not_ready(control: AgentControl, status: AgentSessionStatus) -> PiSessionError {
    invalid_state(control, status, "wait for the session to become idle")
}

fn observe_lifecycle(
    mut output: broadcast::Receiver<PiProcessOutput>,
    status: Arc<Mutex<AgentSessionStatus>>,
) {
    tokio::spawn(async move {
        loop {
            match output.recv().await {
                Ok(PiProcessOutput::Event(event)) => {
                    let next = match event.get("type").and_then(Value::as_str) {
                        Some("agent_start") => Some(AgentSessionStatus::Running),
                        Some("agent_settled") => Some(AgentSessionStatus::Idle),
                        _ => None,
                    };
                    if let Some(next) = next {
                        let mut current = status.lock().await;
                        if !matches!(
                            *current,
                            AgentSessionStatus::Stopping
                                | AgentSessionStatus::Stopped
                                | AgentSessionStatus::Failed
                        ) {
                            *current = next;
                        }
                    }
                }
                Ok(PiProcessOutput::Exit(exit)) => {
                    let mut current = status.lock().await;
                    *current = if exit.requested || *current == AgentSessionStatus::Stopping {
                        AgentSessionStatus::Stopped
                    } else {
                        AgentSessionStatus::Failed
                    };
                    break;
                }
                Ok(PiProcessOutput::Diagnostic(_)) => {}
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}
