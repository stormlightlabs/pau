import type { AgentSession, ServerEvent, Workspace } from '@stormlightlabs/pau-protocol';
import { createRawSnippet } from 'svelte';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { FakeEventSocket } from '$lib/fake-event-socket';
import Layout from './+layout.svelte';

const workspace: Workspace = {
	id: 'pau',
	path: '/home/me/pau',
	name: 'Pau',
	created_at: '2026-04-01T12:00:00Z',
	updated_at: '2026-04-01T12:00:00Z'
};

const session: AgentSession = {
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
	capabilities: {
		prompt: true,
		follow_up: true,
		steer: true,
		interrupt: true,
		message_queue: true,
		model_selection: true,
		thinking_level: true,
		command_discovery: true,
		usage: true,
		compaction: true,
		branching: true,
		retry: true,
		rename: true,
		clone_session: true,
		export_transcript: true,
		shell_commands: true,
		stop: true
	}
};

/** The fakes the layout's store and attention service are built with. */
const harness = vi.hoisted(() => ({
	storeSockets: [] as { open(): void }[],
	setBadgeCount: vi.fn<(count?: number) => Promise<void>>().mockResolvedValue(undefined),
	sessions: undefined as { view(sessionId?: string): void } | undefined
}));

vi.mock('$app/state', () => ({ page: { params: {}, route: { id: '/' } } }));

vi.mock('$lib/api', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getUiPreferences: async () => ({
		version: 1,
		theme: 'eldritch',
		ui_font: 'overpass',
		notifications: 'attention',
		motion: 'system',
		pane_widths: { context_rail: null, inspector: null },
		last_route: null
	})
}));

vi.mock('$lib/native-capabilities', async (importOriginal) => ({
	...(await importOriginal<object>()),
	createDesktopNativeCapabilities: () => ({ notify: async () => {}, setBadgeCount: harness.setBadgeCount })
}));

function storeSocket(url: string): FakeEventSocket {
	const socket = new FakeEventSocket(url);
	harness.storeSockets.push(socket);
	return socket;
}

async function fetcher(input: RequestInfo | URL): Promise<Response> {
	const path = String(input);
	if (path === '/api/workspaces') return Response.json([workspace]);
	if (path === '/api/sessions') return Response.json([{ ...session, id: 'session-2' }, session]);
	return Response.json({ code: 'not_found', message: path }, { status: 404 });
}

vi.mock('$lib/live-sessions.svelte', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/live-sessions.svelte')>();
	class TestLiveSessions extends original.LiveSessions {
		constructor(options: { browserOrigin: string }) {
			super({ ...options, fetcher, socketFactory: storeSocket, scheduleFrame: (flush) => flush() });
			harness.sessions = this;
		}
	}
	return { ...original, LiveSessions: TestLiveSessions };
});

vi.mock('$lib/session-attention', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/session-attention')>();
	class TestSessionAttention extends original.SessionAttention {
		constructor(options: ConstructorParameters<typeof original.SessionAttention>[0]) {
			super({ ...options, socketFactory: (url) => new FakeEventSocket(url) });
		}
	}
	return { ...original, SessionAttention: TestSessionAttention };
});

const counter = { sequence: 0 };

function changed(id: string, status: AgentSession['status']): { type: 'event'; event: ServerEvent } {
	counter.sequence += 1;
	return {
		type: 'event',
		event: {
			sequence: counter.sequence,
			timestamp: '2026-04-01T12:00:01Z',
			workspace_id: 'pau',
			session_id: id,
			kind: 'session_changed',
			payload: JSON.stringify({ ...session, id, status })
		}
	};
}

test('badges the app icon with the sessions in Needs you, in view or not', async () => {
	const children = createRawSnippet(() => ({ render: () => '<p>Session view</p>' }));
	await render(Layout, { children });
	const stream = () => harness.storeSockets[0] as FakeEventSocket;
	await expect.poll(() => stream()).toBeTruthy();
	stream().open();
	harness.sessions?.view('session-1');

	stream().receive(changed('session-1', 'waiting'));
	await expect.poll(() => harness.setBadgeCount.mock.lastCall).toEqual([1]);

	stream().receive(changed('session-2', 'failed'));
	await expect.poll(() => harness.setBadgeCount.mock.lastCall).toEqual([2]);

	stream().receive(changed('session-1', 'running'));
	await expect.poll(() => harness.setBadgeCount.mock.lastCall).toEqual([1]);

	stream().receive(changed('session-2', 'starting'));
	await expect.poll(() => harness.setBadgeCount.mock.lastCall).toEqual([undefined]);
});
