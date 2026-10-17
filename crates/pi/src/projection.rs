use pau_agent::{AgentEvent, AgentEventKind, AgentSessionStatus};
use serde_json::{Map, Value};

/// A message content block reconstructed from Pi's streaming events.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PiProjectedContent {
    /// Visible assistant or user text.
    Text(String),
    /// Assistant reasoning text.
    Thinking(String),
    /// A tool call requested by the model.
    ToolCall {
        /// Pi's tool-call identifier.
        id: String,
        /// The registered tool name.
        name: String,
        /// Complete arguments when Pi has supplied them.
        arguments: Value,
        /// Serialized arguments received before the complete value.
        streamed_arguments: String,
    },
    /// A content block not interpreted by this adapter version.
    Unknown(Value),
}

/// A display projection of a native Pi message.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PiProjectedMessage {
    /// Pi's message role.
    pub role: String,
    /// Content used for incremental display.
    pub content: Vec<PiProjectedContent>,
    /// The latest native message. Completed messages retain every unknown field.
    pub native: Value,
    /// Whether `native` came from the authoritative `message_end` event.
    pub complete: bool,
}

/// The point reached in a message lifecycle.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PiMessagePhase {
    /// Pi emitted `message_start`.
    Started,
    /// Pi emitted the authoritative `message_end` value.
    Completed,
}

/// The point reached in a tool-call lifecycle.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PiToolCallPhase {
    /// The model started streaming a tool call.
    Started,
    /// The model supplied the complete tool call.
    Completed,
    /// Pi started executing the tool.
    Executing,
}

/// The point reached in a tool-result lifecycle.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PiToolResultPhase {
    /// A tool supplied its latest partial result.
    Partial,
    /// Tool execution finished.
    Completed,
}

/// Pi run lifecycle data projected into Pau's session states.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PiLifecycleEvent {
    /// A low-level agent run started.
    AgentStarted,
    /// A low-level run ended, but Pi may still have settlement work.
    AgentEnded { will_retry: bool },
    /// Pi finished retries, callbacks, compaction, and queued work.
    AgentSettled,
}

/// Why Pi started compacting context.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PiCompactionReason {
    /// The operator requested compaction.
    Manual,
    /// Context use crossed the configured automatic-compaction threshold.
    Threshold,
    /// The provider rejected the context as too large; Pi compacts and retries.
    Overflow,
    /// A reason added by a newer Pi version.
    Other(String),
}

impl PiCompactionReason {
    fn from_native(event: &Value) -> Self {
        match event.get("reason").and_then(Value::as_str) {
            Some("manual") => Self::Manual,
            Some("threshold") => Self::Threshold,
            Some("overflow") => Self::Overflow,
            Some(other) => Self::Other(other.to_owned()),
            None => Self::Other(String::new()),
        }
    }

    /// Reports whether Pi started this compaction without an operator request.
    pub fn is_automatic(&self) -> bool {
        !matches!(self, Self::Manual)
    }
}

/// The summary Pi wrote when compaction succeeded.
///
/// Pi may change usage and extension details between versions, so known
/// fields are optional and `native` keeps the complete value.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PiCompactionResult {
    /// The summary that replaces older context.
    pub summary: String,
    /// The first session entry kept verbatim after the summary.
    pub first_kept_entry_id: Option<String>,
    /// Context tokens before compaction.
    pub tokens_before: Option<u64>,
    /// Pi's heuristic estimate of context tokens after compaction.
    pub estimated_tokens_after: Option<u64>,
    /// The complete native result, including usage and extension details.
    pub native: Value,
}

impl PiCompactionResult {
    /// Reads a result from a `compact` response or `compaction_end` event.
    pub fn from_native(result: &Value) -> Self {
        Self {
            summary: result
                .get("summary")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            first_kept_entry_id: result
                .get("firstKeptEntryId")
                .and_then(Value::as_str)
                .map(str::to_owned),
            tokens_before: result.get("tokensBefore").and_then(Value::as_u64),
            estimated_tokens_after: result.get("estimatedTokensAfter").and_then(Value::as_u64),
            native: result.clone(),
        }
    }
}

