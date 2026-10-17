use crate::{
    PiExtensionUiResponse, PiProcess, PiProcessError, PiProcessExit, PiProcessOutput,
    StartPiProcessOptions,
};
use pau_agent::{
    AgentCapabilities, AgentControl, AgentControlError, AgentMessageQueue, AgentSessionStatus,
    PromptQueueChoice, ThinkingLevel,
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
    message_queue: true,
    model_selection: true,
    thinking_level: true,
    command_discovery: true,
    stop: true,
};

/// A Pi session-control failure.
#[derive(Debug)]
pub enum PiSessionError {
    /// The operation is unsupported, invalid in the current state, or rejected by Pi.
    Control(AgentControlError),
    /// Pi returned an invalid response to a session-state request.
    NativeSession(String),
    /// The RPC process failed while handling the operation.
    Process(PiProcessError),
}

impl fmt::Display for PiSessionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Control(error) => error.fmt(formatter),
            Self::NativeSession(message) => formatter.write_str(message),
            Self::Process(error) => error.fmt(formatter),
        }
    }
}

impl Error for PiSessionError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Control(error) => Some(error),
            Self::NativeSession(_) => None,
            Self::Process(error) => Some(error),
        }
    }
}

impl From<PiProcessError> for PiSessionError {
    fn from(error: PiProcessError) -> Self {
        Self::Process(error)
    }
}

/// The native identity and file reported by a Pi RPC session.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PiNativeSession {
    /// Pi's stable session identifier.
    pub id: String,
    /// Pi's authoritative JSONL session file.
    pub file: String,
}

/// Where Pi loaded a slash command from.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PiCommandSource {
    /// A command registered by an extension.
    Extension,
    /// A prompt template.
    Prompt,
    /// A skill.
    Skill,
}

/// A slash command Pi offers in a session.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PiCommand {
    /// The name typed after the slash, without the leading `/`.
    pub name: String,
    /// Pi's description, when the command has one.
    pub description: Option<String>,
    /// The kind of resource that provides the command.
    pub source: PiCommandSource,
    /// The path Pi reports in the command's source info, when present.
    pub path: Option<String>,
}

