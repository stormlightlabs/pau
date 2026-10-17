import type { SessionCapabilities, SessionViewModel, SessionWorkspace } from '../lib/types/session';

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
	compaction: true
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
	compactionUnsupported: [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [
				session('idle', { title: 'Review adapter fixtures', agent: 'Claude', capabilities: claudeCapabilities })
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
					agent: 'Claude',
					capabilities: claudeCapabilities
				})
			]
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
					agent: 'Claude',
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
