import type { AgentSession, ServerEvent } from '@stormlightlabs/pau-protocol';
import { flushSync } from 'svelte';
import { expect, test, vi } from 'vitest';

import { FakeEventSocket } from './fake-event-socket';
import { LiveSessions } from './live-sessions.svelte';

const session = {
	id: 'session-1',
	agent: 'pi',
	workspace_id: 'pau',
	status: 'idle',
	started_at: '2026-04-01T12:00:00Z',
	ended_at: null,
	exit_code: null,
	native_session_id: null,
	thinking_level: null,
	thinking_levels: [],
	name: null,
	capabilities: {}
} as unknown as AgentSession;

function output(sequence: number, payload: unknown): { type: 'event'; event: ServerEvent } {
	return {
		type: 'event',
		event: {
			sequence,
			timestamp: '2026-04-01T12:00:01Z',
			workspace_id: 'pau',
			session_id: 'session-1',
			kind: 'session_output',
			payload: JSON.stringify(payload)
		}
	};
}

const delta = (text: string) => ({
	type: 'message_update',
	assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: text }
});

/** A store whose frames only run when the test flushes them. */
async function setup() {
	const frames: Array<() => void> = [];
	const socket = new FakeEventSocket('ws://test');
	const fetcher = vi.fn(async (input: RequestInfo | URL) =>
		Response.json(String(input) === '/api/sessions' ? [session] : [], {
			headers: { 'Content-Type': 'application/json' }
		})
	);
	const sessions = new LiveSessions({
		browserOrigin: 'http://localhost',
		fetcher: fetcher as unknown as typeof fetch,
		socketFactory: () => socket,
		scheduleFrame: (flush) => {
			frames.push(flush);
		}
	});
	sessions.connect();
	socket.open();
	await vi.waitFor(() => expect(sessions.workspaces.flatMap((workspace) => workspace.sessions)).toHaveLength(1));
	const transcript = () => sessions.workspaces[0]?.sessions[0]?.transcript ?? [];
	const flushFrame = () => {
		for (const flush of frames.splice(0)) flush();
	};
	const change = (status: AgentSession['status'], sequence: number) =>
		socket.receive({
			type: 'event',
			event: {
				sequence,
				timestamp: '2026-04-01T12:00:02Z',
				workspace_id: 'pau',
				session_id: 'session-1',
				kind: 'session_changed',
				payload: JSON.stringify({ ...session, status })
			}
		});
	const unseen = () => sessions.workspaces[0]?.sessions[0]?.unseen;
	return { sessions, socket, frames, transcript, flushFrame, change, unseen };
}

test('commits a burst of deltas once per frame', async () => {
	const { socket, frames, transcript, flushFrame } = await setup();
	let commits = 0;
	const stop = $effect.root(() => {
		$effect(() => {
			transcript();
			commits += 1;
		});
	});
	flushSync();
	const before = commits;

	socket.receive(output(1, { type: 'message_start', message: { role: 'assistant', content: [] } }));
	for (const [index, word] of ['Read', 'ing ', 'the ', 'gutter'].entries())
		socket.receive(output(index + 2, delta(word)));
	flushSync();
	expect(commits).toBe(before);
	expect(frames).toHaveLength(1);

	flushFrame();
	flushSync();
	expect(commits).toBe(before + 1);
	expect(transcript()).toMatchObject([{ body: 'Reading the gutter' }]);
	stop();
});

