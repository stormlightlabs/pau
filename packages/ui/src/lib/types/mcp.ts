/** Native agent whose MCP configuration was discovered. */
export type McpAgent = 'pi' | 'claude';

/** Native scope reported for an MCP configuration source. */
export type McpSourceScope = 'user' | 'project' | 'local' | 'package';

/** One native MCP configuration source. */
export type McpSource = { path: string; scope: McpSourceScope; serverCount: number };

/** Availability of the native MCP client selected for an agent. */
export type McpClientAvailability =
	{ state: 'ready'; version?: string } | { state: 'absent' | 'disabled'; actionLabel: string; message: string };

/** Read-only configuration state shown before MCP editing is available. */
export type McpConfigurationViewModel = {
	agent: McpAgent;
	availability: McpClientAvailability;
	managedEnabled: boolean;
	nativeConfigurationActive: boolean;
	serverCount: number;
	sources: McpSource[];
};
