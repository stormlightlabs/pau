//! Whether the agent executables Pau drives are installed and usable.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The readiness of one agent executable.
///
/// An agent is `ready` only when it was found, runs a supported version, and,
/// for Pi, reports at least one available model. `reason` is set exactly when
/// the agent is not ready and is written for the person using Pau.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AgentReadiness {
    /// The agent's identifier, such as `pi`.
    pub agent: String,
    /// Whether an executable was located and could be inspected.
    pub found: bool,
    /// The executable Pau would launch, when one was located.
    pub executable_path: Option<String>,
    /// The version the executable reported, when it reported one.
    pub version: Option<String>,
    /// Whether the version is one Pau supports. False when it is unknown.
    pub version_supported: bool,
    /// How many models the agent reports. Unset when the agent has no model
    /// check or the check did not complete.
    pub model_count: Option<u32>,
    /// Whether the agent can start a session.
    pub ready: bool,
    /// Why the agent is not ready, with the step that fixes it.
    pub reason: Option<String>,
}

/// The readiness of every supported agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AgentReadinessReport {
    /// One entry per supported agent, in a stable order.
    pub agents: Vec<AgentReadiness>,
}