test('applies message_end after batched text', async () => {
	const { socket, transcript, flushFrame } = await setup();

	socket.receive(output(1, { type: 'message_start', message: { role: 'assistant', content: [] } }));
	socket.receive(output(2, delta('Draft')));
	socket.receive(
		output(3, { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Final.' }] } })
	);
	flushFrame();

	const bodies = transcript().map((entry) => ('body' in entry ? entry.body : undefined));
	expect(bodies).toContain('Final.');
	expect(bodies).not.toContain('Draft');
});

test.each([
	['waits for input', 'waiting', ['waiting']],
	['fails', 'failed', ['running', 'failed']],
	['stops responding', 'not_responding', ['running', 'not_responding']],
	['finishes a turn', 'idle', ['running', 'idle']]
] as const)('marks a session out of view that %s', async (_name, _final, statuses) => {
	const { sessions, change, unseen } = await setup();
	sessions.view('other');

	for (const [index, status] of statuses.entries()) change(status, index + 1);

	expect(unseen()).toBe(true);
});

test('does not mark the viewed session or a session that merely starts running', async () => {
	const { sessions, change, unseen } = await setup();

	sessions.view('session-1');
	change('running', 1);
	change('idle', 2);
	expect(unseen()).toBe(false);

	sessions.view('other');
	change('running', 3);
	expect(unseen()).toBe(false);
});

test('clears a marker when the session is viewed and all markers on request', async () => {
	const { sessions, change, unseen } = await setup();
	sessions.view('other');
	change('waiting', 1);
	expect(unseen()).toBe(true);

	sessions.view('session-1');
	expect(unseen()).toBe(false);

	sessions.view('other');
	change('idle', 2);
	change('failed', 3);
	expect(unseen()).toBe(true);
	sessions.clearUnseen();
	expect(unseen()).toBe(false);
});

test('offers the thinking levels Pi reports for the current model', async () => {
	const { sessions, socket } = await setup();
	const levels = () => sessions.workspaces[0]?.sessions[0]?.thinkingLevels;
	const report = (thinking_levels: AgentSession['thinking_levels'], sequence: number) =>
		socket.receive({
			type: 'event',
			event: {
				sequence,
				timestamp: '2026-04-01T12:00:02Z',
				workspace_id: 'pau',
				session_id: 'session-1',
				kind: 'session_changed',
				payload: JSON.stringify({ ...session, thinking_levels })
			}
		});

	// Pi has not reported levels yet.
	expect(levels()).toBeUndefined();

	report(['off', 'low', 'medium', 'high'], 1);
	await vi.waitFor(() => expect(levels()).toEqual(['off', 'low', 'medium', 'high']));

	// A model without reasoning offers only `off`.
	report(['off'], 2);
	await vi.waitFor(() => expect(levels()).toEqual(['off']));
});

test('reads the workspace branch on load and again after a run settles', async () => {
	const socket = new FakeEventSocket('ws://test');
	let branch: string | null = 'main';
	const fetcher = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.endsWith('/api/sessions')) return Response.json([session]);
		if (url.endsWith('/api/workspaces')) return Response.json([{ id: 'pau', name: 'Pau', path: '/work/pau' }]);
		if (url.endsWith('/api/workspaces/pau/git/status')) return Response.json({ repository: true, branch, head: null });
		return Response.json([]);
	});
	const sessions = new LiveSessions({
		browserOrigin: 'http://localhost',
		fetcher: fetcher as unknown as typeof fetch,
		socketFactory: () => socket,
		scheduleFrame: () => {}
	});
	sessions.connect();
	socket.open();
	await vi.waitFor(() => expect(sessions.workspaces[0]).toMatchObject({ path: '/work/pau', branch: 'main' }));

	const change = (status: AgentSession['status'], sequence: number) =>
		socket.receive({
			type: 'event',
			event: {
				sequence,
				timestamp: '2026-04-01T12:00:02Z',
				workspace_id: 'pau',
				session_id: 'session-1',
				kind: 'session_changed',
				payload: JSON.stringify({ ...session, status })
			}
		});
	branch = 'feature';
	change('running', 1);
	expect(sessions.workspaces[0]?.branch).toBe('main');
	change('idle', 2);
	await vi.waitFor(() => expect(sessions.workspaces[0]?.branch).toBe('feature'));

	// A detached HEAD has no branch to show.
	branch = null;
	change('running', 3);
	change('idle', 4);
	await vi.waitFor(() => expect(sessions.workspaces[0]?.branch).toBeUndefined());
});

/**
 * A store on one workspace, `pau`, whose API answers from `routes` by path
 * suffix. A route that throws fails that read. Other paths answer `[]`.
 */
async function workspaceStore(routes: Record<string, () => unknown>) {
	const socket = new FakeEventSocket('ws://test');
	const fetcher = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.endsWith('/api/sessions')) return Response.json([session]);
		if (url.endsWith('/api/workspaces')) return Response.json([{ id: 'pau', name: 'Pau', path: '/work/pau' }]);
		const route = Object.entries(routes).find(([suffix]) => url.endsWith(suffix));
		if (!route) return Response.json([]);
		try {
			return Response.json(route[1]());
		} catch {
			return Response.json({ code: 'internal', message: 'Read failed.' }, { status: 500 });
		}
	});
	const sessions = new LiveSessions({
		browserOrigin: 'http://localhost',
		fetcher: fetcher as unknown as typeof fetch,
		socketFactory: () => socket,
		scheduleFrame: () => {}
	});
	sessions.connect();
	socket.open();
	await vi.waitFor(() => expect(sessions.workspaces[0]?.sessions).toHaveLength(1));
	const event = (kind: ServerEvent['kind'], sequence: number, payload: unknown = {}) =>
		socket.receive({
			type: 'event',
			event: {
				sequence,
				timestamp: '2026-04-01T12:00:02Z',
				workspace_id: 'pau',
				session_id: kind === 'session_changed' ? 'session-1' : null,
				kind,
				payload: JSON.stringify(payload)
			}
		});
	return { sessions, event, workspace: () => sessions.workspaces[0] };
}

const sandboxed = (profile: string, domains: string[]) => ({
	mode: 'sandboxed',
	settings: { profile, grants: { domains, writable_roots: [], unix_sockets: false }, home_read_deny: false }
});

