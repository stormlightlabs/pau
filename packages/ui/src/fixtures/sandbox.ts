import type { EffectiveSandboxView, SandboxSelectionModel, SandboxSettingsModel } from '../lib/types/sandbox';

const workspaceWrite: SandboxSettingsModel = {
	profile: 'workspace-write',
	grants: { domains: [], writableRoots: [], unixSockets: false },
	homeReadDeny: false,
	shareClaudeTemp: false,
	unsandboxedTools: [],
	credentialReferences: []
};

const granted: SandboxSettingsModel = {
	...workspaceWrite,
	grants: {
		domains: ['registry.npmjs.org', '127.0.0.1:5173'],
		writableRoots: ['/home/me/.cache/pnpm'],
		unixSockets: false
	},
	homeReadDeny: true,
	unsandboxedTools: ['web_search']
};

const referenced: SandboxSettingsModel = {
	...workspaceWrite,
	credentialReferences: [
		{
			source: 'PACKAGE_TOKEN',
			shape: 'whole-value',
			destinations: ['registry.example.com', '*.packages.example.com:443']
		}
	]
};

const effective: EffectiveSandboxView = {
	adapter: 'pi',
	platform: 'linux',
	mechanism: 'Bubblewrap 0.12.0 with network and PID namespaces and a seccomp socket filter',
	verified: true,
	executables: [
		{ name: 'bwrap', path: '/usr/bin/bwrap', version: '0.12.0' },
		{ name: 'socat', path: '/usr/bin/socat' },
		{ name: 'rg', path: '/usr/bin/rg' }
	],
	profile: 'workspace-write',
	readable: {
		homeDenied: false,
		allowed: [],
		denied: [
			'/home/me/.ssh',
			'/home/me/.aws',
			'/home/me/.pi/agent/auth.json',
			'/home/me/work/pau/.env',
			'/home/me/work/pau/.env.local'
		]
	},
	writable: ['/home/me/work/pau', '/home/me/.local/share/pau/sandbox/s-41/tmp'],
	protected: [
		'/home/me/work/pau/.git/hooks',
		'/home/me/work/pau/.git/config',
		'/home/me/work/pau/.pi',
		'/home/me/work/pau/.claude',
		'/home/me/work/pau/.mcp.json',
		'/home/me/work/pau/.zed'
	],
	network: { domains: [], localAddresses: [], unixSockets: false },
	credentials: {
		denied: ['/home/me/.ssh', '/home/me/.aws', '/home/me/.pi/agent/auth.json'],
		references: [],
		brokered: []
	},
	environment: ['HOME', 'LANG', 'PATH', 'PAU_SANDBOX', 'TERM', 'TMPDIR'],
	limits: [
		'Descendants stop when the tool host exits',
		'Core dumps are disabled',
		'No CPU, memory, or process-count cap'
	],
	sandboxedTools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'MCP server docs'],
	unsandboxedTools: [],
	disabledTools: [
		'Tools from other Pi extensions',
		"Servers from Pi's built-in MCP support, which does not run in sandboxed sessions yet",
		'MCP server linear: its host is not a granted domain'
	],
	placeholders: ['/home/me/work/pau/.mcp.json', '/home/me/work/pau/.claude'],
	knownGaps: [
		'Unix sockets cannot be filtered by path, so the socket grant allows all of them',
		'Reads outside the workspace are allowed apart from the denied paths unless home read-deny is on',
		"Pi's MCP client connects to remote servers from the Pi process, not through the sandbox proxy"
	]
};

/** Representative sandbox states that do not require a live agent. */
export const sandboxFixtures = {
	unsandboxed: { mode: 'unsandboxed' } satisfies SandboxSelectionModel,
	workspaceWrite: { mode: 'sandboxed', settings: workspaceWrite } satisfies SandboxSelectionModel,
	granted: { mode: 'sandboxed', settings: granted } satisfies SandboxSelectionModel,
	referenced: { mode: 'sandboxed', settings: referenced } satisfies SandboxSelectionModel,
	structuredReferenced: {
		mode: 'sandboxed',
		settings: {
			...referenced,
			credentialReferences: [
				{ source: 'DATABASE_URL', shape: 'url-password', destinations: ['database.example.com:5432'] }
			]
		}
	} satisfies SandboxSelectionModel,
	missingCredentialSource: {
		mode: 'sandboxed',
		settings: {
			...workspaceWrite,
			credentialReferences: [{ source: '', shape: 'whole-value', destinations: ['registry.example.com'] }]
		}
	} satisfies SandboxSelectionModel,
	invalidCredentialDestination: {
		mode: 'sandboxed',
		settings: {
			...workspaceWrite,
			credentialReferences: [
				{ source: 'PACKAGE_TOKEN', shape: 'whole-value', destinations: ['https://registry.example.com/token'] }
			]
		}
	} satisfies SandboxSelectionModel,
	effective,
	referencedEffective: {
		...effective,
		credentials: {
			...effective.credentials,
			references: [{ source: 'PACKAGE_TOKEN', shape: 'whole-value', destinations: ['registry.example.com'] }],
			brokered: ['PACKAGE_TOKEN']
		}
	} satisfies EffectiveSandboxView,
	severalBrokeredDestinationsEffective: {
		...effective,
		credentials: {
			...effective.credentials,
			references: [
				{
					source: 'PACKAGE_TOKEN',
					shape: 'whole-value',
					destinations: ['registry.example.com', '*.packages.example.com:443']
				},
				{ source: 'DEPLOY_TOKEN', shape: 'colon-pair', destinations: ['deploy.example.com'] }
			],
			brokered: ['PACKAGE_TOKEN', 'DEPLOY_TOKEN']
		}
	} satisfies EffectiveSandboxView,
	grantedEffective: {
		...effective,
		readable: {
			homeDenied: true,
			allowed: ['/home/me/work/pau', '/home/me/.local/share/pau/sandbox/s-41/tmp', '/home/me/.cache/pnpm'],
			denied: [...effective.readable.denied, '/home/me']
		},
		writable: [...effective.writable, '/home/me/.cache/pnpm'],
		network: {
			domains: ['registry.npmjs.org', '127.0.0.1:5173'],
			localAddresses: ['127.0.0.1:5173'],
			unixSockets: false
		},
		unsandboxedTools: ['web_search']
	} satisfies EffectiveSandboxView,
	claudeEffective: {
		...effective,
		adapter: 'claude',
		sandboxedTools: ['Bash'],
		disabledTools: ['WebFetch', 'WebSearch', 'Claude MCP servers'],
		knownGaps: [
			effective.knownGaps[0] ?? '',
			"Claude's Read, Edit, and Write tools follow Claude's permission rules rather than the operating-system sandbox"
		]
	} satisfies EffectiveSandboxView,
	macosEffective: {
		...effective,
		platform: 'macos',
		mechanism: 'Seatbelt',
		verified: false,
		executables: [{ name: 'rg', path: '/opt/homebrew/bin/rg' }],
		knownGaps: [
			"Seatbelt enforcement has not been verified by Pau's fixtures on macOS",
			...effective.knownGaps.slice(1)
		]
	} satisfies EffectiveSandboxView,
	unavailable: 'bwrap was not found on PATH'
};
