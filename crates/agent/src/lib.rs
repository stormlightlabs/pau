//! Agent adapter contracts and shared process supervision.

mod events;

pub use events::{AgentEvent, AgentEventKind, AgentSessionStatus};

/// Identifies the agent subsystem in diagnostics.
pub const CRATE_NAME: &str = "pau-agent";
