/** Native agent whose MCP configuration was discovered. */
export type McpAgent = 'pi' | 'claude';

/** Native scope reported for an MCP configuration source. */
export type McpSourceScope = 'user' | 'project' | 'local' | 'package';

/** One native MCP configuration source. */
export type McpSource = { path: string; scope: McpSourceScope; serverCount: number };

/** Availability of the native MCP client selected for an agent. */
export type McpClientAvailability =
	{ state: 'ready'; version?: string } | { state: 'absent' | 'disabled'; actionLabel: string; message: string };

/** Runtime state reported by an agent's native MCP client. */
export type McpServerStatus = 'not-connected' | 'connecting' | 'connected' | 'needs-auth' | 'failed' | 'disabled';

/** One editable native MCP server and its redacted runtime diagnostics. */
export type McpServer = {
	name: string;
	transport: 'stdio' | 'http' | 'sse' | 'websocket';
	scope: McpSourceScope;
	sourcePath: string;
	enabled: boolean;
	status: McpServerStatus;
	diagnostic?: string;
	negotiatedCapabilities: string[];
};

/** Editable native MCP configuration and runtime state. */
export type McpConfigurationViewModel = {
	agent: McpAgent;
	availability: McpClientAvailability;
	managedEnabled: boolean;
	nativeConfigurationActive: boolean;
	serverCount: number;
	servers: McpServer[];
	sources: McpSource[];
};
