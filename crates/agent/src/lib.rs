//! Agent adapter contracts and shared process supervision.

mod agents;
mod claude;
mod controls;
mod discovery;
mod events;
mod mcp;
mod process_group;

pub use agents::AgentKind;
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
    AgentCapabilities, AgentControl, AgentControlError, AgentMessageQueue, PromptQueueChoice,
    ThinkingLevel,
};
pub use discovery::{
    CLAUDE_BRIDGE_COMMAND, ClaudeDiscovery, ClaudeDiscoveryError, ClaudeDiscoveryErrorCode,
    DiscoverClaudeOptions, MIN_SUPPORTED_CLAUDE_VERSION, absolute_path_entries, discover_claude,
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
#[cfg(unix)]
pub use process_group::signal_process_group;
pub use process_group::{ProcessGroup, lead_process_group};

/// Identifies the agent subsystem in diagnostics.
pub const CRATE_NAME: &str = "pau-agent";
