//! Terminal sessions and embedded Neovim integration.

mod pty;

pub use pau_core::terminal::{TerminalSignal, TerminalSize, TerminalStatus};
pub use pty::{Terminal, TerminalCommand, TerminalError, TerminalExit, TerminalOutput};

/// Identifies the terminal subsystem in diagnostics.
pub const CRATE_NAME: &str = "pau-term";
