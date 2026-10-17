import type {
	AgentSession,
	ExtensionDialog,
	ServerEvent,
	SessionExtensionUi,
	Workspace
} from '@stormlightlabs/pau-protocol';
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
	expect(prompt).toHaveBeenCalledWith(
		expect.objectContaining({ body: '{"message":"Add a test.","queue":null,"images":null}' })
	);
});

test('recalls earlier prompts fetched when the session opens', async () => {
	const { props } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'GET /api/sessions/session-1/history': () => json(['Fix the gutter', 'Read the spec'])
	});
	await render(SessionRoute, props);
	const prompt = page.getByRole('textbox', { name: 'Prompt' });

	await userEvent.click(prompt);
	await vi.waitFor(async () => {
		await userEvent.keyboard('{ArrowUp}');
		await expect.element(prompt).toHaveValue('Fix the gutter');
	});
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

const wireDialogs = {
	select: {
		kind: 'select',
		id: 'ask-select',
		title: 'Choose a profile',
		options: ['Review', 'Work'],
		timeout_ms: null
	},
	confirm: {
		kind: 'confirm',
		id: 'ask-confirm',
		title: 'Allow update?',
		message: 'This edits the index.',
		timeout_ms: null
	},
	input: { kind: 'input', id: 'ask-input', title: 'Name the task', placeholder: 'Task name', timeout_ms: null },
	editor: { kind: 'editor', id: 'ask-editor', title: 'Edit instructions', prefill: 'First line' }
} satisfies Record<string, ExtensionDialog>;

function extensionUi(...dialogs: ExtensionDialog[]): SessionExtensionUi {
	return { dialogs, statuses: [], widgets: [] };
}

/** An idle session with the given extension UI and recorders for reads and answers. */
function setupExtensionSession(state: SessionExtensionUi, answer: Route = () => new Response(null, { status: 204 })) {
	const respond = vi.fn(answer);
	const read = vi.fn(() => json(state));
	const backend = setup({
		'GET /api/sessions': () => json([idleSession]),
		'GET /api/sessions/session-1/extension-ui': read,
		[`POST /api/sessions/session-1/extension-ui/${state.dialogs[0]?.id ?? 'none'}`]: respond
	});
	return { ...backend, respond, read };
}

/** Session output stamped now, so notifications count as live rather than replayed. */
function liveOutput(payload: unknown): { type: 'event'; event: ServerEvent } {
	const message = output(payload);
	return { ...message, event: { ...message.event, timestamp: new Date().toISOString() } };
}

function sessionChanged(session: AgentSession): { type: 'event'; event: ServerEvent } {
	sequence += 1;
	return {
		type: 'event',
		event: {
			sequence,
			timestamp: new Date().toISOString(),
			workspace_id: session.workspace_id,
			session_id: session.id,
			kind: 'session_changed',
			payload: JSON.stringify(session)
		}
	};
}

test.each([
	{
		dialog: wireDialogs.select,
		body: { value: 'Work' },
		answer: () => userEvent.click(page.getByRole('button', { name: 'Work' }))
	},
	{
		dialog: wireDialogs.confirm,
		body: { confirmed: true },
		answer: () => userEvent.click(page.getByRole('button', { name: 'Yes' }))
	},
	{
		dialog: wireDialogs.input,
		body: { value: 'Review RPC' },
		answer: async () => {
			await userEvent.type(page.getByRole('textbox', { name: 'Response' }), 'Review RPC');
			await userEvent.click(page.getByRole('button', { name: 'Submit' }));
		}
	},
	{
		dialog: wireDialogs.editor,
		body: { value: 'First line' },
		answer: () => userEvent.click(page.getByRole('button', { name: 'Submit' }))
	}
])('answers a waiting $dialog.kind dialog', async ({ dialog, body, answer }) => {
	const { props, respond } = setupExtensionSession(extensionUi(dialog));
	await render(SessionRoute, props);

	await expect.element(page.getByRole('dialog', { name: dialog.title })).toBeVisible();
	await answer();

	expect(respond).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }));
	await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
});

test('cancels a dialog', async () => {
	const { props, respond } = setupExtensionSession(extensionUi(wireDialogs.select));
	await render(SessionRoute, props);

	await userEvent.click(page.getByRole('button', { name: 'Cancel' }));

	expect(respond).toHaveBeenCalledWith(expect.objectContaining({ body: '{"cancelled":true}' }));
	await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
});

test('offers only dismissal for a request Pau cannot render', async () => {
	const { props, respond } = setupExtensionSession(
		extensionUi({ kind: 'unsupported', id: 'ask-custom', method: 'custom' })
	);
	await render(SessionRoute, props);

	await expect.element(page.getByText(/Pau cannot render/)).toBeVisible();
	await userEvent.click(page.getByRole('button', { name: 'Dismiss' }));

	expect(respond).toHaveBeenCalledWith(expect.objectContaining({ body: '{"cancelled":true}' }));
});

