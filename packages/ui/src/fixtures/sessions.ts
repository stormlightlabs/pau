import type { SessionCapabilities, SessionViewModel, SessionWorkspace } from '../lib/types/session';
import { usageFixtures } from './usage';

const fullCapabilities = {
	prompt: true,
	followUp: true,
	steer: true,
	interrupt: true,
	stop: true,
	branching: true,
	retry: true,
	messageQueue: true,
	commandDiscovery: true,
	compaction: true,
	rename: true,
	cloneSession: true,
	exportTranscript: true,
	shellCommands: true
} satisfies SessionCapabilities;

const claudeCapabilities = {
	prompt: true,
	followUp: false,
	steer: false,
	interrupt: true,
	stop: true
} satisfies SessionCapabilities;

const transcript: SessionViewModel['transcript'] = [
	{
		id: 'prompt-1',
		kind: 'message',
		role: 'user',
		label: 'You · task',
		body: 'Fix gutter markers drifting when soft-wrap is on. Keep changes inside src/diff/.'
	},
	{
		id: 'thinking-1',
		kind: 'thinking',
		body: 'I will inspect the gutter offsets and the existing wrap tests before changing the renderer.',
		complete: true
	},
	{ id: 'tool-1', kind: 'tool', name: 'read', detail: 'src/diff/gutter.ts', result: '212 lines', status: 'complete' },
	{ id: 'tool-2', kind: 'tool', name: 'bash', detail: 'pnpm test diff', result: '38 passed', status: 'complete' },
	{
		id: 'answer-1',
		kind: 'message',
		role: 'assistant',
		label: 'Pi · Sonnet',
		body: 'Gutter rows now follow visual line offsets, so wrapped lines keep their markers. Two wrap tests cover folded and unfolded ranges.'
	}
];

const session = (status: SessionViewModel['status'], overrides: Partial<SessionViewModel> = {}): SessionViewModel => ({
	id: `session-${status}`,
	workspaceId: 'pau',
	title: `${status}-session`,
	agent: 'Pi',
	model: 'Sonnet',
	status,
	capabilities: fullCapabilities,
	transcript,
	...overrides
});

/** Shell commands run from the composer: kept in context, kept out, failed, stopped, and refused. */
const shellTranscript: SessionViewModel['transcript'] = [
	{
		id: 'shell-1',
		kind: 'tool',
		name: 'shell',
		detail: 'ls src/diff',
		result: 'gutter.ts\nwrap.test.ts\n',
		status: 'complete',
		call: { tool: 'bash', command: 'ls src/diff', exitCode: 0 },
		shell: { excludedFromContext: false }
	},
	{
		id: 'shell-2',
		kind: 'tool',
		name: 'shell',
		detail: 'cat .env.local',
		result: 'API_TOKEN=redacted\n',
		status: 'complete',
		call: { tool: 'bash', command: 'cat .env.local', exitCode: 0 },
		shell: { excludedFromContext: true }
	},
	{
		id: 'shell-3',
		kind: 'tool',
		name: 'shell',
		detail: 'pnpm test diff',
		result: 'FAIL src/diff/wrap.test.ts\n  expected 12, received 14\n1 failed, 37 passed\n',
		status: 'failed',
		call: { tool: 'bash', command: 'pnpm test diff', exitCode: 1 },
		shell: { excludedFromContext: false }
	},
	{
		id: 'shell-4',
		kind: 'tool',
		name: 'shell',
		detail: 'pnpm dev',
		result: 'Local: http://localhost:5173/\n',
		status: 'complete',
		call: { tool: 'bash', command: 'pnpm dev' },
		shell: { excludedFromContext: false, cancelled: true }
	},
	{
		id: 'shell-5',
		kind: 'tool',
		name: 'shell',
		detail: 'ls',
		result: 'Pi rejected the request: Session is shutting down',
		status: 'failed',
		call: { tool: 'bash', command: 'ls' },
		shell: { excludedFromContext: false }
	}
];

/** A shell command still printing output. */
const runningShell: SessionViewModel['transcript'][number] = {
	id: 'shell-running',
	kind: 'tool',
	name: 'shell',
	detail: 'pnpm test --watch',
	result: 'RUN v3.2.4\n✓ src/diff/gutter.test.ts (6 tests)\n',
	status: 'running',
	call: { tool: 'bash', command: 'pnpm test --watch' },
	shell: { excludedFromContext: false }
};

