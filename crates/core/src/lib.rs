//! Domain types and application services shared by Pau backends.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub mod persistence;

/// Response returned by the backend version endpoint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct VersionResponse {
    /// Running backend version.
    pub version: String,
}

/// Stable kinds in the server event envelope.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
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