test('summarizes the workspace sandbox from the API and follows sandbox changes', async () => {
	let read: () => unknown = () => ({
		selection: sandboxed('workspace-write', []),
		unavailable: null,
		terminal_unavailable: null
	});
	const { event, workspace } = await workspaceStore({ '/api/workspaces/pau/sandbox': () => read() });
	await vi.waitFor(() => expect(workspace()?.sandbox).toEqual({ sandboxed: true, label: 'Sandbox on, network off' }));

	event('sandbox_changed', 1, sandboxed('read-only', ['api.anthropic.com']));
	expect(workspace()?.sandbox).toEqual({ sandboxed: true, label: 'Read-only sandbox, 1 domain allowed' });
	event('sandbox_changed', 2, sandboxed('workspace-write', ['a.example', 'b.example']));
	expect(workspace()?.sandbox?.label).toBe('Sandbox on, 2 domains allowed');
	event('sandbox_changed', 3, { mode: 'unsandboxed' });
	expect(workspace()?.sandbox).toEqual({ sandboxed: false, label: 'No sandbox' });

	read = () => {
		throw new Error('unreadable');
	};
	// A sandbox that cannot be read stays unknown, which the workspace column says.
	const failed = await workspaceStore({ '/api/workspaces/pau/sandbox': () => read() });
	await new Promise((settle) => setTimeout(settle, 0));
	expect(failed.workspace()?.sandbox).toBeUndefined();
});

test("lists each workspace's terminals and reads them again when one changes", async () => {
	let terminals = [
		{ id: 'terminal-1', workspace_id: 'pau', command: ['/bin/zsh', '-l'], status: { state: 'running' } },
		{ id: 'terminal-2', workspace_id: 'other', command: ['/bin/bash'], status: { state: 'running' } }
	];
	const { event, workspace } = await workspaceStore({ '/api/terminals': () => terminals });
	await vi.waitFor(() =>
		expect(workspace()?.terminals).toEqual([{ id: 'terminal-1', label: 'zsh', status: 'Running' }])
	);

	terminals = [
		{
			id: 'terminal-1',
			workspace_id: 'pau',
			command: ['/bin/zsh', '-l'],
			status: { state: 'exited', exit_code: 1, signal: null }
		} as never,
		{
			id: 'terminal-3',
			workspace_id: 'pau',
			command: [],
			status: { state: 'exited', exit_code: 0, signal: null }
		} as never
	];
	event('terminal_changed', 1);
	await vi.waitFor(() =>
		expect(workspace()?.terminals).toEqual([
			{ id: 'terminal-1', label: 'zsh', status: 'Exited 1', failed: true },
			{ id: 'terminal-3', label: 'Shell', status: 'Exited 0', failed: false }
		])
	);
});

test('shows the Git status of a workspace and keeps the last one when a read fails', async () => {
	const status = {
		repository: true,
		branch: 'main',
		head: '3f9c2a7',
		detached: false,
		files: [{ path: 'src/lib.rs', previous_path: null, staged: null, worktree: 'modified', conflicted: false }]
	};
	let read: () => unknown = () => status;
	const { event, workspace } = await workspaceStore({ '/api/workspaces/pau/git/status': () => read() });
	await vi.waitFor(() => expect(workspace()?.git).toEqual(status));

	read = () => {
		throw new Error('unreadable');
	};
	event('session_changed', 1, { ...session, status: 'running' });
	event('session_changed', 2, { ...session, status: 'idle' });
	await new Promise((settle) => setTimeout(settle, 0));
	expect(workspace()?.git).toEqual(status);
});

test('titles a session by its agent until the first prompt', async () => {
	const { sessions, socket } = await setup();
	const title = () => sessions.workspaces[0]?.sessions[0]?.title;
	expect(title()).toBe('New Pi session');

	socket.receive({
		type: 'event',
		event: {
			sequence: 1,
			timestamp: '2026-04-01T12:00:02Z',
			workspace_id: 'pau',
			session_id: 'session-1',
			kind: 'session_changed',
			payload: JSON.stringify({ ...session, agent: 'claude' })
		}
	});
	expect(title()).toBe('New Claude Code session');
});

test('names the agent of a failed session', async () => {
	const { sessions, socket } = await setup();

	socket.receive({
		type: 'event',
		event: {
			sequence: 1,
			timestamp: '2026-04-01T12:00:02Z',
			workspace_id: 'pau',
			session_id: 'session-1',
			kind: 'session_changed',
			payload: JSON.stringify({ ...session, agent: 'claude', status: 'failed', exit_code: 2 })
		}
	});

	expect(sessions.workspaces[0]?.sessions[0]?.error).toBe(
		'Claude Code exited with code 2. Start a new session to continue.'
	);
});
