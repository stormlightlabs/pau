use crate::{
    PiCompactionResult, PiExtensionUiResponse, PiProcess, PiProcessError, PiProcessExit,
    PiProcessOutput, PiSearchResult, PiSessionTree, StartPiProcessOptions, read_pi_session_tree,
    search_pi_session_file,
};
use pau_agent::{
    AgentCapabilities, AgentControl, AgentControlError, AgentMessageQueue, AgentSessionStatus,
    PromptQueueChoice, ThinkingLevel,
};
use serde_json::{Value, json};
use std::error::Error;
use std::fmt;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::sync::{Mutex, broadcast, mpsc, oneshot};

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
    export_transcript: true,
    shell_commands: true,
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
    /// A transcript export could not write its destination. An unusable
    /// destination is [`std::io::ErrorKind::InvalidInput`].
    Export(std::io::Error),
}

impl fmt::Display for PiSessionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Control(error) => error.fmt(formatter),
            Self::NativeSession(message) => formatter.write_str(message),
            Self::Process(error) => error.fmt(formatter),
            Self::Export(error) => error.fmt(formatter),
        }
    }
}

impl Error for PiSessionError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Control(error) => Some(error),
            Self::NativeSession(_) => None,
            Self::Process(error) => Some(error),
            Self::Export(error) => Some(error),
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

/// The parts of Pi's `get_state` that change while a session runs.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PiSessionState {
    /// Pi's current session identifier, which changes when Pi branches.
    pub native_id: Option<String>,
    /// The thinking level Pi applies, after any clamping to the model.
    pub thinking_level: Option<ThinkingLevel>,
    /// The display name Pi stores in the session file, when one is set.
    pub name: Option<String>,
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

/// How long [`PiSession::export_html`] waits for Pi to render a transcript.
///
/// The process waits for a long-running command such as this one for as long
/// as Pi keeps answering. A long session can take Pi several seconds to
/// render, so this cap leaves wide room.
const EXPORT_TIMEOUT: Duration = Duration::from_secs(120);

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

/// The final result of a shell command run through Pi's `bash` command.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PiBashResult {
    /// Combined stdout and stderr, truncated when it was long.
    pub output: String,
    /// The exit code, or `None` when the command was stopped or killed.
    pub exit_code: Option<i32>,
    /// Whether `abort_bash` stopped the command.
    pub cancelled: bool,
    /// Whether `output` holds only the end of the output.
    pub truncated: bool,
    /// The file that holds the complete output when it was truncated.
    pub full_output_path: Option<String>,
}

