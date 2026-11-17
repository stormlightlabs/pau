import type { SessionStatus, SessionViewModel, SessionWorkspace, TranscriptEntry } from '../lib/types/session';
import type { WorkspaceGitStatus } from '../lib/types/workspace-files';

/**
 * A working day in the bay: fourteen sessions across four worktrees, with
 * pending requests on running sessions as the store reports them, a
 * failure, a session that stopped responding, live tool calls and a long
 * transcript. Stories and tests use it to check the
 * bay, the session view and the workspace column at real volumes.
 */

const piCapabilities = {
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
	shellCommands: true,
	usage: true
} satisfies SessionViewModel['capabilities'];

const claudeCapabilities = {
	prompt: true,
	followUp: false,
	steer: false,
	interrupt: true,
	stop: true
} satisfies SessionViewModel['capabilities'];

/** The permission request Pau's extension sends for a held write. */
export const permissionTitle = JSON.stringify({
	pau: 'permission',
	version: 1,
	requestId: 'request-1',
	toolCallId: 'call-edit-2',
	tool: 'edit',
	operation: 'write',
	paths: ['crates/server/src/sessions.rs'],
	matchedRule: 'Writes outside the plan ask first.',
	sessionScope: false
});

const permissionDialog = {
	id: 'dialog-permission',
	kind: 'select' as const,
	title: permissionTitle,
	options: ['allow_once', 'allow_session', 'deny']
};

/** A transcript long enough to scroll: a prompt, prose, tool rows with output, and an edit. */
function sandboxTranscript(): TranscriptEntry[] {
	const entries: TranscriptEntry[] = [
		{
			id: 'user-1',
			kind: 'message',
			role: 'user',
			body: 'Start Pi sessions inside the workspace sandbox and fail the start if the extension never reports ready.'
		},
		{
			id: 'assistant-1',
			kind: 'message',
			role: 'assistant',
			body: "The launcher spawns Pi directly today. I'll route the spawn through the sandbox wrapper, wait for the extension's ready event, and mark the session failed when the wait runs out.\n\nThe session tests cover the spawn path, so I'll run them before and after the edit."
		}
	];
	for (let round = 1; round <= 6; round += 1) {
		entries.push(
			{
				id: `read-${round}`,
				kind: 'tool',
				name: 'read',
				detail: `crates/server/src/sessions/part_${round}.rs`,
				result: Array.from({ length: 40 }, (_, line) => `${line + 1}\tfn step_${round}_${line}() {}`).join('\n'),
				status: 'complete',
				call: { tool: 'read', path: `crates/server/src/sessions/part_${round}.rs` }
			},
			{
				id: `bash-${round}`,
				kind: 'tool',
				name: 'bash',
				detail: 'cargo test -p pau-server --lib sessions',
				result: `running 36 tests\n${Array.from({ length: 36 }, (_, test) => `test sessions::tests::case_${test} ... ok`).join('\n')}\n\ntest result: ok. 36 passed; 0 failed`,
				status: 'complete',
				call: { tool: 'bash', command: 'cargo test -p pau-server --lib sessions', exitCode: 0, durationMs: 41_300 }
			},
			{
				id: `assistant-round-${round}`,
				kind: 'message',
				role: 'assistant',
				body: `Round ${round}: the spawn path holds. The sandbox wrapper starts Pi with the policy file, and the ready wait sees the extension's first status within 400ms on this machine. Next I check the timeout branch, where \`READY_TIMEOUT\` is 10 seconds and a session that misses it is killed and reported as failed.`
			}
		);
	}
	entries.push({
		id: 'edit-1',
		kind: 'tool',
		name: 'edit',
		detail: 'crates/server/src/sessions.rs',
		status: 'complete',
		call: {
			tool: 'edit',
			path: 'crates/server/src/sessions.rs',
			edits: [
				{
					oldText: '    Ok(Session::running(child))',
					newText: '    let ready = timeout(READY_TIMEOUT, child.wait_ready());'
				}
			]
		}
	});
	return entries;
}

