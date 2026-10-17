use crate::AgentSessionStatus;
use std::error::Error;
use std::fmt;

/// A session operation that an agent adapter may support.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AgentControl {
    /// Start work or queue a prompt.
    Prompt,
    /// Queue work after the active run finishes.
    FollowUp,
    /// Change direction during the active run.
    Steer,
    /// Abort the active run without stopping the session process.
    Interrupt,
    /// Read or clear the queued steer and follow-up messages.
    MessageQueue,
    /// Select a provider model.
    SelectModel,
    /// Select how much reasoning the model applies.
    SetThinkingLevel,
    /// Stop the session process.
    Stop,
}

impl fmt::Display for AgentControl {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = match self {
            Self::Prompt => "prompt",
            Self::FollowUp => "follow-up",
            Self::Steer => "steer",
            Self::Interrupt => "interrupt",
            Self::MessageQueue => "message queue",
            Self::SelectModel => "model selection",
            Self::SetThinkingLevel => "thinking-level selection",
            Self::Stop => "stop",
        };
        formatter.write_str(name)
    }
}

/// Controls advertised by one agent adapter.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct AgentCapabilities {
    /// Whether the adapter accepts prompts.
    pub prompt: bool,
    /// Whether the adapter can queue follow-up work.
    pub follow_up: bool,
    /// Whether the adapter can steer an active run.
    pub steer: bool,
    /// Whether the adapter can interrupt an active run.
    pub interrupt: bool,
    /// Whether the adapter exposes and can clear its queued messages.
    pub message_queue: bool,
    /// Whether the adapter can select a model.
    pub model_selection: bool,
    /// Whether the adapter can change the thinking level.
    pub thinking_level: bool,
    /// Whether the adapter can stop its session process.
    pub stop: bool,
}

impl AgentCapabilities {
    /// Reports whether one control is available.
    pub fn supports(self, control: AgentControl) -> bool {
        match control {
            AgentControl::Prompt => self.prompt,
            AgentControl::FollowUp => self.follow_up,
            AgentControl::Steer => self.steer,
            AgentControl::Interrupt => self.interrupt,
            AgentControl::MessageQueue => self.message_queue,
            AgentControl::SelectModel => self.model_selection,
            AgentControl::SetThinkingLevel => self.thinking_level,
            AgentControl::Stop => self.stop,
        }
    }
}

/// Messages waiting in an agent's steer and follow-up queues.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct AgentMessageQueue {
    /// Messages delivered after the current assistant turn and its tool calls.
    pub steering: Vec<String>,
    /// Messages delivered after all current work finishes.
    pub follow_up: Vec<String>,
}

/// How a prompt sent during an active run enters Pi's queues.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PromptQueueChoice {
    /// Deliver the prompt after the current assistant turn and its tool calls.
    Steer,
    /// Deliver the prompt after all current work finishes.
    FollowUp,
}

/// A reasoning effort level an agent may apply to model turns.
///
/// A model that cannot reason, or that lacks a requested level, may clamp the
/// level to the nearest one it supports.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ThinkingLevel {
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
    ExtraHigh,
    /// The highest reasoning level a model offers.
    Max,
}

impl ThinkingLevel {
    /// The level name used by Pi's RPC protocol.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Minimal => "minimal",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::ExtraHigh => "xhigh",
            Self::Max => "max",
        }
    }
}

/// A control rejected before or by an agent adapter.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AgentControlError {
    /// The adapter did not advertise this operation.
    Unsupported { control: AgentControl },
    /// The session state does not admit this operation.
    InvalidState {
        /// The rejected operation.
        control: AgentControl,
        /// The state observed when the operation was requested.
        status: AgentSessionStatus,
        /// A concrete condition the caller can correct.
        reason: &'static str,
    },
    /// The native agent rejected the command.
    Rejected {
        /// The rejected operation.
        control: AgentControl,
        /// The native error message.
        message: String,
    },
}

impl fmt::Display for AgentControlError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unsupported { control } => {
                write!(formatter, "this agent does not support {control}")
            }
            Self::InvalidState {
                control,
                status,
                reason,
            } => write!(
                formatter,
                "cannot {control} while the session is {status:?}: {reason}"
            ),
            Self::Rejected { control, message } => {
                write!(formatter, "the agent rejected {control}: {message}")
            }
        }
    }
}

impl Error for AgentControlError {}