/// Owns the controls and observed lifecycle state for one Pi RPC process.
///
/// Command responses and Pi's events both change the status and the message
/// queue, but they reach the session on different tasks, so an event can be
/// applied after a response that Pi wrote later. Pi answers `prompt` before it
/// emits `agent_start`, for example, and an interrupt can finish before the
/// lifecycle task sees that event. Each field therefore keeps the stdout
/// position of the record that last set it, and a record from an earlier
/// position is ignored. A position is read and written only while its value's
/// lock is held.
pub struct PiSession {
    process: Arc<PiProcess>,
    capabilities: AgentCapabilities,
    status: Arc<Mutex<AgentSessionStatus>>,
    status_position: Arc<AtomicU64>,
    queue: Arc<Mutex<AgentMessageQueue>>,
    queue_position: Arc<AtomicU64>,
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
        let session = Self {
            capabilities,
            status: Arc::new(Mutex::new(AgentSessionStatus::Idle)),
            status_position: Arc::default(),
            queue: Arc::new(Mutex::new(AgentMessageQueue::default())),
            queue_position: Arc::default(),
            process,
        };
        let events = session
            .process
            .sequenced_events()
            .expect("a session owns its process, so nothing else reads its sequenced events");
        observe_lifecycle(events, session.process.subscribe(), &session);
        session
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
        let status = *self.status.lock().await;
        let ended = matches!(
            status,
            AgentSessionStatus::Stopping | AgentSessionStatus::Stopped | AgentSessionStatus::Failed
        );
        if !ended && self.not_responding() {
            AgentSessionStatus::NotResponding
        } else {
            status
        }
    }

    /// Whether Pi stopped answering commands. While it has, the session
    /// reports [`AgentSessionStatus::NotResponding`] and every command fails
    /// with [`PiProcessError::NotResponding`]. The status Pi's events set is
    /// kept underneath and returns once Pi writes again.
    pub fn not_responding(&self) -> bool {
        self.process.not_responding().is_some()
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

    /// Reads the session identifier, thinking level, and name Pi currently
    /// reports.
    ///
    /// Pi changes the first two on its own: branching starts a new native
    /// session and a model change clamps the thinking level. The name comes
    /// from the session file, so it survives a restart or a resume.
    pub async fn state(&self) -> Result<PiSessionState, PiSessionError> {
        let response = self.process.command(json!({"type": "get_state"})).await?;
        if response.get("success").and_then(Value::as_bool) != Some(true) {
            return Err(PiSessionError::NativeSession(
                "Pi rejected the session-state request".to_owned(),
            ));
        }
        let data = response.get("data");
        let text = |key: &str| data.and_then(|data| data.get(key)).and_then(Value::as_str);
        Ok(PiSessionState {
            native_id: text("sessionId").map(str::to_owned),
            thinking_level: text("thinkingLevel").and_then(ThinkingLevel::from_name),
            name: text("sessionName")
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_owned),
        })
    }

    /// Lists the thinking levels the current model supports, in Pi's order.
    ///
    /// A model without reasoning support reports only [`ThinkingLevel::Off`].
    /// The list follows the model, so callers read it again after a model
    /// change. Levels this crate does not know are skipped.
    pub async fn thinking_levels(&self) -> Result<Vec<ThinkingLevel>, PiSessionError> {
        let control = AgentControl::SetThinkingLevel;
        self.require_capability(control)?;
        let response = self
            .command(control, json!({"type": "get_available_thinking_levels"}))
            .await?;
        let levels = response
            .get("data")
            .and_then(|data| data.get("levels"))
            .and_then(Value::as_array)
            .ok_or_else(|| {
                PiSessionError::NativeSession("Pi did not report thinking levels".to_owned())
            })?;
        Ok(levels
            .iter()
            .filter_map(Value::as_str)
            .filter_map(ThinkingLevel::from_name)
            .collect())
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

    /// Searches the persisted conversation. See [`search_pi_session_file`].
    pub async fn search(
        &self,
        query: String,
        limit: usize,
    ) -> Result<PiSearchResult, PiSessionError> {
        self.require_capability(AgentControl::Branching)?;
        let file = self.native_session().await?.file;
        tokio::task::spawn_blocking(move || {
            search_pi_session_file(std::path::Path::new(&file), &query, limit)
        })
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
            return Err(self.invalid_state(
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

    /// Reads the conversation Pi continues, oldest message first.
    ///
    /// The messages come from `get_messages` in Pi's native JSON. They cover
    /// the current branch only, and after a compaction they start with Pi's
    /// `compactionSummary` message instead of the older turns.
    pub async fn messages(&self) -> Result<Vec<Value>, PiSessionError> {
        let control = AgentControl::Prompt;
        self.require_capability(control)?;
        let mut response = self
            .command(control, json!({"type": "get_messages"}))
            .await?;
        match response.pointer_mut("/data/messages").map(Value::take) {
            Some(Value::Array(messages)) => Ok(messages),
            _ => Err(PiSessionError::NativeSession(
                "Pi did not report session messages".to_owned(),
            )),
        }
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
                return Err(self.invalid_state(
                    control,
                    *status,
                    "choose the steer or follow-up queue",
                ));
            }
            _ => return Err(self.not_ready(control, *status)),
        };
        PiImage::attach(&mut command, images);
        let (position, response) = self.command_at(control, command).await?;
        // An extension command or input handler can consume the prompt, and
        // then no run starts. Pi releases before 0.99 do not report a
        // disposition, so treat a missing one as a started run.
        let disposition = response
            .get("data")
            .and_then(|data| data.get("disposition"))
            .and_then(Value::as_str);
        if disposition != Some("handled") {
            self.set_status(&mut status, AgentSessionStatus::Running, position);
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
        let (position, response) = self
            .command_at(control, json!({"type": "clear_queue"}))
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
        let mut queue = self.queue.lock().await;
        if position > self.queue_position.load(Ordering::Relaxed) {
            *queue = AgentMessageQueue::default();
            self.queue_position.store(position, Ordering::Relaxed);
        }
        Ok(cleared)
    }

    /// Aborts active work while leaving the Pi process available for another
    /// prompt, and returns the steer and follow-up messages it removed.
    ///
    /// Pi's `abort` goes on to run any messages still queued, so this sends
    /// `clear_queue` first, as Pi's own Escape does, and hands the cleared text
    /// back for the caller to restore. The abort goes ahead when clearing fails
    /// or the session has no message queue: stopping the run comes first, and
    /// the messages stay queued in Pi, which runs them after the abort, so no
    /// text is lost. The returned queue is empty in that case.
    pub async fn interrupt(&self) -> Result<AgentMessageQueue, PiSessionError> {
        let control = AgentControl::Interrupt;
        self.require_capability(control)?;
        let mut status = self.status.lock().await;
        if *status != AgentSessionStatus::Running {
            return Err(self.invalid_state(
                control,
                *status,
                "only a running session can be interrupted",
            ));
        }
        let cleared = self.clear_message_queue().await.unwrap_or_default();
        let (position, _) = self.command_at(control, json!({"type": "abort"})).await?;
        self.set_status(&mut status, AgentSessionStatus::Idle, position);
        Ok(cleared)
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
            return Err(self.invalid_state(
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
            return Err(self.invalid_state(
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
                return Err(self.not_ready(control, *status));
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
            return Err(self.invalid_state(
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

    /// Writes Pi's HTML export of the session to `destination`, replacing a
    /// file already there.
    ///
    /// Pi renders the export with its `export_html` command, the same page as
    /// its `/export` command and `pi --export`, so the file opens in a browser
    /// with no Pau involved. The file is readable only by its owner, because a
    /// transcript can hold secrets from the conversation.
    ///
    /// The export takes two steps, and both are needed. Pi opens its output
    /// path by name and follows symlinks, so it renders into a new owner-only
    /// directory that no one else can write to. Pau then opens Pi's file
    /// without following symlinks and copies it into a new owner-only
    /// temporary file beside `destination`, which is synced and renamed into
    /// place. Letting Pi write beside `destination` would let anyone who can
    /// write to that folder swap Pi's file for a symlink and receive the
    /// transcript. Pi never opens `destination`, so a symlink there is
    /// replaced rather than followed, and a failed export leaves any existing
    /// file untouched.
    ///
    /// A spawned task owns both temporary paths and removes them only after
    /// Pi answers, so dropping this future cannot leave Pi writing a file
    /// that no one cleans up. The caller waits at most two minutes;
    /// a caller that stopped waiting gets no file, and the task still holds
    /// the directory until Pi answers or exits.
    ///
    /// `destination` must be an absolute path whose parent directory exists.
    pub async fn export_html(&self, destination: PathBuf) -> Result<(), PiSessionError> {
        let control = AgentControl::ExportTranscript;
        self.require_capability(control)?;
        let directory = export_directory(&destination).map_err(PiSessionError::Export)?;
        let mut staging = tempfile::Builder::new();
        staging.prefix("pau-transcript-");
        // `tempfile` creates a directory with the umask's mode, so ask for
        // owner-only explicitly.
        #[cfg(unix)]
        staging.permissions(std::os::unix::fs::PermissionsExt::from_mode(0o700));
        let staging = staging.tempdir().map_err(PiSessionError::Export)?;
        let rendered = staging.path().join("transcript.html");
        let process = Arc::clone(&self.process);
        let (result_sender, result) = oneshot::channel();
        tokio::spawn(async move {
            let response = process
                .command_at(
                    process.next_command_id(),
                    json!({"type": "export_html", "outputPath": rendered.to_string_lossy()}),
                )
                .await;
            if result_sender.is_closed() {
                return;
            }
            let outcome = match response {
                Err(error) => Err(error.into()),
                Ok((_, response)) => match command_response(control, response) {
                    Err(error) => Err(error),
                    Ok(_) => tokio::task::spawn_blocking(move || {
                        copy_export(&rendered, &directory, &destination)
                    })
                    .await
                    .unwrap_or_else(|error| Err(io::Error::other(error)))
                    .map_err(PiSessionError::Export),
                },
            };
            drop(staging);
            let _ = result_sender.send(outcome);
        });
        match tokio::time::timeout(EXPORT_TIMEOUT, result).await {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(_)) => Err(PiSessionError::Export(io::Error::other(
                "the export stopped before Pi answered",
            ))),
            Err(_) => Err(PiSessionError::Export(io::Error::new(
                io::ErrorKind::TimedOut,
                "Pi did not finish the export in time",
            ))),
        }
    }

    /// Sends the last user prompt again as a new message after the assistant
    /// turn failed.
    ///
    /// Pi's RPC protocol has no command that reruns a turn in place, so this
    /// reads the conversation with `get_messages`, requires the last message to
    /// be an assistant turn that ended with an error, and sends the user prompt
    /// before it as a new prompt. The session file therefore holds a second
    /// copy of that prompt, and clients must label the action as sending the
    /// message again rather than as a retry. Pi's automatic retry, configured
    /// with [`Self::set_auto_retry`], reruns transient provider errors in place
    /// without that copy. Only the prompt text is sent again.
    pub async fn retry(&self) -> Result<(), PiSessionError> {
        let control = AgentControl::Retry;
        self.require_capability(control)?;
        let mut status = self.status.lock().await;
        if *status != AgentSessionStatus::Idle {
            return Err(self.not_ready(control, *status));
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
        let (position, _) = self
            .command_at(control, json!({"type": "prompt", "message": message}))
            .await?;
        self.set_status(&mut status, AgentSessionStatus::Running, position);
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
            return Err(self.invalid_state(
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

    /// Allocates the RPC ID for a later [`Self::bash`] call.
    ///
    /// Pi tags each `bash_execution_update` event with the ID of the command
    /// that produced it, so a caller that announces the command before it runs
    /// can match its streamed output.
    pub fn next_command_id(&self) -> String {
        self.process.next_command_id()
    }

    /// Runs a shell command through Pi and resolves once it finishes.
    ///
    /// `id` comes from [`Self::next_command_id`]. Output streams as
    /// `bash_execution_update` events carrying that ID while the command
    /// runs. Pi stores the command and its output in the session and adds
    /// them to the model context on the next prompt, unless
    /// `exclude_from_context` is set. Commands run in any session status,
    /// including during a model turn, and [`Self::abort_bash`] stops them.
    pub async fn bash(
        &self,
        id: String,
        command: impl Into<String>,
        exclude_from_context: bool,
    ) -> Result<PiBashResult, PiSessionError> {
        let control = AgentControl::ShellCommand;
        self.require_capability(control)?;
        let mut record = json!({"type": "bash", "command": command.into()});
        if exclude_from_context {
            record["excludeFromContext"] = Value::Bool(true);
        }
        let response = self.process.command_with_id(id, record).await?;
        let response = command_response(control, response)?;
        let data = response.get("data");
        let field = |key: &str| data.and_then(|data| data.get(key));
        let output = field("output").and_then(Value::as_str).ok_or_else(|| {
            PiSessionError::NativeSession("Pi did not report the command output".to_owned())
        })?;
        Ok(PiBashResult {
            output: output.to_owned(),
            exit_code: field("exitCode")
                .and_then(Value::as_i64)
                .and_then(|code| i32::try_from(code).ok()),
            cancelled: field("cancelled").and_then(Value::as_bool) == Some(true),
            truncated: field("truncated").and_then(Value::as_bool) == Some(true),
            full_output_path: field("fullOutputPath")
                .and_then(Value::as_str)
                .map(str::to_owned),
        })
    }

    /// Stops every running [`Self::bash`] command.
    ///
    /// Each stopped command resolves with `cancelled` set. Pi accepts the
    /// request when no command is running.
    pub async fn abort_bash(&self) -> Result<(), PiSessionError> {
        let control = AgentControl::ShellCommand;
        self.require_capability(control)?;
        self.command(control, json!({"type": "abort_bash"})).await?;
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
                return Err(self.invalid_state(
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
            return Err(self.invalid_state(
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
        let (_, response) = self.command_at(control, command).await?;
        Ok(response)
    }

    /// Sends a command and returns its successful response with the
    /// response's stdout position.
    async fn command_at(
        &self,
        control: AgentControl,
        command: Value,
    ) -> Result<(u64, Value), PiSessionError> {
        let (position, response) = self
            .process
            .command_at(self.process.next_command_id(), command)
            .await?;
        Ok((position, command_response(control, response)?))
    }

    /// Sets the status that a command response at `position` established, so
    /// that lifecycle events Pi wrote before that response no longer apply.
    /// `status` must be the guard of `self.status`.
    fn set_status(&self, status: &mut AgentSessionStatus, next: AgentSessionStatus, position: u64) {
        *status = next;
        self.status_position.fetch_max(position, Ordering::Relaxed);
    }
}

/// Returns the directory a transcript export writes into, or why
/// `destination` cannot be a transcript file.
fn export_directory(destination: &Path) -> io::Result<PathBuf> {
    let invalid = |message: &str| io::Error::new(io::ErrorKind::InvalidInput, message.to_owned());
    if !destination.is_absolute() {
        return Err(invalid("choose a full path for the transcript"));
    }
    if destination.file_name().is_none() {
        return Err(invalid("choose a file name for the transcript"));
    }
    if std::fs::symlink_metadata(destination).is_ok_and(|metadata| metadata.is_dir()) {
        return Err(invalid("a folder has that name"));
    }
    match destination.parent() {
        Some(parent) if parent.is_dir() => Ok(parent.to_owned()),
        _ => Err(invalid("the folder for the transcript does not exist")),
    }
}

/// Copies Pi's rendered export at `rendered` into `destination`.
///
/// `rendered` is opened without following a symlink. The copy goes into a new
/// temporary file in `directory`, which `tempfile` creates owner-only. The
/// file is synced and renamed over `destination`, so a reader never sees a
/// partial transcript and a symlink at `destination` is replaced. The
/// temporary file is removed on failure.
fn copy_export(rendered: &Path, directory: &Path, destination: &Path) -> io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::custom_flags(&mut options, libc::O_NOFOLLOW);
    let mut source = options.open(rendered)?;
    let mut copy = tempfile::Builder::new()
        .prefix(".pau-transcript-")
        .suffix(".html")
        .tempfile_in(directory)?;
    io::copy(&mut source, copy.as_file_mut())?;
    copy.as_file().sync_all()?;
    copy.persist(destination)
        .map(drop)
        .map_err(|error| error.error)
}

/// Returns a successful command response, or Pi's rejection as an error.
fn command_response(control: AgentControl, response: Value) -> Result<Value, PiSessionError> {
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
/// there is nothing to send again.
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
        .ok_or_else(|| "the failed turn has no user prompt to send again".to_owned())?;
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
        return Err("the failed prompt has no text to send again".to_owned());
    }
    Ok(text)
}

impl PiSession {
    /// Rejects `control` in `status`. A live session whose Pi stopped
    /// answering gets [`PiProcessError::NotResponding`] instead, so every
    /// control fails the same way however its state check runs.
    fn invalid_state(
        &self,
        control: AgentControl,
        status: AgentSessionStatus,
        reason: &'static str,
    ) -> PiSessionError {
        let ended = matches!(
            status,
            AgentSessionStatus::Stopping | AgentSessionStatus::Stopped | AgentSessionStatus::Failed
        );
        if !ended && let Some(error) = self.process.not_responding() {
            return error.into();
        }
        PiSessionError::Control(AgentControlError::InvalidState {
            control,
            status,
            reason,
        })
    }

    fn not_ready(&self, control: AgentControl, status: AgentSessionStatus) -> PiSessionError {
        self.invalid_state(control, status, "wait for the session to become idle")
    }
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

/// Applies Pi's lifecycle and queue events, and the process exit, to the
/// session's state.
///
/// Events come from [`PiProcess::sequenced_events`] so that each one can be
/// dropped when a command response Pi wrote later has already set the same
/// field. The broadcast subscription only reports the exit.
fn observe_lifecycle(
    mut events: mpsc::UnboundedReceiver<(u64, Value)>,
    mut output: broadcast::Receiver<PiProcessOutput>,
    session: &PiSession,
) {
    let status = Arc::clone(&session.status);
    let status_position = Arc::clone(&session.status_position);
    let queue = Arc::clone(&session.queue);
    let queue_position = Arc::clone(&session.queue_position);
    tokio::spawn(async move {
        loop {
            tokio::select! {
                // Apply the events Pi wrote before it exited, then the exit.
                biased;
                Some((position, event)) = events.recv() => {
                    let kind = event.get("type").and_then(Value::as_str);
                    if kind == Some("queue_update")
                        && let Some(update) = queue_from_value(&event)
                    {
                        let mut current = queue.lock().await;
                        if position > queue_position.load(Ordering::Relaxed) {
                            *current = update;
                            queue_position.store(position, Ordering::Relaxed);
                        }
                    }
                    let next = match kind {
                        Some("agent_start") => AgentSessionStatus::Running,
                        Some("agent_settled") => AgentSessionStatus::Idle,
                        _ => continue,
                    };
                    let mut current = status.lock().await;
                    if position > status_position.load(Ordering::Relaxed)
                        && !matches!(
                            *current,
                            AgentSessionStatus::Stopping
                                | AgentSessionStatus::Stopped
                                | AgentSessionStatus::Failed
                        )
                    {
                        *current = next;
                        status_position.store(position, Ordering::Relaxed);
                    }
                }
                record = output.recv() => match record {
                    Ok(PiProcessOutput::Exit(exit)) => {
                        let mut current = status.lock().await;
                        *current = if exit.requested || *current == AgentSessionStatus::Stopping {
                            AgentSessionStatus::Stopped
                        } else {
                            AgentSessionStatus::Failed
                        };
                        break;
                    }
                    // `PiSession::status` reads the not-responding mark from
                    // the process, so the status here keeps following Pi.
                    Ok(
                        PiProcessOutput::Event(_)
                        | PiProcessOutput::Diagnostic(_)
                        | PiProcessOutput::NotResponding
                        | PiProcessOutput::Responding,
                    )
                    | Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => break,
                },
            }
        }
    });
}