/// How a compaction attempt ended.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PiCompactionOutcome {
    /// Pi replaced older context with a summary.
    Completed(PiCompactionResult),
    /// An abort request cancelled compaction.
    Aborted,
    /// Compaction failed and the context was left unchanged.
    Failed {
        /// Pi's description of the failure.
        message: String,
    },
}

/// Adapter-owned payload carried by a `pau-agent` event.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PiEventPayload {
    /// A run lifecycle event and the resulting Pau status.
    Lifecycle {
        /// Native lifecycle meaning.
        event: PiLifecycleEvent,
        /// Session status after applying the event.
        status: AgentSessionStatus,
    },
    /// A started or completed message.
    Message {
        /// Message lifecycle phase.
        phase: PiMessagePhase,
        /// Current message projection.
        message: PiProjectedMessage,
    },
    /// A streamed text update.
    TextDelta {
        /// Message content-block index.
        content_index: usize,
        /// Delta text, or complete block text when `authoritative` is true.
        text: String,
        /// Whether the value replaces the streamed block.
        authoritative: bool,
    },
    /// A streamed reasoning update.
    ThinkingDelta {
        /// Message content-block index.
        content_index: usize,
        /// Delta text, or complete block text when `authoritative` is true.
        text: String,
        /// Whether the value replaces the streamed block.
        authoritative: bool,
    },
    /// A model tool call or the start of its execution.
    ToolCall {
        /// Tool-call lifecycle phase.
        phase: PiToolCallPhase,
        /// Pi's tool-call identifier.
        id: String,
        /// Registered tool name.
        name: String,
        /// Arguments supplied for execution.
        arguments: Value,
    },
    /// Partial or completed tool output.
    ToolResult {
        /// Tool-result lifecycle phase.
        phase: PiToolResultPhase,
        /// Pi's tool-call identifier.
        id: String,
        /// Registered tool name.
        name: String,
        /// Native tool result.
        result: Value,
        /// Whether the completed tool reported an error.
        is_error: bool,
    },
    /// Pi started compacting context.
    CompactionStarted {
        /// Why compaction started.
        reason: PiCompactionReason,
    },
    /// Pi finished, cancelled, or failed a compaction attempt.
    CompactionEnded {
        /// Why compaction started.
        reason: PiCompactionReason,
        /// The result, cancellation, or failure.
        outcome: PiCompactionOutcome,
        /// Whether Pi will retry the overflowed prompt after this compaction.
        will_retry: bool,
    },
    /// Pi scheduled an automatic retry after a transient provider error.
    AutoRetryStarted {
        /// One-based attempt number.
        attempt: u64,
        /// Attempts Pi makes before giving up.
        max_attempts: u64,
        /// Delay before the attempt runs.
        delay_ms: u64,
        /// The provider error that triggered the retry.
        error_message: String,
    },
    /// Automatic retry succeeded or ran out of attempts.
    AutoRetryEnded {
        /// Whether the final attempt succeeded.
        success: bool,
        /// The last attempt number.
        attempt: u64,
        /// The error that ended retrying when `success` is false.
        final_error: Option<String>,
    },
}

/// Reduces native Pi session events into display state and `pau-agent` events.
///
/// Unknown event types and fields are ignored. Completed messages replace the
/// active streamed projection so provider corrections become authoritative.
#[derive(Debug)]
pub struct PiEventReducer {
    status: AgentSessionStatus,
    messages: Vec<PiProjectedMessage>,
    active_message: Option<usize>,
    /// Manual compaction runs outside an agent run, so the reducer marks the
    /// session running for its duration and restores idle when it ends.
    compacting_from_idle: bool,
}

impl Default for PiEventReducer {
    fn default() -> Self {
        Self {
            status: AgentSessionStatus::Idle,
            messages: Vec::new(),
            active_message: None,
            compacting_from_idle: false,
        }
    }
}

impl PiEventReducer {
    /// Returns the current Pau session status.
    pub fn status(&self) -> AgentSessionStatus {
        self.status
    }