/// Owns the controls and observed lifecycle state for one Pi RPC process.
pub struct PiSession {
    process: Arc<PiProcess>,
    capabilities: AgentCapabilities,
    status: Arc<Mutex<AgentSessionStatus>>,
    queue: Arc<Mutex<AgentMessageQueue>>,
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
        let queue = Arc::new(Mutex::new(AgentMessageQueue::default()));
        observe_lifecycle(process.subscribe(), Arc::clone(&status), Arc::clone(&queue));
        Self {
            process,
            capabilities,
            status,
            queue,
        }
    }

    /// Returns the controls available for this session.
    pub fn capabilities(&self) -> AgentCapabilities {
        self.capabilities
    }

    /// Returns the root PID used to register this session with resource monitoring.
    pub fn process_id(&self) -> u32 {
        self.process.process_id()
    }

    /// Returns the latest session status observed from accepted controls and Pi events.
    pub async fn status(&self) -> AgentSessionStatus {
        *self.status.lock().await
    }

    /// Subscribes to the native process event, diagnostic, and exit stream.
    pub fn subscribe(&self) -> broadcast::Receiver<PiProcessOutput> {
        self.process.subscribe()
    }

    /// Reads the native session identity that Pi persists on disk.
    pub async fn native_session(&self) -> Result<PiNativeSession, PiSessionError> {
        let response = self.process.command(json!({"type": "get_state"})).await?;
        if response.get("success").and_then(Value::as_bool) != Some(true) {
            let message = response
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Pi rejected the session-state request");
            return Err(PiSessionError::NativeSession(message.to_owned()));
        }
        let data = response.get("data");
        let id = data
            .and_then(|data| data.get("sessionId"))
            .and_then(Value::as_str);
        let file = data
            .and_then(|data| data.get("sessionFile"))
            .and_then(Value::as_str);
        match (id, file) {
            (Some(id), Some(file)) => Ok(PiNativeSession {
                id: id.to_owned(),
                file: file.to_owned(),
            }),
            _ => Err(PiSessionError::NativeSession(
                "Pi did not report a persisted native session".to_owned(),
            )),
        }
    }

    /// Lists the prompt templates, skills, and extension commands Pi offers.
    pub async fn commands(&self) -> Result<Vec<PiCommand>, PiSessionError> {
        let control = AgentControl::ListCommands;
        self.require_capability(control)?;
        let response = self
            .command(control, json!({"type": "get_commands"}))
            .await?;
        let entries = response
            .get("data")
            .and_then(|data| data.get("commands"))
            .and_then(Value::as_array)
            .ok_or_else(|| {
                PiSessionError::NativeSession("Pi did not report a command list".to_owned())
            })?;
        entries.iter().map(parse_command).collect()
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

    /// Returns the steer and follow-up messages Pi last reported as pending.
    ///
    /// Pi has no command that reads the queue. This snapshot follows its
    /// `queue_update` events, each of which carries the complete queue.
    pub async fn message_queue(&self) -> Result<AgentMessageQueue, PiSessionError> {
        self.require_capability(AgentControl::MessageQueue)?;
        Ok(self.queue.lock().await.clone())
    }

    /// Removes every pending steer and follow-up message and returns their text.
    pub async fn clear_message_queue(&self) -> Result<AgentMessageQueue, PiSessionError> {
        let control = AgentControl::MessageQueue;
        self.require_capability(control)?;
        let response = self
            .command(control, json!({"type": "clear_queue"}))
            .await?;
        let cleared = response
            .get("data")
            .and_then(queue_from_value)
            .ok_or_else(|| {
                PiSessionError::Control(AgentControlError::Rejected {
                    control,
                    message: "Pi returned an invalid queue response".to_owned(),
                })
            })?;
        *self.queue.lock().await = AgentMessageQueue::default();
        Ok(cleared)
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

    /// Sets the thinking level for later turns while the session is idle.
    ///
    /// Pi clamps the level to what the current model supports.
    pub async fn set_thinking_level(&self, level: ThinkingLevel) -> Result<(), PiSessionError> {
        let control = AgentControl::SetThinkingLevel;
        self.require_capability(control)?;
        let status = self.status.lock().await;
        if *status != AgentSessionStatus::Idle {
            return Err(invalid_state(
                control,
                *status,
                "wait for the session to become idle",
            ));
        }
        self.command(
            control,
            json!({"type": "set_thinking_level", "level": level.as_str()}),
        )
        .await?;
        Ok(())
    }

    /// Responds to a blocking request from a configured Pi extension.
    ///
    /// Pi correlates this record with the extension request directly. It does not
    /// send a normal command response.
    pub async fn respond_to_extension_ui(
        &self,
        response: PiExtensionUiResponse,
    ) -> Result<(), PiSessionError> {
        self.process.send_record(response.into_record()).await?;
        Ok(())
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

fn parse_command(entry: &Value) -> Result<PiCommand, PiSessionError> {
    let text = |key| entry.get(key).and_then(Value::as_str).map(str::to_owned);
    let source = match entry.get("source").and_then(Value::as_str) {
        Some("extension") => PiCommandSource::Extension,
        Some("prompt") => PiCommandSource::Prompt,
        Some("skill") => PiCommandSource::Skill,
        _ => {
            return Err(PiSessionError::NativeSession(
                "Pi reported a command with an unknown source".to_owned(),
            ));
        }
    };
    let name = text("name").ok_or_else(|| {
        PiSessionError::NativeSession("Pi reported a command without a name".to_owned())
    })?;
    Ok(PiCommand {
        name,
        description: text("description"),
        source,
        path: entry
            .get("sourceInfo")
            .and_then(|info| info.get("path"))
            .and_then(Value::as_str)
            .map(str::to_owned),
    })
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

fn queue_from_value(value: &Value) -> Option<AgentMessageQueue> {
    let messages = |key: &str| -> Option<Vec<String>> {
        value
            .get(key)?
            .as_array()?
            .iter()
            .map(|message| message.as_str().map(str::to_owned))
            .collect()
    };
    Some(AgentMessageQueue {
        steering: messages("steering")?,
        follow_up: messages("followUp")?,
    })
}

fn observe_lifecycle(
    mut output: broadcast::Receiver<PiProcessOutput>,
    status: Arc<Mutex<AgentSessionStatus>>,
    queue: Arc<Mutex<AgentMessageQueue>>,
) {
    tokio::spawn(async move {
        loop {
            match output.recv().await {
                Ok(PiProcessOutput::Event(event)) => {
                    if event.get("type").and_then(Value::as_str) == Some("queue_update")
                        && let Some(update) = queue_from_value(&event)
                    {
                        *queue.lock().await = update;
                    }
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
