import type { AgentSession, ServerEvent } from '@stormlightlabs/pau-protocol';
import { expect, test, vi } from 'vitest';

import { emptyPiTranscript } from './pi-transcript';
import { reduceClaudeEvent } from './claude-transcript';
import { FakeEventSocket } from './fake-event-socket';
import { LiveSessions } from './live-sessions.svelte';

const NATIVE_ID = '0b5e8a3c-6f1d-4c2a-9e7b-3d4f5a6b7c8d';

const claude = {
	id: 'claude-1',
	agent: 'claude',
	workspace_id: 'pau',
	status: 'idle',
	started_at: '2026-04-01T12:00:00Z',
	ended_at: null,
	exit_code: null,
	native_session_id: null,
	thinking_level: null,
	thinking_levels: [],
	name: null,
	capabilities: { prompt: true, interrupt: true, stop: true }
} as unknown as AgentSession;

const counter = { sequence: 0 };

function event(sessionId: string, kind: ServerEvent['kind'], payload: unknown): { type: 'event'; event: ServerEvent } {
	counter.sequence += 1;
	return {
		type: 'event',
		event: {
			sequence: counter.sequence,
			timestamp: '2026-04-01T12:00:01Z',
			workspace_id: 'pau',
			session_id: sessionId,
			kind,
			payload: JSON.stringify(payload)
		}
	};
}

const bridge = (name: string, payload: unknown) => ({ sequence: 0, event: name, payload });

/**
 * A store against a backend that runs a fake Claude bridge: it starts Claude
 * sessions, accepts prompts and interrupts, and records every request.
 */
async function setup() {
	const socket = new FakeEventSocket('ws://test');
	const requests: Array<{ method: string; url: string; body: unknown }> = [];
	let started = 0;
	const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
		requests.push({ method, url, body });
		if (url === '/api/sessions' && method === 'POST') {
			started += 1;
			const request = body as { native_session_id: string | null };
			return Response.json(
				{ ...claude, id: `claude-${started}`, native_session_id: request.native_session_id },
				{ status: 201 }
			);
		}
		if (url.endsWith('/prompt') && (body as { message: string }).message === 'refused')
			return Response.json(
				{ code: 'image_input_unsupported', message: 'Claude Code sessions do not accept images.' },
				{ status: 400 }
			);
		if (url.endsWith('/interrupt')) return Response.json({ steering: [], follow_up: [] });
		if (method === 'POST' || method === 'DELETE') return new Response(null, { status: 202 });
		return Response.json([]);
	});
	const sessions = new LiveSessions({
		browserOrigin: 'http://localhost',
		fetcher: fetcher as unknown as typeof fetch,
		socketFactory: () => socket,
		scheduleFrame: (flush) => flush()
	});
	sessions.connect();
	socket.open();
	await vi.waitFor(() => expect(sessions.loading).toBe(false));
	const find = (id: string) => sessions.workspaces.flatMap((workspace) => workspace.sessions).find((s) => s.id === id);
	return { sessions, socket, requests, find };
}

test('starts, streams, interrupts, and resumes a Claude session', async () => {
	const { sessions, socket, requests, find } = await setup();

	const id = await sessions.start('pau', 'claude');
	expect(requests.at(-1)).toMatchObject({ method: 'POST', body: { agent: 'claude', native_session_id: null } });
	socket.receive(event(id, 'session_changed', { ...claude, id }));
	expect(find(id)).toMatchObject({ agent: 'Claude Code', capabilities: { prompt: true, steer: undefined } });

	// The reply starts streaming before the prompt request returns.
	const sending = sessions.send(id, 'Inspect the change');
	socket.receive(event(id, 'session_output', bridge('text.delta', { text: 'Reading ' })));
	await sending;
	socket.receive(event(id, 'session_changed', { ...claude, id, status: 'running' }));
	socket.receive(event(id, 'session_output', bridge('text.delta', { text: 'the diff.' })));
	socket.receive(
		event(id, 'session_output', bridge('tool.started', { id: 't1', name: 'Read', input: { file_path: 'src/a.ts' } }))
	);
	socket.receive(
		event(id, 'session_output', bridge('tool.completed', { id: 't1', content: [{ type: 'text', text: 'one' }] }))
	);
	expect(find(id)?.transcript).toEqual([
		{ id: 'claude-1', kind: 'message', role: 'user', body: 'Inspect the change' },
		{ id: 'claude-0', kind: 'message', role: 'assistant', body: 'Reading the diff.' },
		{ id: 'tool:t1', kind: 'tool', name: 'Read', detail: 'src/a.ts', result: 'one', status: 'complete' }
	]);
	expect(find(id)?.status).toBe('running');

	await sessions.interrupt(id);
	expect(requests.at(-1)).toMatchObject({ method: 'POST', url: `/api/sessions/${id}/interrupt` });
	socket.receive(
		event(id, 'session_output', bridge('turn.completed', { status: 'interrupted', sessionId: NATIVE_ID }))
	);
	socket.receive(event(id, 'session_changed', { ...claude, id, native_session_id: NATIVE_ID }));
	socket.receive(event(id, 'session_changed', { ...claude, id, native_session_id: NATIVE_ID, status: 'stopped' }));
	expect(find(id)?.status).toBe('stopped');

	const resumed = await sessions.restart(id);
	expect(requests.at(-1)).toMatchObject({
		method: 'POST',
		url: '/api/sessions',
		body: { agent: 'claude', native_session_id: NATIVE_ID }
	});
	expect(resumed).not.toBe(id);

	// The bridge keeps no history or extension UI, so nothing asks for them.
	expect(await sessions.history(resumed)).toEqual([]);
	expect(requests.some(({ url }) => /\/(messages|history|extension-ui)$/.test(url))).toBe(false);
});

test('a refused Claude prompt leaves the transcript as it was', async () => {
	const { sessions, socket, find } = await setup();
	const id = await sessions.start('pau', 'claude');
	socket.receive(event(id, 'session_changed', { ...claude, id }));

	await expect(sessions.send(id, 'refused')).rejects.toThrow('do not accept images');
	expect(find(id)?.transcript).toEqual([]);
});

test('shows a failed Claude turn as a failed reply', () => {
	const transcript = reduceClaudeEvent(
		emptyPiTranscript,
		bridge('turn.completed', { status: 'failed', error: 'overloaded' })
	);
	expect(transcript.entries).toEqual([
		{
			id: 'claude-0',
			kind: 'message',
			role: 'assistant',
			body: 'Claude Code could not finish this turn: overloaded',
			failed: true
		}
	]);
});
