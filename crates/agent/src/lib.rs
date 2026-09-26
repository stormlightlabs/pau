//! Agent adapter contracts and shared process supervision.

mod claude;
mod controls;
mod events;
mod mcp;

pub use claude::{
    CLAUDE_BRIDGE_CAPABILITIES, CLAUDE_BRIDGE_PROTOCOL_VERSION, ClaudeAdapterDiagnostic,
    ClaudeBridgeCommandError, ClaudeBridgeDecodeError, ClaudeBridgeDiagnostic,
    ClaudeBridgeDiagnosticSource, ClaudeBridgeEvent, ClaudeBridgeExit, ClaudeBridgeFrame,
    ClaudeBridgeOutput, ClaudeBridgeProcess, ClaudeBridgeProcessError, ClaudeBridgeResponse,
    ClaudeBridgeShutdownTimeouts, ClaudeDiagnosticLevel, ClaudeEventPayload, ClaudeSession,
    ClaudeSessionError, StartClaudeBridgeOptions, decode_claude_bridge_diagnostic,
    decode_claude_bridge_frame, project_claude_event,
};
pub use controls::{AgentCapabilities, AgentControl, AgentControlError, PromptQueueChoice};
pub use events::{AgentEvent, AgentEventKind, AgentSessionStatus};
pub use mcp::{
    DiscoverClaudeMcpOptions, DiscoveredMcpServer, McpAgent, McpConfigurationDiscovery,
    McpConfigurationDocument, McpConfigurationKind, McpConfigurationScope, McpDiscoveryError,
    McpServerSource, discover_claude_mcp, merge_mcp_layers,
};

/// Identifies the agent subsystem in diagnostics.
pub const CRATE_NAME: &str = "pau-agent";
