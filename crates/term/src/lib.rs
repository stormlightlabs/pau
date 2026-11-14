//! Terminal sessions and embedded Neovim integration.

mod modes;
mod pty;
mod scrollback;

pub use pau_core::terminal::{TerminalSignal, TerminalSize, TerminalStatus};
pub use pty::{Terminal, TerminalCommand, TerminalError, TerminalExit, TerminalOutput};
pub use scrollback::{
    AttachedOutput, LIVE_CHUNKS, SCROLLBACK_BYTES, TerminalAttachment, TerminalScrollback,
};

/// Identifies the terminal subsystem in diagnostics.
pub const CRATE_NAME: &str = "pau-term";
