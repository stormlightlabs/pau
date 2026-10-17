import type { AgentSession, ServerEvent, Workspace } from '@stormlightlabs/pau-protocol';
import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { FakeEventSocket } from './fake-event-socket';
import SessionRoute from './SessionRoute.svelte';

const workspace: Workspace = {
	id: 'pau',
	path: '/home/me/pau',
	name: 'Pau',
	created_at: '2026-04-01T12:00:00Z',
	updated_at: '2026-04-01T12:00:00Z'
};

const idleSession: AgentSession = {
	id: 'session-1',
	workspace_id: 'pau',
	status: 'idle',
	started_at: '2026-04-01T12:00:00Z',
	ended_at: null,
	exit_code: null,
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
		stop: true
	}
};

type Route = (init?: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Serves the session API from in-memory routes keyed by method and path. */
function fakeBackend(routes: Record<string, Route>) {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const key = `${init?.method ?? 'GET'} ${String(input)}`;
		const route = routes[key];
		if (!route) return json({ code: 'not_found', message: `No route for ${key}` }, 404);
		return route(init);
	});
}

function setup(routes: Record<string, Route>) {
	const sockets: FakeEventSocket[] = [];
	const fetcher = fakeBackend({
		'GET /api/workspaces': () => json([workspace]),
		'GET /api/sessions': () => json([]),
		...routes
	});
	const socketFactory = (url: string) => {
		const socket = new FakeEventSocket(url);
		sockets.push(socket);
		return socket;
	};
	return { fetcher, sockets, props: { search: '', fetcher, socketFactory } };
}

/** The test viewport is narrow, so the session rail starts collapsed. */
async function startFromRail(): Promise<void> {
	await userEvent.click(page.getByRole('button', { name: 'Open navigation' }));
	await userEvent.click(page.getByRole('button', { name: 'Start session in Pau' }));
}

let sequence = 0;
function output(payload: unknown): { type: 'event'; event: ServerEvent } {
	sequence += 1;
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

test('shows the loading state until the session list arrives', async () => {
	const { props } = setup({ 'GET /api/sessions': () => new Promise<Response>(() => {}) });
	await render(SessionRoute, props);

	await expect.element(page.getByRole('heading', { name: 'Loading sessions…' })).toBeVisible();
});

test('streams a live transcript and sends prompts to the session', async () => {
	const prompt = vi.fn(() => new Response(null, { status: 202 }));
	const { props, sockets } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'POST /api/sessions/session-1/prompt': prompt
	});
	await render(SessionRoute, props);
	sockets[0]?.open();

	sockets[0]?.receive(output({ type: 'message_start', message: { role: 'user', content: 'Fix the gutter' } }));
	sockets[0]?.receive(output({ type: 'message_start', message: { role: 'assistant', content: [] } }));
	sockets[0]?.receive(
		output({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Reading' } })
	);
	await expect.element(page.getByRole('heading', { name: 'Fix the gutter' })).toBeVisible();
	await expect.element(page.getByText('Reading')).toBeVisible();

	sockets[0]?.receive(
		output({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Gutter fixed.' }] } })
	);
	await expect.element(page.getByText('Gutter fixed.')).toBeVisible();

	await userEvent.type(page.getByRole('textbox', { name: 'Prompt' }), 'Add a test.');
	await userEvent.click(page.getByRole('button', { name: /Send prompt/ }));
	expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ body: '{"message":"Add a test.","queue":null,"images":null}' }));
});

test.each([
	['pi_unavailable', 503, 'Pau could not find a working Pi installation.'],
	['sandboxed_session_unsupported', 501, 'This workspace uses a sandbox']
])('explains a %s start failure', async (code, status, expected) => {
	const { props } = setup({ 'POST /api/sessions': () => json({ code, message: 'backend detail' }, status) });
	await render(SessionRoute, props);

	await startFromRail();

	await expect.element(page.getByRole('heading', { name: 'Could not start a session in Pau' })).toBeVisible();
	await expect.element(page.getByRole('alert')).toHaveTextContent(expected);
});

test('shows a started session and selects it', async () => {
	const changes: string[] = [];
	const { props } = setup({ 'POST /api/sessions': () => json({ ...idleSession, status: 'starting' }, 201) });
	await render(SessionRoute, { ...props, onSessionChange: (_workspace: string, id: string) => changes.push(id) });

	await startFromRail();

	await expect.element(page.getByText('Starting the agent process…')).toBeVisible();
	expect(changes).toEqual(['session-1']);
});

test('shows the disconnected state when the event stream drops', async () => {
	const { props, sockets } = setup({ 'GET /api/sessions': () => json([idleSession]) });
	await render(SessionRoute, props);
	sockets[0]?.open();
	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toBeEnabled();

	sockets[0]?.disconnect();

	await expect.element(page.getByText('Pau lost its connection to the backend', { exact: false })).toBeVisible();
	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toBeDisabled();
	await userEvent.click(page.getByRole('button', { name: 'Open navigation' }));
	await expect.element(page.getByRole('button', { name: 'Start session in Pau' })).toBeDisabled();
});

test('reports a disconnected backend when the session list cannot load', async () => {
	const { props } = setup({ 'GET /api/sessions': () => Promise.reject(new TypeError('Failed to fetch')) });
	await render(SessionRoute, props);

	await expect.element(page.getByText('Disconnected', { exact: true })).toBeVisible();
});
