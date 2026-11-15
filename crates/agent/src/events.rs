/// The state of an agent session as observed by Pau.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AgentSessionStatus {
    /// The process is starting.
    Starting,
    /// The process can accept a new prompt.
    Idle,
    /// The agent is processing work or settling callbacks.
    Running,
    /// The agent is waiting for operator input.
    Waiting,
    /// The process still runs but stopped answering commands. Every later
    /// command fails at once; stopping the session still works.
    NotResponding,
    /// The process is shutting down.
    Stopping,
    /// The process has stopped.
    Stopped,
    /// The process or adapter failed.
    Failed,
}

/// Stable categories used to route adapter-owned event payloads.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AgentEventKind {
    /// A session or run lifecycle change.
    Lifecycle,
    /// A message started or reached its authoritative final form.
    Message,
    /// Streamed assistant text.
    TextDelta,
    /// Streamed assistant reasoning.
    ThinkingDelta,
    /// A model tool call or its execution state.
    ToolCall,
    /// A partial or completed tool result.
    ToolResult,
    /// Context compaction started or finished.
    Compaction,
}

/// An event category paired with a payload owned by an agent adapter.
///
/// The category is intentionally small. Adapter payloads retain native details
/// that do not yet have semantics shared by multiple agents.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentEvent<P> {
    /// The stable category used by event consumers.
    pub kind: AgentEventKind,
    /// Adapter-specific event data.
    pub payload: P,
}

impl<P> AgentEvent<P> {
    /// Creates an event with its stable category and adapter payload.
    pub fn new(kind: AgentEventKind, payload: P) -> Self {
        Self { kind, payload }
    }
}
