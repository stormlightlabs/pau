import type { SessionCapabilities, SessionViewModel, SessionWorkspace } from '../lib/types/session';

const fullCapabilities = {
	prompt: true,
	followUp: true,
	steer: true,
	interrupt: true,
	stop: true
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