const failedTurn: SessionViewModel['transcript'] = [
	transcript[0]!,
	{
		id: 'error-1',
		kind: 'message',
		role: 'assistant',
		label: 'Pi · error',
		body: '529 overloaded: the provider could not take the request.',
		failed: true
	}
];

const compactedTranscript: SessionViewModel['transcript'] = [
	{
		id: 'compaction-1',
		kind: 'compaction',
		reason: 'manual',
		summary:
			'The user is fixing gutter markers that drift under soft-wrap. The renderer in src/diff/gutter.ts now uses visual line offsets.',
		tokensBefore: 84_210,
		tokensAfter: 12_300
	},
	transcript[0]!
];

const automaticCompaction: SessionViewModel['transcript'][number] = {
	id: 'compaction-2',
	kind: 'compaction',
	reason: 'overflow',
	summary: 'The user is fixing gutter markers that drift under soft-wrap.',
	tokensBefore: 201_000,
	willRetry: true
};

/**
 * A session resumed from saved history: a compaction with no recorded cause,
 * then prompts with screenshots, some left out as older, too large, or damaged.
 */
const promptImagesTranscript: SessionViewModel['transcript'] = [
	{
		id: 'compaction-history',
		kind: 'compaction',
		summary: 'The user is fixing gutter markers that drift under soft-wrap.',
		tokensBefore: 96_400
	},
	{
		id: 'prompt-images-older',
		kind: 'message',
		role: 'user',
		body: 'This is how the gutter looked before the wrap change.',
		hiddenImages: { older: 3 }
	},
	{
		id: 'prompt-images',
		kind: 'message',
		role: 'user',
		body: 'The markers still drift in these two layouts. Compare them with the wrap tests.',
		images: [
			{
				mimeType: 'image/png',
				data: 'iVBORw0KGgoAAAANSUhEUgAAAKAAAAB4CAIAAAD6wG44AAAA2ElEQVR42u3RQQ0AIAwAsQnbGxGIQM40IWsqeLA0OQXXyHM1uLAAsAALsAALsAALMGABFmABFmABFmDAAizAAizAAizAAgxYgAVYgAVYgAUYsAALsAALsAALMGABFmABFmABFmABBizAAizAAizAAgxYgAVYgAVYgAUYsAuABViABViABViAAQuwvgBetTU4wIAFWIAFWIAFWIABC7AAC7AAC7AAAxZgARZgARZgARZgwAIswAIswAIswIAFWIAFWIAFWIABC7AAC7AAC7AACzBgARZgAdbDGraZGOytTlWeAAAAAElFTkSuQmCC'
			},
			{
				mimeType: 'image/png',
				data: 'iVBORw0KGgoAAAANSUhEUgAAAHgAAACgCAIAAABIaz/HAAABMElEQVR42u3bQQ0AIBADQYShDk0o4Y0IJCCjl9wkNdD573h3R3bWjCz1d4AGDRo0aNCgQYMGDRo0aNCgQYMGDRo0aNCgQYMGDRo0aNCgQYMGDRo0aNCgQYMGDRo0aNCgQYMGDRo0aNAFobsdTv0FDRo0aNCgQYMGDRo0aNCgQYMGDRo0aNCgQYMGDRo0aNCgQYMGDRo0aNCgQYMGDRo0aNCgQYMGDRo0aNCgK0ILOpWzoEGDBg0aNGjQoEGDBg0aNGjQoEGDBg0aNGjQoEGDBg0aNGjQoEGDBg0aNGjQoEGDBg0aNGjQoEGDBg26L7SgUzkLGjRo0KBBgwYNGjRo0KBBgwYNGjRo0KBBgwYNGjRo0KBBgwYNGjRo0KBBgwYNGjRo0KBBgwYNGjRo0KDbQn8iZWDprJSG6AAAAABJRU5ErkJggg=='
			}
		]
	},
	{
		id: 'prompt-image-only',
		kind: 'message',
		role: 'user',
		body: '',
		images: [
			{
				mimeType: 'image/png',
				data: 'iVBORw0KGgoAAAANSUhEUgAAAKAAAAB4CAIAAAD6wG44AAAA2ElEQVR42u3RQQ0AIAwAsQnbGxGIQM40IWsqeLA0OQXXyHM1uLAAsAALsAALsAALMGABFmABFmABFmDAAizAAizAAizAAgxYgAVYgAVYgAUYsAALsAALsAALMGABFmABFmABFmABBizAAizAAizAAgxYgAVYgAVYgAUYsAuABViABViABViAAQuwvgBetTU4wIAFWIAFWIAFWIABC7AAC7AAC7AAAxZgARZgARZgARZgwAIswAIswAIswIAFWIAFWIAFWIABC7AAC7AAC7AACzBgARZgAdbDGraZGOytTlWeAAAAAElFTkSuQmCC'
			}
		]
	},
	{
		id: 'prompt-images-hidden',
		kind: 'message',
		role: 'user',
		body: 'And these recordings.',
		hiddenImages: { tooLarge: 2, unreadable: 1 }
	}
];