    /// Returns messages projected so far, including an active partial message.
    pub fn messages(&self) -> &[PiProjectedMessage] {
        &self.messages
    }

    /// Applies one native Pi event and returns zero or one projected event.
    pub fn reduce(&mut self, event: &Value) -> Option<AgentEvent<PiEventPayload>> {
        let event_type = event.get("type")?.as_str()?;
        match event_type {
            "agent_start" => {
                self.status = AgentSessionStatus::Running;
                Some(lifecycle_event(PiLifecycleEvent::AgentStarted, self.status))
            }
            "agent_end" => Some(lifecycle_event(
                PiLifecycleEvent::AgentEnded {
                    will_retry: event
                        .get("willRetry")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                },
                self.status,
            )),
            "agent_settled" => {
                self.status = AgentSessionStatus::Idle;
                Some(lifecycle_event(PiLifecycleEvent::AgentSettled, self.status))
            }
            "message_start" => self.start_message(event.get("message")?),
            "message_update" => self.update_message(event.get("assistantMessageEvent")?),
            "message_end" => self.complete_message(event.get("message")?),
            "tool_execution_start" => Some(tool_call_execution_event(event)?),
            "tool_execution_update" => {
                Some(tool_result_event(event, PiToolResultPhase::Partial, false)?)
            }
            "tool_execution_end" => Some(tool_result_event(
                event,
                PiToolResultPhase::Completed,
                event
                    .get("isError")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            )?),
            "compaction_start" => {
                if self.status == AgentSessionStatus::Idle {
                    self.status = AgentSessionStatus::Running;
                    self.compacting_from_idle = true;
                }
                Some(AgentEvent::new(
                    AgentEventKind::Compaction,
                    PiEventPayload::CompactionStarted {
                        reason: PiCompactionReason::from_native(event),
                    },
                ))
            }
            "compaction_end" => {
                if std::mem::take(&mut self.compacting_from_idle) {
                    self.status = AgentSessionStatus::Idle;
                }
                Some(compaction_end_event(event))
            }
            "auto_retry_start" => Some(AgentEvent::new(
                AgentEventKind::Lifecycle,
                PiEventPayload::AutoRetryStarted {
                    attempt: event.get("attempt").and_then(Value::as_u64).unwrap_or(0),
                    max_attempts: event
                        .get("maxAttempts")
                        .and_then(Value::as_u64)
                        .unwrap_or(0),
                    delay_ms: event.get("delayMs").and_then(Value::as_u64).unwrap_or(0),
                    error_message: event
                        .get("errorMessage")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                },
            )),
            "auto_retry_end" => Some(AgentEvent::new(
                AgentEventKind::Lifecycle,
                PiEventPayload::AutoRetryEnded {
                    success: event
                        .get("success")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    attempt: event.get("attempt").and_then(Value::as_u64).unwrap_or(0),
                    final_error: event
                        .get("finalError")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                },
            )),
            _ => None,
        }
    }

    fn start_message(&mut self, message: &Value) -> Option<AgentEvent<PiEventPayload>> {
        let projection = project_message(message, false)?;
        self.messages.push(projection.clone());
        self.active_message = Some(self.messages.len() - 1);
        Some(AgentEvent::new(
            AgentEventKind::Message,
            PiEventPayload::Message {
                phase: PiMessagePhase::Started,
                message: projection,
            },
        ))
    }

    fn complete_message(&mut self, message: &Value) -> Option<AgentEvent<PiEventPayload>> {
        let projection = project_message(message, true)?;
        if let Some(index) = self.active_message.take() {
            self.messages[index] = projection.clone();
        } else {
            self.messages.push(projection.clone());
        }
        Some(AgentEvent::new(
            AgentEventKind::Message,
            PiEventPayload::Message {
                phase: PiMessagePhase::Completed,
                message: projection,
            },
        ))
    }