const runningTranscript: TranscriptEntry[] = [
	{
		id: 'user-audit',
		kind: 'message',
		role: 'user',
		body: 'Drain the audit log on shutdown. Every queued record must reach disk before the server exits.'
	},
	{
		id: 'assistant-audit',
		kind: 'message',
		role: 'assistant',
		body: "The audit writer drops its channel when the runtime shuts down, so records still in the queue are lost. I'll hold shutdown until the writer flushes, with a 5-second limit."
	},
	{
		id: 'bash-audit',
		kind: 'tool',
		name: 'bash',
		detail: 'cargo test -p pau-core audit',
		result:
			'running 6 tests\ntest drains_queued_records_on_shutdown ... ok\ntest drain_gives_up_after_the_limit ... ok\n',
		status: 'running',
		call: { tool: 'bash', command: 'cargo test -p pau-core audit' }
	}
];

const git = (files: [string, 'modified' | 'added' | 'untracked', boolean][], branch: string): WorkspaceGitStatus => ({
	repository: true,
	branch,
	head: '3f9c2a71e0b4d58c',
	detached: false,
	files: files.map(([path, state, staged]) => ({
		path,
		previous_path: null,
		staged: staged ? state : null,
		worktree: staged ? null : state,
		conflicted: false
	}))
});

type SessionSeed = {
	id: string;
	title: string;
	status: SessionStatus;
	claude?: boolean;
	attention?: string;
	error?: string;
	transcript?: TranscriptEntry[];
	unseen?: boolean;
};

function session(workspaceId: string, seed: SessionSeed): SessionViewModel {
	return {
		id: seed.id,
		workspaceId,
		title: seed.title,
		agent: seed.claude ? 'Claude Code' : 'Pi',
		model: seed.claude ? 'claude-opus-5-5' : 'claude-sonnet-5',
		status: seed.status,
		attention: seed.attention,
		error: seed.error,
		unseen: seed.unseen,
		capabilities: seed.claude ? claudeCapabilities : piCapabilities,
		transcript: seed.transcript ?? [
			{ id: `${seed.id}-user`, kind: 'message', role: 'user', body: seed.title },
			{ id: `${seed.id}-reply`, kind: 'message', role: 'assistant', body: 'Done. The change is in and the tests pass.' }
		],
		usage: {
			context: { tokens: 122_000, contextWindow: 200_000, percent: 61 },
			tokens: { input: 84_200, output: 12_900, cacheRead: 40_000, cacheWrite: 2000, total: 139_100 },
			cost: 1.84
		}
	};
}

const sandbox = { sandboxed: true, label: 'Sandbox on, network off' };

