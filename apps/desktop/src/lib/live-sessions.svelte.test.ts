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
	return { socket, frames, transcript, flushFrame };
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
