//! Domain types and application services shared by Pau backends.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub mod diagnostics;
pub mod persistence;
pub mod resource_monitor;
pub mod workspace;

/// Response returned by the backend health endpoint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct HealthResponse {
    /// Whether the backend can accept requests.
    pub healthy: bool,
}

/// Response returned by the backend version endpoint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct VersionResponse {
    /// Running backend version.
    pub version: String,
}

/// Stable kinds in the server event envelope.
#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ServerEventKind {
    /// A workspace was registered or changed.
    WorkspaceChanged,
    /// An agent session was registered or changed.
    SessionChanged,
}

/// Stable envelope sent to browser and desktop clients.
///
/// Adapter-specific event data remains encoded in `payload` until its fields
/// have shared semantics across adapters.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ServerEvent {
    /// Monotonic event number used for reconnect replay.
    pub sequence: u64,
    /// RFC 3339 timestamp assigned by the server.
    pub timestamp: String,
    /// Workspace associated with the event, when applicable.
    pub workspace_id: Option<String>,
    /// Session associated with the event, when applicable.
    pub session_id: Option<String>,
    /// Stable event classification.
    pub kind: ServerEventKind,
    /// Adapter-owned JSON payload.
    pub payload: String,
}

/// Current server state at one event-sequence boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ServerSnapshot {
    /// Last event included in this snapshot.
    pub sequence: u64,
    /// Latest state-bearing event for each workspace and session.
    pub events: Vec<ServerEvent>,
}

/// Messages sent over the authenticated server event stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(tag = "type", rename_all = "snake_case")]
pub enum ServerStreamMessage {
    /// Full state used when no usable replay checkpoint exists.
    Snapshot {
        /// State captured at a stable event-sequence boundary.
        snapshot: ServerSnapshot,
    },
    /// One event newer than the client's checkpoint or snapshot.
    Event {
        /// Sequenced state change.
        event: ServerEvent,
    },
}