test('closes an open dialog when the session exits', async () => {
	const { props, sockets } = setupExtensionSession(extensionUi(wireDialogs.confirm));
	await render(SessionRoute, props);
	sockets[0]?.open();
	await expect.element(page.getByRole('dialog', { name: 'Allow update?' })).toBeVisible();

	sockets[0]?.receive(liveOutput({ type: 'extension_ui_resolved', id: 'ask-confirm', reason: 'exited' }));
	sockets[0]?.receive(sessionChanged({ ...idleSession, status: 'failed', exit_code: 1 }));

	await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
	await expect.element(page.getByText('The session ended before the extension request was answered.')).toBeVisible();
});

test('explains an answer to a request that already stopped waiting', async () => {
	const { props } = setupExtensionSession(extensionUi(wireDialogs.confirm), () =>
		json({ code: 'extension_request_not_found', message: 'gone' }, 404)
	);
	await render(SessionRoute, props);

	await userEvent.click(page.getByRole('button', { name: 'No' }));

	await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
	await expect
		.element(page.getByText('That extension request was already answered, cancelled, or expired.'))
		.toBeVisible();
});

test('keeps a dialog open and shows why an answer was rejected', async () => {
	const { props } = setupExtensionSession(extensionUi(wireDialogs.select), () =>
		json({ code: 'invalid_extension_response', message: 'The value is not one of the offered options.' }, 422)
	);
	await render(SessionRoute, props);

	await userEvent.click(page.getByRole('button', { name: 'Review' }));

	await expect
		.element(page.getByRole('dialog').getByRole('alert'))
		.toHaveTextContent('The extension could not use that answer. The value is not one of the offered options.');
});

test('reads new dialogs and applies notifications, status text, and widgets from the stream', async () => {
	let state = extensionUi();
	const read = vi.fn(() => json(state));
	const { props, sockets } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'GET /api/sessions/session-1/extension-ui': read
	});
	await render(SessionRoute, props);
	sockets[0]?.open();
	await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());

	state = extensionUi(wireDialogs.select);
	sockets[0]?.receive(
		liveOutput({ type: 'extension_ui_request', id: 'ask-select', method: 'select', title: 'Choose', options: [] })
	);
	sockets[0]?.receive(liveOutput({ type: 'extension_ui_request', id: 'n1', method: 'notify', message: 'Index ready' }));
	sockets[0]?.receive(
		liveOutput({
			type: 'extension_ui_request',
			id: 's1',
			method: 'setStatus',
			statusKey: 'mcp',
			statusText: 'Connecting'
		})
	);
	sockets[0]?.receive(
		liveOutput({
			type: 'extension_ui_request',
			id: 'w1',
			method: 'setWidget',
			widgetKey: 'details',
			widgetLines: ['Tools: 3'],
			widgetPlacement: 'belowEditor'
		})
	);

	await expect.element(page.getByRole('dialog', { name: 'Choose a profile' })).toBeVisible();
	await expect.element(page.getByText('Index ready')).toBeInTheDocument();
	await expect.element(page.getByText('Connecting')).toBeInTheDocument();
	await expect.element(page.getByRole('region', { name: 'Extension widget: details' })).toHaveTextContent('Tools: 3');
});

test('ignores replayed notifications', async () => {
	const { props, sockets } = setupExtensionSession(extensionUi());
	await render(SessionRoute, props);
	sockets[0]?.open();

	sockets[0]?.receive(output({ type: 'extension_ui_request', id: 'old', method: 'notify', message: 'Old news' }));
	sockets[0]?.receive(liveOutput({ type: 'extension_ui_request', id: 'new', method: 'notify', message: 'New news' }));

	await expect.element(page.getByText('New news')).toBeInTheDocument();
	await expect.element(page.getByText('Old news')).not.toBeInTheDocument();
});

test('reads the extension UI again after the stream reconnects', async () => {
	const { props, sockets, read } = setupExtensionSession(extensionUi());
	await render(SessionRoute, props);
	sockets[0]?.open();
	await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());

	sockets[0]?.disconnect();
	await vi.waitFor(() => expect(sockets).toHaveLength(2), { timeout: 3000 });
	sockets[1]?.open();

	await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
});

const savedList = {
	sessions: [
		{
			id: 'native-1',
			name: null,
			first_message: 'Fix the gutter',
			created_at: '2026-04-01T10:00:00Z',
			modified_at: '2026-04-01T11:00:00Z',
			path: '/home/me/.pi/native-1.jsonl'
		}
	],
	warnings: []
};

async function openSavedSessions(): Promise<void> {
	await userEvent.click(page.getByRole('button', { name: 'Open navigation' }));
	await userEvent.click(page.getByRole('button', { name: 'Browse saved sessions in Pau' }));
}

