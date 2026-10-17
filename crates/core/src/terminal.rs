//! Wire types for terminal sessions.
//!
//! `pau-term` owns the PTY and its process. These types describe a terminal to
//! clients and carry the commands that clients send to it.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Character-cell dimensions of a terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct TerminalSize {
    /// Number of columns. Must be positive.
    pub cols: u16,
    /// Number of rows. Must be positive.
    pub rows: u16,
}

/// Signals a client may send to a terminal's foreground process group.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum TerminalSignal {
    /// `SIGINT`, as sent by Control-C.
    Interrupt,
    /// `SIGQUIT`, as sent by Control-backslash.
    Quit,
    /// `SIGTSTP`, as sent by Control-Z.
    Suspend,
    /// `SIGCONT`, which resumes a suspended job.
    Continue,
    /// `SIGHUP`, which reports that the terminal has gone away.
    Hangup,
    /// `SIGTERM`, which asks the process to exit.
    Terminate,
    /// `SIGKILL`, which ends the process without cleanup.
    Kill,
}

/// Whether the terminal's shell is still running.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "state", rename_all = "snake_case")]
#[ts(tag = "state", rename_all = "snake_case")]
pub enum TerminalStatus {
    /// The shell process has not exited.
    Running,
    /// The shell process exited.
    Exited {
        /// Exit code reported by the platform. A signal exit reports `1`.
        exit_code: u32,
        /// Name of the signal that ended the process, when one did.
        signal: Option<String>,
    },
}

/// A terminal session as reported to clients.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct TerminalInfo {
    /// Stable terminal identifier.
    pub id: String,
    /// Workspace whose root is the terminal's working directory.
    pub workspace_id: String,
    /// Program and arguments that started the terminal.
    pub command: Vec<String>,
    /// Current dimensions.
    pub size: TerminalSize,
    /// Running or exit state.
    pub status: TerminalStatus,
}

/// Request body that opens a terminal in a workspace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct CreateTerminalRequest {
    /// Workspace whose root becomes the working directory.
    pub workspace_id: String,
    /// Program and arguments. The user's `$SHELL` runs when this is absent.
    pub command: Option<Vec<String>>,
    /// Initial dimensions.
    pub size: TerminalSize,
}

/// Request body that sends a signal to a terminal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct TerminalSignalRequest {
    /// Signal to deliver.
    pub signal: TerminalSignal,
}

/// Text control messages a client sends on a terminal stream.
///
/// Binary frames on the same stream carry raw terminal input.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(tag = "type", rename_all = "snake_case")]
pub enum TerminalClientMessage {
    /// Changes the terminal dimensions.
    Resize {
        /// New dimensions.
        size: TerminalSize,
    },
    /// Delivers a signal to the foreground process group.
    Signal {
        /// Signal to deliver.
        signal: TerminalSignal,
    },
}

/// Text control messages the server sends on a terminal stream.
///
/// Binary frames on the same stream carry raw terminal output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(tag = "type", rename_all = "snake_case")]
pub enum TerminalServerMessage {
    /// The shell exited and no more output will follow.
    Exited {
        /// Final status.
        status: TerminalStatus,
    },
}
