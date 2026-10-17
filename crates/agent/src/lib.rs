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
pub use controls::{
    AgentCapabilities, AgentControl, AgentControlError, PromptQueueChoice, ThinkingLevel,
};
pub use events::{AgentEvent, AgentEventKind, AgentSessionStatus};
pub use mcp::{
    ClaudeMcpOperation, ClaudeMcpOptions, DiscoverClaudeMcpOptions, DiscoveredMcpServer,
    McpAdapterCapabilities, McpAgent, McpConfigurationDiscovery, McpConfigurationDocument,
    McpConfigurationKind, McpConfigurationScope, McpDiagnostic, McpDiagnosticLevel,
    McpDiscoveryError, McpEditError, McpNegotiatedCapabilities, McpOperationResult, McpServerEdit,
    McpServerSource, claude_mcp_capabilities, discover_claude_mcp, edit_mcp_server,
    merge_mcp_layers, redact_mcp_value, run_claude_mcp_operation, set_claude_server_enabled,
};

/// Identifies the agent subsystem in diagnostics.
pub const CRATE_NAME: &str = "pau-agent";