test('resumes a saved session from the picker and selects it', async () => {
	const start = vi.fn(() => json({ ...idleSession, status: 'starting' }, 201));
	const changes: string[] = [];
	const { props } = setup({
		'GET /api/workspaces/pau/pi-sessions': () => json(savedList),
		'POST /api/sessions': start
	});
	await render(SessionRoute, { ...props, onSessionChange: (_workspace: string, id: string) => changes.push(id) });

	await openSavedSessions();
	await userEvent.click(page.getByRole('button', { name: 'Resume Fix the gutter' }));

	await expect.element(page.getByText('Starting the agent process…')).toBeVisible();
	expect(start).toHaveBeenCalledWith(
		expect.objectContaining({ body: '{"workspace_id":"pau","model":null,"native_session_id":"native-1"}' })
	);
	expect(changes).toEqual(['session-1']);
});

test.each([
	['native_session_not_found', 404, 'Pi no longer has that saved session'],
	['invalid_native_session', 422, 'Pi could not read that saved session']
])('explains a %s resume failure', async (code, status, expected) => {
	const { props } = setup({
		'GET /api/workspaces/pau/pi-sessions': () => json(savedList),
		'POST /api/sessions': () => json({ code, message: 'backend detail' }, status)
	});
	await render(SessionRoute, props);

	await openSavedSessions();
	await userEvent.click(page.getByRole('button', { name: 'Resume Fix the gutter' }));

	await expect.element(page.getByRole('alert')).toHaveTextContent(expected);
});

const modelList = (current: string) => [
	{ provider: 'anthropic', id: 'sonnet', name: 'Sonnet', reasoning: true, current: current === 'sonnet' },
	{ provider: 'openai', id: 'gpt-5', name: null, reasoning: false, current: current === 'gpt-5' }
];

test('lists models, switches the session model, and refreshes the header', async () => {
	let current = 'sonnet';
	const select = vi.fn(() => {
		current = 'gpt-5';
		return json({ id: 'gpt-5' });
	});
	const { props } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'GET /api/sessions/session-1/models': () => json(modelList(current)),
		'PUT /api/sessions/session-1/model': select
	});
	await render(SessionRoute, { ...props, initialSessionId: 'session-1' });

	await userEvent.click(page.getByRole('button', { name: 'Model: Sonnet' }));
	await userEvent.click(page.getByRole('button', { name: /gpt-5/ }));

	expect(select).toHaveBeenCalledWith(expect.objectContaining({ body: '{"provider":"openai","model_id":"gpt-5"}' }));
	await expect.element(page.getByRole('button', { name: 'Model: gpt-5' })).toBeVisible();
});

test.each([
	['invalid_session_state', 409, 'wait for the run to finish'],
	['control_rejected', 422, 'Pi rejected the request: No API key for openai']
])('explains a %s model selection failure', async (code, status, expected) => {
	const { props } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'GET /api/sessions/session-1/models': () => json(modelList('sonnet')),
		'PUT /api/sessions/session-1/model': () => json({ code, message: 'No API key for openai' }, status)
	});
	await render(SessionRoute, { ...props, initialSessionId: 'session-1' });

	await userEvent.click(page.getByRole('button', { name: 'Model: Sonnet' }));
	await userEvent.click(page.getByRole('button', { name: /gpt-5/ }));

	await expect.element(page.getByRole('alert')).toHaveTextContent(expected);
});

test('disables the picker when the session cannot select models', async () => {
	const { props } = setup({
		'GET /api/sessions': () =>
			json([{ ...idleSession, capabilities: { ...idleSession.capabilities, model_selection: false } }])
	});
	await render(SessionRoute, { ...props, initialSessionId: 'session-1' });

	await expect.element(page.getByRole('button', { name: /^Model:/ })).toBeDisabled();
});

test('sets the thinking level and shows the level it sent', async () => {
	const put = vi.fn(() => new Response(null, { status: 204 }));
	const { props } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'GET /api/sessions/session-1/models': () => json(modelList('sonnet')),
		'PUT /api/sessions/session-1/thinking-level': put
	});
	await render(SessionRoute, { ...props, initialSessionId: 'session-1' });

	const control = page.getByRole('combobox', { name: 'Thinking level' });
	await expect.element(control).toBeEnabled();
	await userEvent.selectOptions(control, 'high');

	expect(put).toHaveBeenCalledWith(expect.objectContaining({ body: '{"level":"high"}' }));
	await expect.element(control).toHaveValue('high');
});

test('explains a rejected thinking level', async () => {
	const { props } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'GET /api/sessions/session-1/models': () => json(modelList('sonnet')),
		'PUT /api/sessions/session-1/thinking-level': () =>
			json({ code: 'control_rejected', message: 'Level not supported' }, 422)
	});
	await render(SessionRoute, { ...props, initialSessionId: 'session-1' });

	await userEvent.selectOptions(page.getByRole('combobox', { name: 'Thinking level' }), 'max');

	await expect.element(page.getByRole('alert')).toHaveTextContent('Pi rejected the request: Level not supported');
});