    fn update_message(&mut self, update: &Value) -> Option<AgentEvent<PiEventPayload>> {
        let update_type = update.get("type")?.as_str()?;
        let content_index = update
            .get("contentIndex")
            .and_then(Value::as_u64)
            .and_then(|index| usize::try_from(index).ok());

        match update_type {
            "text_start" => {
                self.set_content(content_index?, PiProjectedContent::Text(String::new()));
                None
            }
            "text_delta" => {
                let index = content_index?;
                let delta = update.get("delta")?.as_str()?;
                self.append_text(index, delta, false);
                Some(text_event(index, delta, false, false))
            }
            "text_end" => {
                let index = content_index?;
                let content = update.get("content")?.as_str()?;
                self.set_content(index, PiProjectedContent::Text(content.to_owned()));
                Some(text_event(index, content, true, false))
            }
            "thinking_start" => {
                self.set_content(content_index?, PiProjectedContent::Thinking(String::new()));
                None
            }
            "thinking_delta" => {
                let index = content_index?;
                let delta = update.get("delta")?.as_str()?;
                self.append_text(index, delta, true);
                Some(text_event(index, delta, false, true))
            }
            "thinking_end" => {
                let index = content_index?;
                let content = update.get("content")?.as_str()?;
                self.set_content(index, PiProjectedContent::Thinking(content.to_owned()));
                Some(text_event(index, content, true, true))
            }
            "toolcall_start" => {
                let index = content_index?;
                let id = update.get("id")?.as_str()?.to_owned();
                let name = update.get("toolName")?.as_str()?.to_owned();
                self.set_content(
                    index,
                    PiProjectedContent::ToolCall {
                        id: id.clone(),
                        name: name.clone(),
                        arguments: Value::Object(Map::new()),
                        streamed_arguments: String::new(),
                    },
                );
                Some(tool_call_event(
                    PiToolCallPhase::Started,
                    id,
                    name,
                    Value::Object(Map::new()),
                ))
            }
            "toolcall_delta" => {
                let index = content_index?;
                let delta = update.get("delta")?.as_str()?;
                if let Some(PiProjectedContent::ToolCall {
                    streamed_arguments, ..
                }) = self.content_mut(index)
                {
                    streamed_arguments.push_str(delta);
                }
                None
            }
            "toolcall_end" => {
                let index = content_index?;
                let call = update.get("toolCall")?;
                let id = call.get("id")?.as_str()?.to_owned();
                let name = call.get("name")?.as_str()?.to_owned();
                let arguments = call.get("arguments").cloned().unwrap_or(Value::Null);
                self.set_content(
                    index,
                    PiProjectedContent::ToolCall {
                        id: id.clone(),
                        name: name.clone(),
                        arguments: arguments.clone(),
                        streamed_arguments: String::new(),
                    },
                );
                Some(tool_call_event(
                    PiToolCallPhase::Completed,
                    id,
                    name,
                    arguments,
                ))
            }
            _ => None,
        }
    }

    fn set_content(&mut self, index: usize, content: PiProjectedContent) {
        let Some(message) = self
            .active_message
            .and_then(|index| self.messages.get_mut(index))
        else {
            return;
        };
        while message.content.len() <= index {
            message
                .content
                .push(PiProjectedContent::Unknown(Value::Null));
        }
        message.content[index] = content;
    }

    fn content_mut(&mut self, index: usize) -> Option<&mut PiProjectedContent> {
        let message = self
            .active_message
            .and_then(|active| self.messages.get_mut(active))?;
        message.content.get_mut(index)
    }

    fn append_text(&mut self, index: usize, delta: &str, thinking: bool) {
        let expected = if thinking {
            PiProjectedContent::Thinking(String::new())
        } else {
            PiProjectedContent::Text(String::new())
        };
        if self.content_mut(index).is_none() {
            self.set_content(index, expected);
        }
        match self.content_mut(index) {
            Some(PiProjectedContent::Text(text)) if !thinking => text.push_str(delta),
            Some(PiProjectedContent::Thinking(text)) if thinking => text.push_str(delta),
            _ => {}
        }
    }
}

fn lifecycle_event(
    event: PiLifecycleEvent,
    status: AgentSessionStatus,
) -> AgentEvent<PiEventPayload> {
    AgentEvent::new(
        AgentEventKind::Lifecycle,
        PiEventPayload::Lifecycle { event, status },
    )
}

