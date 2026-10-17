use crate::{
    PiCompactionResult, PiExtensionUiResponse, PiProcess, PiProcessError, PiProcessExit,
    PiProcessOutput, PiSessionTree, StartPiProcessOptions, read_pi_session_tree,
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
    usage: true,
    compaction: true,
    branching: true,
    retry: true,
    rename: true,
    clone_session: true,
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

/// The most prompts [`PiSession::input_history`] returns.
pub const PI_INPUT_HISTORY_LIMIT: usize = 100;

/// How full the model's context window is.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PiContextUsage {
    /// Estimated tokens in the window. Pi reports none right after a
    /// compaction, until a fresh response provides usage data.
    pub tokens: Option<u64>,
    /// The model's context window size in tokens.
    pub context_window: u64,
    /// Percent of the window in use, from 0 to 100.
    pub percent: Option<f64>,
}

/// Cumulative tokens across a Pi session.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct PiTokenUsage {
    /// Input tokens.
    pub input: u64,
    /// Output tokens.
    pub output: u64,
    /// Tokens read from the prompt cache.
    pub cache_read: u64,
    /// Tokens written to the prompt cache.
    pub cache_write: u64,
    /// All tokens Pi counted.
    pub total: u64,
}

/// Context, token, and cost usage from Pi's `get_session_stats`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PiSessionUsage {
    /// Context-window fill. Pi omits it when no model or window size is known.
    pub context: Option<PiContextUsage>,
    /// Tokens across the session, including tools and summarization.
    pub tokens: PiTokenUsage,
    /// Cumulative cost in US dollars.
    pub cost: f64,
}

/// An image sent with a prompt, as Pi's `ImageContent`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PiImage {
    /// The image's MIME type, such as `image/png`.
    pub mime_type: String,
    /// The base64-encoded image bytes.
    pub data: String,
}

impl PiImage {
    /// Adds `images` to a prompt, steer, or follow-up command. Pi's `images`
    /// field is optional, so an empty list leaves the command unchanged.
    fn attach(command: &mut Value, images: Vec<Self>) {
        if images.is_empty() {
            return;
        }
        command["images"] = images
            .into_iter()
            .map(|image| json!({"type": "image", "data": image.data, "mimeType": image.mime_type}))
            .collect();
    }
}

/// A model Pi can run, as configured for the session.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PiModel {
    /// The provider Pi routes the model through.
    pub provider: String,
    /// The model identifier within the provider.
    pub id: String,
    /// Pi's display name, when it has one.
    pub name: Option<String>,
    /// Whether the model supports reasoning.
    pub reasoning: bool,
    /// Whether the model accepts image input.
    pub image_input: bool,
    /// Whether this is the model the session currently uses.
    pub current: bool,
}

