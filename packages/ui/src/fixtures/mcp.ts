import type { McpConfigurationViewModel } from '../lib/types/mcp';

/** Representative MCP states that do not require a live agent. */
export const mcpConfigurationFixtures = {
	piConfiguredOff: {
		agent: 'pi',
		availability: { state: 'ready', version: '2.37.0' },
		managedEnabled: false,
		nativeConfigurationActive: true,
		serverCount: 3,
		servers: [
			{
				name: 'docs',
				transport: 'stdio',
				scope: 'project',
				sourcePath: '.pi/mcp.json',
				enabled: true,
				status: 'not-connected',
				negotiatedCapabilities: []
			},
			{
				name: 'linear',
				transport: 'http',
				scope: 'user',
				sourcePath: '~/.config/mcp/mcp.json',
				enabled: true,
				status: 'connected',
				diagnostic: 'Connected with 12 tools.',
				negotiatedCapabilities: ['tools', 'resources', 'elicitation']
			},
			{
				name: 'archive',
				transport: 'stdio',
				scope: 'project',
				sourcePath: '.pi/mcp.json',
				enabled: false,
				status: 'disabled',
				negotiatedCapabilities: []
			}
		],
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
		servers: [],
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
		servers: [],
		sources: [{ path: '.mcp.json', scope: 'project', serverCount: 2 }]
	},
	claudeConfiguredOff: {
		agent: 'claude',
		availability: { state: 'ready' },
		managedEnabled: false,
		nativeConfigurationActive: true,
		serverCount: 2,
		servers: [
			{
				name: 'github',
				transport: 'http',
				scope: 'user',
				sourcePath: '~/.claude.json',
				enabled: true,
				status: 'needs-auth',
				diagnostic: 'Sign in before testing this server.',
				negotiatedCapabilities: []
			},
			{
				name: 'database',
				transport: 'stdio',
				scope: 'project',
				sourcePath: '.mcp.json',
				enabled: true,
				status: 'failed',
				diagnostic: 'The server did not finish startup before the timeout.',
				negotiatedCapabilities: []
			}
		],
		sources: [
			{ path: '~/.claude.json', scope: 'user', serverCount: 1 },
			{ path: '.mcp.json', scope: 'project', serverCount: 1 }
		]
	}
} as const satisfies Record<string, McpConfigurationViewModel>;
