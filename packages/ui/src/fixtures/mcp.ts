import type { McpConfigurationViewModel } from '../lib/types/mcp';

/** Representative MCP discovery states that do not require a live agent. */
export const mcpConfigurationFixtures = {
	piConfiguredOff: {
		agent: 'pi',
		availability: { state: 'ready', version: '2.37.0' },
		managedEnabled: false,
		nativeConfigurationActive: true,
		serverCount: 3,
		sources: [
			{ path: '~/.config/mcp/mcp.json', scope: 'user', serverCount: 2 },
			{ path: '.pi/mcp.json', scope: 'project', serverCount: 1 }
		]
	},
	piAbsent: {
		agent: 'pi',
		availability: {
			state: 'absent',
			actionLabel: 'Review install command',
			message: 'Pi MCP is configured, but pi-mcp-adapter is not installed through Pi.'
		},
		managedEnabled: false,
		nativeConfigurationActive: false,
		serverCount: 2,
		sources: [{ path: '.mcp.json', scope: 'project', serverCount: 2 }]
	},
	piDisabled: {
		agent: 'pi',
		availability: {
			state: 'disabled',
			actionLabel: 'Open Pi configuration',
			message: "Pi's package filters disable the pi-mcp-adapter extension."
		},
		managedEnabled: false,
		nativeConfigurationActive: false,
		serverCount: 2,
		sources: [{ path: '.mcp.json', scope: 'project', serverCount: 2 }]
	},
	claudeConfiguredOff: {
		agent: 'claude',
		availability: { state: 'ready' },
		managedEnabled: false,
		nativeConfigurationActive: true,
		serverCount: 2,
		sources: [
			{ path: '~/.claude.json', scope: 'user', serverCount: 1 },
			{ path: '.mcp.json', scope: 'project', serverCount: 1 }
		]
	}
} as const satisfies Record<string, McpConfigurationViewModel>;