const extensionUi = {
	notifications: [{ id: 'notification-fixture', message: 'The extension is ready.', level: 'info' as const }],
	statuses: [{ key: 'fixture', text: 'Waiting for your response' }],
	widgets: [
		{
			key: 'fixture',
			lines: ['Configured extension', 'Only string widgets are shown in Pau.'],
			placement: 'above-editor' as const
		}
	]
};

/** Session fixtures shared by stories and deterministic browser tests. */
export const sessionFixtures = {
	empty: [] as SessionWorkspace[],
	starting: [
		{ id: 'pau', name: 'Pau', sessions: [session('starting', { title: 'Start session process', transcript: [] })] }
	],
	idle: [{ id: 'pau', name: 'Pau', sessions: [session('idle', { title: 'Fix diff gutter', transcript: [] })] }],
	running: [{ id: 'pau', name: 'Pau', sessions: [session('running', { title: 'Fix diff gutter' })] }],
	/** An idle session with a transcript in a workspace whose folder is known, for context menus. */
	idleWithPath: [
		{
			id: 'pau',
			name: 'Pau',
			path: '/Users/operator/projects/pau',
			sessions: [session('idle', { title: 'Fix diff gutter' }), session('stopped', { title: 'Review fixtures' })]
		}
	],
	failedTurn: [
		{ id: 'pau', name: 'Pau', sessions: [session('idle', { title: 'Fix diff gutter', transcript: failedTurn })] }
	],
	failedTurnWithoutRetry: [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [
				session('idle', {
					title: 'Fix diff gutter',
					transcript: failedTurn,
					capabilities: { ...claudeCapabilities, retry: false }
				})
			]
		}
	],
	queued: [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [
				session('running', {
					messageQueue: {
						steering: ['Keep the public API unchanged.'],
						followUp: ['Add a regression test for soft-wrap.', 'Summarize the change for the changelog.']
					}
				})
			]
		}
	],
	/** A running session that reports usage and can switch models and thinking levels. */
	modelControls: [
		{
			id: 'pau',
			name: 'Pau',
			path: '/Users/operator/projects/pau',
			branch: 'main',
			sessions: [
				session('running', {
					title: 'Fix diff gutter',
					thinkingLevel: 'high',
					usage: usageFixtures.normal,
					capabilities: { ...fullCapabilities, modelSelection: true, thinkingLevel: true, usage: true }
				})
			]
		}
	],
	compactingManual: [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [session('idle', { title: 'Fix diff gutter', compaction: { status: 'running', reason: 'manual' } })]
		}
	],
	compactingAutomatic: [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [
				session('running', { title: 'Fix diff gutter', compaction: { status: 'running', reason: 'threshold' } })
			]
		}
	],
	compacted: [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [session('idle', { title: 'Fix diff gutter', transcript: compactedTranscript })]
		}
	],
	compactedAutomatically: [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [session('idle', { title: 'Fix diff gutter', transcript: [automaticCompaction] })]
		}
	],
	promptImages: [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [session('idle', { title: 'Fix diff gutter', transcript: promptImagesTranscript })]
		}
	],
	compactionFailed: [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [
				session('idle', {
					title: 'Fix diff gutter',
					compaction: { status: 'failed', reason: 'manual', message: 'Nothing to compact (session too small).' }
				})
			]
		}
	],
	compactionAborted: [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [session('idle', { title: 'Fix diff gutter', compaction: { status: 'aborted', reason: 'threshold' } })]
		}
	],
	/** An idle Claude Code session that streamed a reply and a tool call. */
	claude: [
		{
			id: 'pau',
			name: 'Pau',
			path: '/Users/operator/projects/pau',
			sessions: [
				session('idle', {
					id: 'claude-idle',
					title: 'Review the adapter fixtures',
					agent: 'Claude Code',
					model: undefined,
					capabilities: claudeCapabilities,
					transcript: [
						{ id: 'claude-0', kind: 'message', role: 'user', body: 'Check the bridge fixtures against the protocol.' },
						{
							id: 'tool:t1',
							kind: 'tool',
							name: 'Read',
							detail: 'packages/claude-bridge/test/fixtures/protocol.jsonl',
							result: '5 lines',
							status: 'complete'
						},
						{
							id: 'claude-1',
							kind: 'message',
							role: 'assistant',
							body: 'The fixtures match protocol version 1. Every event carries a sequence number.'
						}
					]
				})
			]
		}
	],
	compactionUnsupported: [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [
				session('idle', { title: 'Review adapter fixtures', agent: 'Claude Code', capabilities: claudeCapabilities })
			]
		}
	],
	autoRetryPending: [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [
				session('running', {
					title: 'Fix diff gutter',
					transcript: [transcript[0]!],
					autoRetry: { attempt: 2, maxAttempts: 3, retryAt: Date.now() + 600_000, errorMessage: '529 overloaded' }
				})
			]
		}
	],
	runningWithoutQueue: [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [
				session('running', {
					id: 'session-no-queue',
					title: 'Review adapter fixtures',
					agent: 'Claude Code',
					capabilities: claudeCapabilities
				})
			]
		}
	],
	shellCommands: [
		{ id: 'pau', name: 'Pau', sessions: [session('idle', { title: 'Fix diff gutter', transcript: shellTranscript })] }
	],
	shellCommandRunning: [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [session('idle', { title: 'Fix diff gutter', transcript: [transcript[0]!, runningShell] })]
		}
	],
	workspaceWithoutSessions: [{ id: 'pau', name: 'Pau', sessions: [] }],
	waiting: [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [
				session('waiting', {
					title: 'Review permission request',
					attention: 'Pi needs a response before it can continue.'
				})
			]
		}
	],
	failed: [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [
				session('failed', { title: 'Update session registry', error: 'Pi exited before the RPC connection was ready.' })
			]
		}
	],
	sandboxDenials: [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [
				session('idle', {
					id: 'sandbox-denials',
					title: 'Inspect sandbox denials',
					transcript: [
						...transcript,
						{
							id: 'denial-file-read',
							kind: 'sandbox-denial',
							target: 'file',
							operation: 'read',
							path: '/home/me/.ssh/id_ed25519',
							reason: 'unreadable'
						},
						{
							id: 'denial-file-write',
							kind: 'sandbox-denial',
							target: 'file',
							operation: 'write',
							path: '/work/pau/.git/config',
							reason: 'protected'
						},
						{ id: 'denial-network', kind: 'sandbox-denial', target: 'network', destination: 'api.example.com:443' },
						{ id: 'denial-unexplained', kind: 'sandbox-denial', target: 'unexplained' }
					]
				}),
				session('idle', { id: 'sandbox-clean', title: 'Session without denials', transcript: [] })
			]
		}
	],
	stopped: [{ id: 'pau', name: 'Pau', sessions: [session('stopped', { title: 'Write release notes' })] }],
	extensionConfirm: [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [
				session('waiting', {
					id: 'extension-confirm',
					title: 'Extension confirmation',
					attention: 'A configured extension needs your response.',
					extensionUi: {
						...extensionUi,
						dialog: {
							id: 'confirm-fixture',
							kind: 'confirm',
							title: 'Allow workspace update?',
							message: 'The extension wants to update its workspace index.'
						}
					}
				})
			]
		}
	],
	extensionUnsupported: [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [
				session('waiting', {
					id: 'extension-custom',
					title: 'Terminal-only extension',
					extensionUi: {
						notifications: [],
						statuses: [],
						widgets: [],
						dialog: { id: 'custom-fixture', kind: 'unsupported', method: 'custom' }
					}
				})
			]
		}
	],
	concurrent: [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [
				session('running', { id: 'diff-gutter', title: 'Fix diff gutter' }),
				session('waiting', {
					id: 'registry-review',
					title: 'Review session registry',
					attention: 'Pi needs your decision before it continues.'
				}),
				session('idle', {
					id: 'claude-review',
					title: 'Review adapter fixtures',
					agent: 'Claude Code',
					capabilities: claudeCapabilities,
					transcript: []
				})
			]
		},
		{
			id: 'docs',
			name: 'Docs',
			sessions: [
				session('idle', { id: 'session-docs', workspaceId: 'docs', title: 'Document session controls', transcript: [] })
			]
		}
	] satisfies SessionWorkspace[]
} satisfies Record<string, SessionWorkspace[]>;