/// What Pi did with a branch request.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PiBranchOutcome {
    /// The text of the message branched from.
    pub text: Option<String>,
    /// Whether an extension cancelled the branch.
    pub cancelled: bool,
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

    /// Reads Pi's context-window fill and cumulative token and cost usage.
    pub async fn usage(&self) -> Result<PiSessionUsage, PiSessionError> {
        let control = AgentControl::ReadUsage;
        self.require_capability(control)?;
        let response = self
            .command(control, json!({"type": "get_session_stats"}))
            .await?;
        response.get("data").and_then(parse_usage).ok_or_else(|| {
            PiSessionError::NativeSession("Pi did not report session usage".to_owned())
        })
    }

    /// Lists the models Pi has configured and marks the one the session uses.
    pub async fn models(&self) -> Result<Vec<PiModel>, PiSessionError> {
        let control = AgentControl::SelectModel;
        self.require_capability(control)?;
        let state = self.command(control, json!({"type": "get_state"})).await?;
        let current = state
            .get("data")
            .and_then(|data| data.get("model"))
            .map(model_key);
        let response = self
            .command(control, json!({"type": "get_available_models"}))
            .await?;
        let entries = response
            .get("data")
            .and_then(|data| data.get("models"))
            .and_then(Value::as_array)
            .ok_or_else(|| {
                PiSessionError::NativeSession("Pi did not report a model list".to_owned())
            })?;
        entries
            .iter()
            .map(|entry| parse_model(entry, current.as_ref()))
            .collect()
    }

    /// Reads the entry tree from the session file Pi persists.
    pub async fn tree(&self) -> Result<PiSessionTree, PiSessionError> {
        self.require_capability(AgentControl::Branching)?;
        let file = self.native_session().await?.file;
        tokio::task::spawn_blocking(move || read_pi_session_tree(std::path::Path::new(&file)))
            .await
            .map_err(|error| PiSessionError::NativeSession(error.to_string()))?
            .map_err(PiSessionError::NativeSession)
    }

    /// Continues from the user message `entry_id` in a new session file.
    ///
    /// Pi does the branching; the session file is never edited here. The
    /// session must be idle. After a branch Pi runs against the new file.
    pub async fn branch(&self, entry_id: String) -> Result<PiBranchOutcome, PiSessionError> {
        let control = AgentControl::Branching;
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
            .command(control, json!({"type": "fork", "entryId": entry_id}))
            .await?;
        let data = response.get("data");
        Ok(PiBranchOutcome {
            text: data
                .and_then(|data| data.get("text"))
                .and_then(Value::as_str)
                .map(str::to_owned),
            cancelled: data
                .and_then(|data| data.get("cancelled"))
                .and_then(Value::as_bool)
                == Some(true),
        })
    }

    /// Lists the prompts the user sent, newest first, as Pi's editor recalls them.
    ///
    /// Pi keeps recall history only in its terminal editor and rebuilds it from
    /// the session's user messages on resume, so this reads the same messages
    /// from `get_entries`. Consecutive repeats collapse, as in Pi's editor, and
    /// at most [`PI_INPUT_HISTORY_LIMIT`] prompts return.
    pub async fn input_history(&self) -> Result<Vec<String>, PiSessionError> {
        let control = AgentControl::Prompt;
        self.require_capability(control)?;
        let response = self
            .command(control, json!({"type": "get_entries"}))
            .await?;
        let entries = response
            .get("data")
            .and_then(|data| data.get("entries"))
            .and_then(Value::as_array)
            .ok_or_else(|| {
                PiSessionError::NativeSession("Pi did not report session entries".to_owned())
            })?;
        let mut history: Vec<String> = Vec::new();
        for text in entries.iter().rev().filter_map(entry_prompt) {
            if history.last() != Some(&text) {
                history.push(text);
            }
            if history.len() == PI_INPUT_HISTORY_LIMIT {
                break;
            }
        }
        Ok(history)
    }

    /// Starts work, or queues it during a run when the caller chooses a queue.
    ///
    /// Pi forwards `images` to the model without checking its image support, so
    /// callers check [`PiModel::image_input`] first.
    pub async fn prompt(
        &self,
        message: impl Into<String>,
        images: Vec<PiImage>,
        queue: Option<PromptQueueChoice>,
    ) -> Result<(), PiSessionError> {
        let control = AgentControl::Prompt;
        self.require_capability(control)?;
        let mut status = self.status.lock().await;
        let mut command = match (*status, queue) {
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
        PiImage::attach(&mut command, images);
        let response = self.command(control, command).await?;
        // An extension command or input handler can consume the prompt, and
        // then no run starts. Pi releases before 0.99 do not report a
        // disposition, so treat a missing one as a started run.
        let disposition = response
            .get("data")
            .and_then(|data| data.get("disposition"))
            .and_then(Value::as_str);
        if disposition != Some("handled") {
            *status = AgentSessionStatus::Running;
        }
        Ok(())
    }

    /// Queues work to run after Pi finishes its current work.
    pub async fn follow_up(
        &self,
        message: impl Into<String>,
        images: Vec<PiImage>,
    ) -> Result<(), PiSessionError> {
        self.running_message_control(AgentControl::FollowUp, "follow_up", message.into(), images)
            .await
    }

    /// Queues an instruction after the current assistant turn and tool calls.
    pub async fn steer(
        &self,
        message: impl Into<String>,
        images: Vec<PiImage>,
    ) -> Result<(), PiSessionError> {
        self.running_message_control(AgentControl::Steer, "steer", message.into(), images)
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

    /// Summarizes older context while the session is idle.
    ///
    /// The session reports `Running` until Pi answers, so prompts must choose a
    /// queue and [`Self::interrupt`] cancels the compaction. Pi also emits
    /// `compaction_start` and `compaction_end` events for the attempt. A failed
    /// or cancelled compaction returns [`AgentControlError::Rejected`] with
    /// Pi's message.
    pub async fn compact(
        &self,
        custom_instructions: Option<String>,
    ) -> Result<PiCompactionResult, PiSessionError> {
        let control = AgentControl::Compact;
        self.require_capability(control)?;
        {
            let mut status = self.status.lock().await;
            if *status != AgentSessionStatus::Idle {
                return Err(not_ready(control, *status));
            }
            *status = AgentSessionStatus::Running;
        }
        let mut command = json!({"type": "compact"});
        if let Some(instructions) = custom_instructions {
            command["customInstructions"] = Value::String(instructions);
        }
        // Compaction can take as long as a model call, so the status lock is
        // released while Pi works to keep status reads and interrupts available.
        let result = self.command(control, command).await;
        let mut status = self.status.lock().await;
        if *status == AgentSessionStatus::Running {
            *status = AgentSessionStatus::Idle;
        }
        let response = result?;
        Ok(PiCompactionResult::from_native(
            response.get("data").unwrap_or(&Value::Null),
        ))
    }

    /// Enables or disables Pi's compaction when context is nearly full.
    ///
    /// Automatic compaction reports progress through `compaction_start` and
    /// `compaction_end` events rather than a command response.
    pub async fn set_auto_compaction(&self, enabled: bool) -> Result<(), PiSessionError> {
        let control = AgentControl::AutoCompaction;
        self.require_capability(control)?;
        self.command(
            control,
            json!({"type": "set_auto_compaction", "enabled": enabled}),
        )
        .await?;
        Ok(())
    }

    /// Sets the display name Pi stores with the session.
    ///
    /// Pi rejects an empty name. The name shows in Pi's session listings.
    pub async fn rename(&self, name: impl Into<String>) -> Result<(), PiSessionError> {
        let control = AgentControl::Rename;
        self.require_capability(control)?;
        self.command(
            control,
            json!({"type": "set_session_name", "name": name.into()}),
        )
        .await?;
        Ok(())
    }

    /// Copies the active branch into a new stored session and continues in it.
    ///
    /// Pi's `clone` command switches the running process to the copy, so this
    /// session keeps its process and Pau identity while the original stays on
    /// disk to be resumed later. Returns the native session the process now
    /// uses. An extension that cancels the clone makes this return
    /// [`AgentControlError::Rejected`]. The session must be idle.
    pub async fn clone_session(&self) -> Result<PiNativeSession, PiSessionError> {
        let control = AgentControl::CloneSession;
        self.require_capability(control)?;
        let status = self.status.lock().await;
        if *status != AgentSessionStatus::Idle {
            return Err(invalid_state(
                control,
                *status,
                "wait for the session to become idle",
            ));
        }
        let response = self.command(control, json!({"type": "clone"})).await?;
        if response
            .get("data")
            .and_then(|data| data.get("cancelled"))
            .and_then(Value::as_bool)
            == Some(true)
        {
            return Err(PiSessionError::Control(AgentControlError::Rejected {
                control,
                message: "An extension cancelled the clone".to_owned(),
            }));
        }
        self.native_session().await
    }

    /// Runs the last user prompt again after the assistant turn failed.
    ///
    /// Pi's RPC protocol has no retry command, so this reads the conversation
    /// with `get_messages`, requires the last message to be an assistant turn
    /// that ended with an error, and sends the user prompt before it as a new
    /// prompt. The retry therefore adds a second copy of that prompt to the
    /// session history. Use [`Self::set_auto_retry`] for transient provider
    /// errors that Pi can retry in place.
    pub async fn retry(&self) -> Result<(), PiSessionError> {
        let control = AgentControl::Retry;
        self.require_capability(control)?;
        let mut status = self.status.lock().await;
        if *status != AgentSessionStatus::Idle {
            return Err(not_ready(control, *status));
        }
        let response = self
            .command(control, json!({"type": "get_messages"}))
            .await?;
        let messages = response
            .pointer("/data/messages")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default();
        let message = failed_turn_prompt(messages).map_err(|message| {
            PiSessionError::Control(AgentControlError::Rejected { control, message })
        })?;
        self.command(control, json!({"type": "prompt", "message": message}))
            .await?;
        *status = AgentSessionStatus::Running;
        Ok(())
    }

    /// Enables or disables Pi's automatic retry of transient provider errors.
    ///
    /// Pi reports each attempt through `auto_retry_start` and `auto_retry_end`
    /// events.
    pub async fn set_auto_retry(&self, enabled: bool) -> Result<(), PiSessionError> {
        let control = AgentControl::AutoRetry;
        self.require_capability(control)?;
        self.command(
            control,
            json!({"type": "set_auto_retry", "enabled": enabled}),
        )
        .await?;
        Ok(())
    }

    /// Cancels the delay before an automatic retry and stops retrying.
    pub async fn abort_retry(&self) -> Result<(), PiSessionError> {
        let control = AgentControl::AbortRetry;
        self.require_capability(control)?;
        let status = self.status.lock().await;
        if *status != AgentSessionStatus::Running {
            return Err(invalid_state(
                control,
                *status,
                "only a running session can have a pending retry",
            ));
        }
        self.command(control, json!({"type": "abort_retry"}))
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
        images: Vec<PiImage>,
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
        let mut command = json!({"type": command_type, "message": message});
        PiImage::attach(&mut command, images);
        self.command(control, command).await?;
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

/// The text of a user message entry, or `None` for other entries and for
/// messages without text.
fn entry_prompt(entry: &Value) -> Option<String> {
    if entry.get("type").and_then(Value::as_str) != Some("message") {
        return None;
    }
    let message = entry.get("message")?;
    if message.get("role").and_then(Value::as_str) != Some("user") {
        return None;
    }
    let text = match message.get("content")? {
        Value::String(text) => text.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter_map(|block| block.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => return None,
    };
    (!text.trim().is_empty()).then_some(text)
}

fn parse_usage(data: &Value) -> Option<PiSessionUsage> {
    let tokens = data.get("tokens")?;
    let count = |key: &str| tokens.get(key).and_then(Value::as_u64);
    // Pi omits `contextUsage` without a model; its tokens and percent are
    // null after a compaction.
    let context = data.get("contextUsage").and_then(|usage| {
        Some(PiContextUsage {
            tokens: usage.get("tokens").and_then(Value::as_u64),
            context_window: usage.get("contextWindow")?.as_u64()?,
            percent: usage.get("percent").and_then(Value::as_f64),
        })
    });
    Some(PiSessionUsage {
        context,
        tokens: PiTokenUsage {
            input: count("input")?,
            output: count("output")?,
            cache_read: count("cacheRead")?,
            cache_write: count("cacheWrite")?,
            total: count("total")?,
        },
        cost: data.get("cost")?.as_f64()?,
    })
}

type ModelKey<'a> = (Option<&'a str>, Option<&'a str>);

fn model_key(model: &Value) -> ModelKey<'_> {
    let text = |key| model.get(key).and_then(Value::as_str);
    (text("provider"), text("id"))
}

fn parse_model(entry: &Value, current: Option<&ModelKey<'_>>) -> Result<PiModel, PiSessionError> {
    let key = model_key(entry);
    let (Some(provider), Some(id)) = key else {
        return Err(PiSessionError::NativeSession(
            "Pi reported a model without a provider and id".to_owned(),
        ));
    };
    Ok(PiModel {
        provider: provider.to_owned(),
        id: id.to_owned(),
        name: entry.get("name").and_then(Value::as_str).map(str::to_owned),
        reasoning: entry.get("reasoning").and_then(Value::as_bool) == Some(true),
        image_input: entry
            .get("input")
            .and_then(Value::as_array)
            .is_some_and(|input| input.iter().any(|kind| kind.as_str() == Some("image"))),
        current: current == Some(&key),
    })
}

/// Returns the user prompt that preceded a failed final assistant turn, or why
/// there is nothing to retry.
fn failed_turn_prompt(messages: &[Value]) -> Result<String, String> {
    fn role(message: &Value) -> Option<&str> {
        message.get("role").and_then(Value::as_str)
    }
    let failed = messages.last().is_some_and(|message| {
        role(message) == Some("assistant")
            && message.get("stopReason").and_then(Value::as_str) == Some("error")
    });
    if !failed {
        return Err("the last assistant turn did not fail".to_owned());
    }
    let user = messages
        .iter()
        .rev()
        .find(|message| role(message) == Some("user"))
        .ok_or_else(|| "the failed turn has no user prompt to retry".to_owned())?;
    let text = match user.get("content") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|block| block.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    };
    if text.is_empty() {
        return Err("the failed prompt has no text to retry".to_owned());
    }
    Ok(text)
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