fn text_event(
    content_index: usize,
    text: &str,
    authoritative: bool,
    thinking: bool,
) -> AgentEvent<PiEventPayload> {
    let (kind, payload) = if thinking {
        (
            AgentEventKind::ThinkingDelta,
            PiEventPayload::ThinkingDelta {
                content_index,
                text: text.to_owned(),
                authoritative,
            },
        )
    } else {
        (
            AgentEventKind::TextDelta,
            PiEventPayload::TextDelta {
                content_index,
                text: text.to_owned(),
                authoritative,
            },
        )
    };
    AgentEvent::new(kind, payload)
}

fn tool_call_event(
    phase: PiToolCallPhase,
    id: String,
    name: String,
    arguments: Value,
) -> AgentEvent<PiEventPayload> {
    AgentEvent::new(
        AgentEventKind::ToolCall,
        PiEventPayload::ToolCall {
            phase,
            id,
            name,
            arguments,
        },
    )
}

fn tool_call_execution_event(event: &Value) -> Option<AgentEvent<PiEventPayload>> {
    Some(tool_call_event(
        PiToolCallPhase::Executing,
        event.get("toolCallId")?.as_str()?.to_owned(),
        event.get("toolName")?.as_str()?.to_owned(),
        event.get("args").cloned().unwrap_or(Value::Null),
    ))
}

fn tool_result_event(
    event: &Value,
    phase: PiToolResultPhase,
    is_error: bool,
) -> Option<AgentEvent<PiEventPayload>> {
    let result_field = match phase {
        PiToolResultPhase::Partial => "partialResult",
        PiToolResultPhase::Completed => "result",
    };
    Some(AgentEvent::new(
        AgentEventKind::ToolResult,
        PiEventPayload::ToolResult {
            phase,
            id: event.get("toolCallId")?.as_str()?.to_owned(),
            name: event.get("toolName")?.as_str()?.to_owned(),
            result: event.get(result_field).cloned().unwrap_or(Value::Null),
            is_error,
        },
    ))
}

/// Projects every `compaction_end`, including malformed failures, so a failed
/// compaction is never silently dropped.
fn compaction_end_event(event: &Value) -> AgentEvent<PiEventPayload> {
    let outcome = match event.get("result") {
        Some(result) if result.is_object() => {
            PiCompactionOutcome::Completed(PiCompactionResult::from_native(result))
        }
        _ if event.get("aborted").and_then(Value::as_bool) == Some(true) => {
            PiCompactionOutcome::Aborted
        }
        _ => PiCompactionOutcome::Failed {
            message: event
                .get("errorMessage")
                .and_then(Value::as_str)
                .unwrap_or("Pi did not report a compaction result")
                .to_owned(),
        },
    };
    AgentEvent::new(
        AgentEventKind::Compaction,
        PiEventPayload::CompactionEnded {
            reason: PiCompactionReason::from_native(event),
            outcome,
            will_retry: event
                .get("willRetry")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        },
    )
}

fn project_message(message: &Value, complete: bool) -> Option<PiProjectedMessage> {
    let role = message.get("role")?.as_str()?.to_owned();
    let content = match message.get("content") {
        Some(Value::String(text)) => vec![PiProjectedContent::Text(text.clone())],
        Some(Value::Array(blocks)) => blocks.iter().map(project_content).collect(),
        _ => Vec::new(),
    };
    Some(PiProjectedMessage {
        role,
        content,
        native: message.clone(),
        complete,
    })
}

fn project_content(content: &Value) -> PiProjectedContent {
    match content.get("type").and_then(Value::as_str) {
        Some("text") => PiProjectedContent::Text(
            content
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        ),
        Some("thinking") => PiProjectedContent::Thinking(
            content
                .get("thinking")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        ),
        Some("toolCall") => PiProjectedContent::ToolCall {
            id: content
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            name: content
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            arguments: content.get("arguments").cloned().unwrap_or(Value::Null),
            streamed_arguments: String::new(),
        },
        _ => PiProjectedContent::Unknown(content.clone()),
    }
}
