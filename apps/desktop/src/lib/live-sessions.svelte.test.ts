import type { AgentSession, ServerEvent } from '@stormlightlabs/pau-protocol';
import { flushSync } from 'svelte';
import { expect, test, vi } from 'vitest';

import { FakeEventSocket } from './fake-event-socket';
import { LiveSessions } from './live-sessions.svelte';

const session = {
	id: 'session-1',
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