/** The busy bay, with the permission request on the open session. */
const busy: SessionWorkspace[] = [
	{
		id: 'pau-sandbox',
		name: 'pau-sandbox',
		path: '/Users/dev/Projects/pau-worktrees/pau-sandbox',
		branch: 'claude/sandbox',
		git: git(
			[
				['crates/server/src/sandbox.rs', 'modified', true],
				['crates/server/src/sessions.rs', 'modified', false],
				['crates/server/tests/sessions.rs', 'added', false],
				['docs/sessions.md', 'modified', false]
			],
			'claude/sandbox'
		),
		sandbox,
		terminals: [{ id: 'terminal-1', label: 'zsh', status: 'Exited 0' }],
		sessions: [
			{
				...session('pau-sandbox', {
					id: 'sandbox-pi',
					title: 'Sandbox Pi sessions',
					status: 'running',
					attention: 'Allow write to crates/server/src/sessions.rs?',
					transcript: sandboxTranscript()
				}),
				extensionUi: { notifications: [], statuses: [], widgets: [], dialog: permissionDialog }
			},
			session('pau-sandbox', { id: 'sandbox-docs', title: 'Website changelog feed', status: 'idle' })
		]
	},
	{
		id: 'pau-audit',
		name: 'pau-audit',
		path: '/Users/dev/Projects/pau-worktrees/pau-audit',
		branch: 'claude/audit',
		git: git(
			[
				['crates/core/src/audit/writer.rs', 'modified', false],
				['crates/core/tests/audit_drain.rs', 'untracked', false]
			],
			'claude/audit'
		),
		sandbox,
		terminals: [],
		sessions: [
			session('pau-audit', {
				id: 'audit-drain',
				title: 'Audit log shutdown drain',
				status: 'running',
				claude: true,
				transcript: runningTranscript
			}),
			session('pau-audit', {
				id: 'audit-scope',
				title: 'Resource scope picker',
				status: 'running',
				claude: true,
				attention: 'Run pnpm install in packages/ui?'
			}),
			session('pau-audit', { id: 'audit-tokens', title: 'Token test flake', status: 'idle', unseen: true })
		]
	},
	{
		id: 'pau',
		name: 'pau',
		path: '/Users/dev/Projects/pau',
		branch: 'main',
		git: git([], 'main'),
		sandbox: { sandboxed: false, label: 'No sandbox' },
		terminals: [
			{ id: 'terminal-2', label: 'zsh', status: 'Running' },
			{ id: 'terminal-3', label: 'nvim', status: 'Exited 1', failed: true }
		],
		sessions: [
			session('pau', { id: 'pau-design', title: 'Design audit', status: 'running', transcript: runningTranscript }),
			session('pau', {
				id: 'pau-diff',
				title: 'Diff gutter numbers',
				status: 'running',
				transcript: runningTranscript
			}),
			session('pau', {
				id: 'pau-models',
				title: 'Model list filter',
				status: 'starting',
				claude: true,
				transcript: []
			}),
			session('pau', {
				id: 'pau-pty',
				title: 'Terminal relay PTY',
				status: 'failed',
				claude: true,
				error: 'srt exited with status 1'
			}),
			session('pau', { id: 'pau-rpc', title: 'Pi RPC timeout', status: 'not_responding' }),
			session('pau', { id: 'pau-themes', title: 'Theme contrast pass', status: 'idle' }),
			session('pau', { id: 'pau-zellij', title: 'Zellij smoke run', status: 'stopped' })
		]
	},
	{
		id: 'thndrs',
		name: 'thndrs',
		path: '/Users/dev/Projects/thndrs',
		branch: 'main',
		sandbox: { sandboxed: false, label: 'No sandbox' },
		sessions: [
			session('thndrs', {
				id: 'thndrs-readme',
				title: 'Rewrite README for the 1.0 release and its migration notes',
				status: 'stopped'
			}),
			session('thndrs', { id: 'thndrs-migrate', title: 'Migration guard', status: 'stopped', claude: true })
		]
	}
];

/** Moves one session to a new state, as the event stream would. */
function withStatus(
	workspaces: SessionWorkspace[],
	id: string,
	changes: Partial<SessionViewModel>
): SessionWorkspace[] {
	return workspaces.map((workspace) => ({
		...workspace,
		sessions: workspace.sessions.map((candidate) => (candidate.id === id ? { ...candidate, ...changes } : candidate))
	}));
}

export const bayFixtures = {
	busy,
	/**
	 * The same bay after Diff gutter numbers asks for a permission, for the
	 * arrival. Like the store, it keeps the agent's status and sets the dialog.
	 */
	arrived: withStatus(busy, 'pau-diff', {
		attention: 'An extension is waiting for your answer.',
		extensionUi: { notifications: [], statuses: [], widgets: [], dialog: { ...permissionDialog, id: 'dialog-diff' } }
	}),
	/** The open session failed. */
	failed: withStatus(busy, 'sandbox-pi', {
		status: 'failed',
		error: 'The sandbox extension never reported ready.',
		extensionUi: undefined
	}),
	withStatus
};
