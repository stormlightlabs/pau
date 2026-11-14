import type {
	AgentSession,
	ExtensionDialog,
	LastRoute,
	ServerEvent,
	SessionExtensionUi,
	Workspace
} from '@stormlightlabs/pau-protocol';
import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { DESKTOP_CONNECTION_GLOBAL } from './api';
import { productNavigation } from './app-navigation';
import { desktopNativeCapabilitiesContext } from './native-capabilities';
import { FakeEventSocket } from './fake-event-socket';
import { SessionAttention, sessionAttentionContext } from './session-attention';
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
		shell_commands: true,
		stop: true
	}
};

type Route = (init?: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
	return Response.json(body, { status, headers: { 'Content-Type': 'application/json' } });
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
	return { fetcher, sockets, props: { fetcher, socketFactory } };
}

/** The test viewport is narrow, so the session rail starts collapsed. */
async function startFromRail(): Promise<void> {
	await userEvent.click(page.getByRole('button', { name: 'Open navigation' }));
	await userEvent.click(page.getByRole('button', { name: 'New session in Pau' }));
}

const counter = { sequence: 0 };
function output(payload: unknown, at = (counter.sequence += 1)): { type: 'event'; event: ServerEvent } {
	return {
		type: 'event',
		event: {
			sequence: at,
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

test('replaces a pending prompt with the message Pi echoes', async () => {
	const accepted = Promise.withResolvers<Response>();
	const { props, sockets } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'POST /api/sessions/session-1/prompt': () => accepted.promise
	});
	await render(SessionRoute, props);
	sockets[0]?.open();
	const transcript = page.getByRole('region', { name: 'Transcript' });

	await userEvent.type(page.getByRole('textbox', { name: 'Prompt' }), 'Add a test.');
	await userEvent.click(page.getByRole('button', { name: /Send prompt/ }));
	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toHaveValue('');
	await expect.element(transcript.getByText('Sending…')).toBeVisible();

	sockets[0]?.receive(output({ type: 'message_start', message: { role: 'user', content: 'Add a test.' } }));
	accepted.resolve(new Response(null, { status: 202 }));
	await expect.element(transcript.getByText('Sending…')).not.toBeInTheDocument();
	expect(transcript.getByText('Add a test.').all()).toHaveLength(1);
});

const pngFile = () => new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });

test('sends attached images with the prompt', async () => {
	const prompt = vi.fn(() => new Response(null, { status: 202 }));
	const { props } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'POST /api/sessions/session-1/prompt': prompt
	});
	await render(SessionRoute, props);

	await page.getByLabelText('Image files').upload([pngFile()]);
	await userEvent.type(page.getByRole('textbox', { name: 'Prompt' }), 'Describe this.');
	await userEvent.click(page.getByRole('button', { name: /Send prompt/ }));

	await vi.waitFor(() =>
		expect(prompt).toHaveBeenCalledWith(
			expect.objectContaining({
				body: '{"message":"Describe this.","queue":null,"images":[{"mime_type":"image/png","data":"AQID"}]}'
			})
		)
	);
});

test.each([
	['image_input_unsupported', 'The current model cannot read images.'],
	['image_too_large', 'larger than 5 MiB'],
	['request_images_too_large', 'more than 10 MiB'],
	['unsupported_image_type', 'PNG, JPEG, GIF, and WebP'],
	['invalid_image_data', 'could not read one of the attached images']
])('explains a %s rejection and keeps the images', async (code, expected) => {
	const { props } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'POST /api/sessions/session-1/prompt': () => json({ code, message: 'backend detail' }, 422)
	});
	await render(SessionRoute, props);

	await page.getByLabelText('Image files').upload([pngFile()]);
	await userEvent.type(page.getByRole('textbox', { name: 'Prompt' }), 'Describe this.');
	await userEvent.click(page.getByRole('button', { name: /Send prompt/ }));

	await expect.element(page.getByRole('alert')).toHaveTextContent(expected);
	await expect.element(page.getByRole('img', { name: 'a.png' })).toBeVisible();
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
	await render(SessionRoute, {
		...props,
		onSessionChange: (_workspace: string, id: string) => {
			changes.push(id);
		}
	});

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
	await expect.element(page.getByRole('button', { name: 'New session in Pau' })).toBeDisabled();
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
	counter.sequence += 1;
	return {
		type: 'event',
		event: {
			sequence: counter.sequence,
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
		answer: async () => {
			await userEvent.click(page.getByRole('radio', { name: 'Work' }));
			await userEvent.click(page.getByRole('button', { name: 'Select' }));
		}
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

	await userEvent.click(page.getByRole('button', { name: 'Select' }));

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
	await userEvent.click(page.getByRole('button', { name: 'Saved sessions in Pau' }));
}

test('resumes a saved session from the picker and selects it', async () => {
	const start = vi.fn(() => json({ ...idleSession, status: 'starting' }, 201));
	const changes: string[] = [];
	const { props } = setup({
		'GET /api/workspaces/pau/pi-sessions': () => json(savedList),
		'POST /api/sessions': start
	});
	await render(SessionRoute, {
		...props,
		onSessionChange: (_workspace: string, id: string) => {
			changes.push(id);
		}
	});

	await openSavedSessions();
	await userEvent.click(page.getByRole('button', { name: 'Resume Fix the gutter' }));

	await expect.element(page.getByText('Starting the agent process…')).toBeVisible();
	expect(start).toHaveBeenCalledWith(
		expect.objectContaining({ body: '{"agent":"pi","workspace_id":"pau","model":null,"native_session_id":"native-1"}' })
	);
	expect(changes).toEqual(['session-1']);
});

test('resumes a recent saved session from the rail and lists it once', async () => {
	const start = vi.fn(() => json({ ...idleSession, status: 'starting', native_session_id: 'native-1' }, 201));
	const changes: string[] = [];
	const { props } = setup({
		'GET /api/workspaces/pau/pi-sessions': () => json(savedList),
		'POST /api/sessions': start
	});
	await render(SessionRoute, {
		...props,
		onSessionChange: (_workspace: string, id: string) => {
			changes.push(id);
		}
	});

	await userEvent.click(page.getByRole('button', { name: 'Open navigation' }));
	await userEvent.click(page.getByRole('button', { name: /Fix the gutter/ }));

	await expect.element(page.getByText('Starting the agent process…')).toBeVisible();
	expect(start).toHaveBeenCalledWith(
		expect.objectContaining({ body: '{"agent":"pi","workspace_id":"pau","model":null,"native_session_id":"native-1"}' })
	);
	expect(changes).toEqual(['session-1']);
	// The live session takes the saved row's place.
	expect(document.querySelectorAll('.session-rail__saved')).toHaveLength(0);
});

test.each([
	['resumes the saved conversation', 'native-1', '"native_session_id":"native-1"'],
	['starts fresh when Pi saved nothing', null, '"native_session_id":null']
])('Start again on a stopped session %s and selects the new session', async (_name, nativeId, body) => {
	const stopped: AgentSession = {
		...idleSession,
		id: 'session-0',
		status: 'stopped',
		ended_at: '2026-04-01T12:05:00Z',
		native_session_id: nativeId
	};
	const start = vi.fn(() => json({ ...idleSession, status: 'starting' }, 201));
	const changes: string[] = [];
	const { props } = setup({ 'GET /api/sessions': () => json([stopped]), 'POST /api/sessions': start });
	await render(SessionRoute, {
		...props,
		initialSessionId: 'session-0',
		onSessionChange: (_workspace: string, id: string) => {
			changes.push(id);
		}
	});

	await userEvent.click(page.getByRole('button', { name: 'Start again' }));

	await expect.element(page.getByText('Starting the agent process…')).toBeVisible();
	expect(start).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining(body) }));
	expect(changes).toEqual(['session-1']);
});

/** A two-turn conversation as Pi's `get_messages` reports it. */
const earlierTurns = [
	{ role: 'user', content: 'Fix the gutter', timestamp: 1 },
	{ role: 'assistant', content: [{ type: 'text', text: 'Gutter fixed.' }], timestamp: 2 }
];

test('shows the earlier turns of a resumed session', async () => {
	const { props } = setup({
		'GET /api/workspaces/pau/pi-sessions': () => json(savedList),
		'POST /api/sessions': () => json(idleSession, 201),
		'GET /api/sessions/session-1/messages': () => json({ sequence: 0, messages: earlierTurns, truncated: false })
	});
	await render(SessionRoute, props);

	await openSavedSessions();
	await userEvent.click(page.getByRole('button', { name: 'Resume Fix the gutter' }));

	await expect.element(page.getByRole('heading', { name: 'Fix the gutter' })).toBeVisible();
	await expect.element(page.getByText('Gutter fixed.')).toBeVisible();
});

test('reloads earlier turns and applies only newer output on top', async () => {
	const { props, sockets } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'GET /api/sessions/session-1/messages': () => json({ sequence: 2, messages: earlierTurns, truncated: false })
	});
	await render(SessionRoute, { ...props, initialSessionId: 'session-1' });
	await expect.element(page.getByText('Gutter fixed.')).toBeVisible();
	sockets[0]?.open();

	// The first event repeats a message the history already holds.
	sockets[0]?.receive(output({ type: 'message_end', message: earlierTurns[1] }, 2));
	sockets[0]?.receive(output({ type: 'message_end', message: { role: 'user', content: 'Add a test.' } }, 3));
	sockets[0]?.receive(output({ type: 'message_end', message: { ...earlierTurns[1], timestamp: 4 } }, 4));

	const transcript = page.getByLabelText('Transcript');
	await expect.element(transcript.getByText('Add a test.')).toBeVisible();
	await expect.poll(() => transcript.getByText('Gutter fixed.').all()).toHaveLength(2);
});

test('selects the live session that already runs a saved session instead of resuming it', async () => {
	const start = vi.fn(() => json(idleSession, 201));
	const changes: string[] = [];
	const { props } = setup({
		'GET /api/sessions': () => json([{ ...idleSession, native_session_id: 'native-1' }]),
		'GET /api/workspaces/pau/pi-sessions': () => json(savedList),
		'POST /api/sessions': start
	});
	await render(SessionRoute, {
		...props,
		onSessionChange: (_workspace: string, id: string) => {
			changes.push(id);
		}
	});

	await openSavedSessions();
	await expect.element(page.getByText('Running')).toBeVisible();
	await userEvent.click(page.getByRole('button', { name: 'Open Fix the gutter' }));

	expect(start).not.toHaveBeenCalled();
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

const sessionTree = {
	entries: [
		{ id: 'u1', parent_id: null, kind: 'message', role: 'user', preview: 'Fix the gutter', timestamp: null },
		{ id: 'a1', parent_id: 'u1', kind: 'message', role: 'assistant', preview: 'Gutter fixed.', timestamp: null },
		{ id: 'u2', parent_id: 'a1', kind: 'message', role: 'user', preview: 'Add a test.', timestamp: null },
		{ id: 'a2', parent_id: 'u2', kind: 'message', role: 'assistant', preview: 'Test added.', timestamp: null }
	],
	leaf_id: 'a2',
	truncated: false
};

/** Streams two prompt turns, then opens the session tree in the inspector. */
async function openTree(routes: Record<string, Route>): Promise<void> {
	const { props, sockets } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'GET /api/sessions/session-1/tree': () => json(sessionTree),
		...routes
	});
	await render(SessionRoute, props);
	sockets[0]?.open();
	for (const [role, text] of [
		['user', 'Fix the gutter'],
		['assistant', 'Gutter fixed.'],
		['user', 'Add a test.'],
		['assistant', 'Test added.']
	]) {
		sockets[0]?.receive(output({ type: 'message_start', message: { role, content: text } }));
		sockets[0]?.receive(output({ type: 'message_end', message: { role, content: [{ type: 'text', text }] } }));
	}
	await expect.element(page.getByText('Test added.')).toBeVisible();
	await userEvent.click(page.getByRole('button', { name: 'Show inspector' }));
	await userEvent.click(page.getByRole('tree').getByText('Add a test.'));
}

test('branches from a user message, reloads the transcript, and refills the composer', async () => {
	let branched = false;
	const branch = vi.fn(() => {
		branched = true;
		return json({ text: 'Add a test.', cancelled: false });
	});
	await openTree({
		'POST /api/sessions/session-1/branch': branch,
		// Before the branch, the transcript comes from streamed output.
		'GET /api/sessions/session-1/messages': () =>
			branched ? json({ sequence: 99, messages: earlierTurns, truncated: false }) : json({ code: 'not_found' }, 404)
	});

	await userEvent.click(page.getByRole('button', { name: 'Branch from here' }));

	expect(branch).toHaveBeenCalledWith(expect.objectContaining({ body: '{"entry_id":"u2"}' }));
	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Add a test.');
	const transcript = page.getByLabelText('Transcript');
	await expect.element(transcript.getByText('Gutter fixed.')).toBeVisible();
	await expect.element(transcript.getByText('Test added.')).not.toBeInTheDocument();
});

test.each([
	['invalid_session_state', 409, 'Pi is busy. Wait for the current run to finish'],
	['control_rejected', 422, 'Pi could not branch from that message: entry not found']
])('explains a %s branch failure', async (code, status, expected) => {
	await openTree({ 'POST /api/sessions/session-1/branch': () => json({ code, message: 'entry not found' }, status) });

	await userEvent.click(page.getByRole('button', { name: 'Branch from here' }));

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

test('hides only the model picker when the session can change thinking but not models', async () => {
	const capabilities = { ...idleSession.capabilities, model_selection: false, thinking_level: true };
	const { props } = setup({
		'GET /api/sessions': () => json([{ ...idleSession, thinking_level: 'low', capabilities }])
	});
	await render(SessionRoute, { ...props, initialSessionId: 'session-1' });

	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toBeEnabled();
	await expect.element(page.getByRole('combobox', { name: 'Thinking level' })).toHaveTextContent('Low');
	await expect.element(page.getByRole('button', { name: /^Model/ })).not.toBeInTheDocument();
});

test('loads session commands for completion and sends the chosen command as a prompt', async () => {
	const prompt = vi.fn(() => new Response(null, { status: 202 }));
	const { props } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'GET /api/sessions/session-1/commands': () =>
			json([{ name: 'review', description: 'Review changes', source: 'prompt', path: null }]),
		'POST /api/sessions/session-1/prompt': prompt
	});
	await render(SessionRoute, { ...props, initialSessionId: 'session-1' });

	await userEvent.type(page.getByRole('textbox', { name: 'Prompt' }), '/rev');
	await expect.element(page.getByRole('option', { name: /\/review/ })).toBeVisible();
	await userEvent.keyboard('{Enter}{Control>}{Enter}{/Control}');

	expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining('/review') }));
});

test('completes an @ mention from the name search, however deep the file sits', async () => {
	const { props } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'GET /api/workspaces/pau/search?query=needle&match=names': () =>
			json({ entries: [{ path: 'pkg250/src/deep/nested/needle.rs', kind: 'file', size: 12 }], truncated: false })
	});
	await render(SessionRoute, { ...props, initialSessionId: 'session-1' });
	const prompt = page.getByRole('textbox', { name: 'Prompt' });

	await userEvent.type(prompt, '@needle');
	await expect.element(page.getByRole('option', { name: /needle\.rs/ })).toBeVisible();
	await userEvent.keyboard('{Enter}');

	await expect.element(prompt).toHaveValue('@pkg250/src/deep/nested/needle.rs ');
});

test('aborts a name search the next keystroke made stale and ignores its late answer', async () => {
	let stale: AbortSignal | undefined;
	let answerStale: ((response: Response) => void) | undefined;
	const { props } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'GET /api/workspaces/pau/search?query=ne&match=names': (init) => {
			stale = init?.signal ?? undefined;
			return new Promise((resolve) => (answerStale = resolve));
		},
		'GET /api/workspaces/pau/search?query=needle&match=names': () =>
			json({ entries: [{ path: 'needle.rs', kind: 'file', size: 1 }], truncated: false })
	});
	await render(SessionRoute, { ...props, initialSessionId: 'session-1' });
	const prompt = page.getByRole('textbox', { name: 'Prompt' });

	await userEvent.type(prompt, '@ne');
	await expect.poll(() => stale).toBeDefined();
	await userEvent.type(prompt, 'edle');
	expect(stale?.aborted).toBe(true);
	await expect.element(page.getByRole('option', { name: /needle\.rs/ })).toBeVisible();

	answerStale?.(json({ entries: [{ path: 'network.rs', kind: 'file', size: 1 }], truncated: false }));
	await expect.element(page.getByRole('option', { name: /network\.rs/ })).not.toBeInTheDocument();
});

test('shows the queued messages, follows queue updates, and restores them when cleared', async () => {
	const clear = vi.fn(() => json({ steering: ['Keep the API.'], follow_up: ['Add a test.'] }));
	const { props, sockets } = setup({
		'GET /api/sessions': () => json([{ ...idleSession, status: 'running' }]),
		'GET /api/sessions/session-1/queue': () => json({ steering: ['Keep the API.'], follow_up: [] }),
		'DELETE /api/sessions/session-1/queue': clear
	});
	await render(SessionRoute, props);
	sockets[0]?.open();
	await expect.element(page.getByText('Keep the API.')).toBeVisible();

	sockets[0]?.receive(output({ type: 'queue_update', steering: ['Keep the API.'], followUp: ['Add a test.'] }));
	await expect.element(page.getByText('Add a test.')).toBeVisible();

	await userEvent.click(page.getByRole('button', { name: 'Clear queue' }));

	expect(clear).toHaveBeenCalled();
	await expect.element(page.getByRole('region', { name: 'Queued messages' })).not.toBeInTheDocument();
	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Keep the API.\n\nAdd a test.');
});

test('hides the queue when the session cannot expose it', async () => {
	const read = vi.fn(() => json({ steering: ['Hidden.'], follow_up: [] }));
	const { props, sockets } = setup({
		'GET /api/sessions': () =>
			json([
				{ ...idleSession, status: 'running', capabilities: { ...idleSession.capabilities, message_queue: false } }
			]),
		'GET /api/sessions/session-1/queue': read
	});
	await render(SessionRoute, props);
	sockets[0]?.open();
	sockets[0]?.receive(output({ type: 'queue_update', steering: ['Hidden.'], followUp: [] }));

	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
	await expect.element(page.getByRole('region', { name: 'Queued messages' })).not.toBeInTheDocument();
	expect(read).not.toHaveBeenCalled();
});

const apiUsage = {
	context: { tokens: 84_000, context_window: 200_000, percent: 42 },
	tokens: { input: 84_210, output: 12_480, cache_read: 410_000, cache_write: 31_250, total: 537_940 },
	cost: 1.2345
};

test('shows context use read on open and follows session usage events', async () => {
	const { props, sockets } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'GET /api/sessions/session-1/usage': () => json(apiUsage)
	});
	await render(SessionRoute, props);
	sockets[0]?.open();
	// A narrow footer shows only the share used, so read the full figures from the text.
	const meter = page.getByRole('button', { name: /^Context/ });
	await expect.element(meter).toHaveTextContent(/84k \/ 200k.*42%/);

	sockets[0]?.receive(
		output({
			type: 'session_usage',
			usage: { ...apiUsage, context: { tokens: null, context_window: 200_000, percent: null } }
		})
	);
	await expect.element(meter).toHaveTextContent('unknown / 200k');
	await expect.element(page.getByText('session_usage')).not.toBeInTheDocument();
});

test('hides the context meter when the session does not report usage', async () => {
	const read = vi.fn(() => json(apiUsage));
	const { props, sockets } = setup({
		'GET /api/sessions': () => json([{ ...idleSession, capabilities: { ...idleSession.capabilities, usage: false } }]),
		'GET /api/sessions/session-1/usage': read
	});
	await render(SessionRoute, props);
	sockets[0]?.open();
	sockets[0]?.receive(output({ type: 'session_usage', usage: apiUsage }));

	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
	await expect.element(page.getByRole('button', { name: /Context/ })).not.toBeInTheDocument();
	expect(read).not.toHaveBeenCalled();
});

test('shows the thinking level Pi reports, and the selected level only while the request runs', async () => {
	let finish: (() => void) | undefined;
	const put = vi.fn(
		() =>
			new Promise<Response>((resolve) => {
				finish = () => resolve(new Response(null, { status: 204 }));
			})
	);
	const { props, sockets } = setup({
		'GET /api/sessions': () => json([{ ...idleSession, thinking_level: 'low' }]),
		'GET /api/sessions/session-1/models': () => json(modelList('sonnet')),
		'PUT /api/sessions/session-1/thinking-level': put
	});
	await render(SessionRoute, { ...props, initialSessionId: 'session-1' });

	const control = page.getByRole('combobox', { name: 'Thinking level' });
	await expect.element(control).toBeEnabled();
	await userEvent.click(control);
	await userEvent.click(page.getByRole('option', { name: 'High', exact: true }));

	expect(put).toHaveBeenCalledWith(expect.objectContaining({ body: '{"level":"high"}' }));
	await expect.element(control).toHaveTextContent('High');

	// Pi clamps the level, and the reported level wins once the request ends.
	finish?.();
	await expect.element(control).toHaveTextContent('Low');
	sockets[0]?.open();
	sockets[0]?.receive(sessionChanged({ ...idleSession, thinking_level: 'medium' }));
	await expect.element(control).toHaveTextContent('Medium');
});

test('explains a rejected thinking level', async () => {
	const { props } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'GET /api/sessions/session-1/models': () => json(modelList('sonnet')),
		'PUT /api/sessions/session-1/thinking-level': () =>
			json({ code: 'control_rejected', message: 'Level not supported' }, 422)
	});
	await render(SessionRoute, { ...props, initialSessionId: 'session-1' });

	await userEvent.click(page.getByRole('combobox', { name: 'Thinking level' }));
	await userEvent.click(page.getByRole('option', { name: 'Max' }));

	await expect.element(page.getByRole('alert')).toHaveTextContent('Pi rejected the request: Level not supported');
});

test('connects to the backend the desktop shell injects', async () => {
	const token = '0123456789abcdef0123456789abcdef';
	vi.stubGlobal(DESKTOP_CONNECTION_GLOBAL, Object.freeze({ apiOrigin: 'http://127.0.0.1:43127', token }));
	try {
		const { props, sockets, fetcher } = setup({
			'GET http://127.0.0.1:43127/api/workspaces': () => json([workspace]),
			'GET http://127.0.0.1:43127/api/sessions': () => json([idleSession])
		});
		await render(SessionRoute, props);

		await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
		expect(sockets[0]?.url).toBe('ws://127.0.0.1:43127/api/events?after=0');
		expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:43127/api/sessions', expect.anything());
		for (const [, init] of fetcher.mock.calls) {
			expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${token}`);
		}
	} finally {
		vi.unstubAllGlobals();
	}
});

test('opens a folder on first run and points the rail at the new workspace', async () => {
	const open = vi.fn(() => json(workspace, 201));
	const { props } = setup({ 'GET /api/workspaces': () => json([]), 'POST /api/workspaces': open });
	await render(SessionRoute, { ...props, navigation: (workspaceId) => productNavigation('/', workspaceId) });

	await expect.element(page.getByRole('heading', { name: 'Open a folder to start working' })).toBeVisible();
	await expect
		.element(page.getByRole('button', { name: 'Terminal' }))
		.toHaveAccessibleDescription('Open a workspace first');
	await userEvent.fill(page.getByRole('textbox', { name: 'Folder path' }), '/home/me/pau');
	await userEvent.click(page.getByRole('button', { name: 'Open', exact: true }));

	expect(open).toHaveBeenCalledWith(expect.objectContaining({ body: '{"path":"/home/me/pau"}' }));
	await expect.element(page.getByRole('heading', { name: 'Pau is open' })).toBeVisible();
	await expect
		.element(page.getByRole('link', { name: 'Terminal' }))
		.toHaveAttribute('href', '/workspaces/pau/terminal');
	await expect.element(page.getByRole('link', { name: 'Sessions' })).toHaveAttribute('aria-current', 'page');
});

test('explains why a folder could not open', async () => {
	const { props } = setup({
		'GET /api/workspaces': () => json([]),
		'POST /api/workspaces': () => json({ code: 'wrong_file_type', message: 'wrong file type' }, 422)
	});
	await render(SessionRoute, props);

	await userEvent.fill(page.getByRole('textbox', { name: 'Folder path' }), '/home/me/notes.txt');
	await userEvent.click(page.getByRole('button', { name: 'Open', exact: true }));

	await expect.element(page.getByRole('alert')).toHaveTextContent('That path is a file. Choose a folder instead.');
});

test('opens a folder from the native picker when the desktop host supplies one', async () => {
	const pickFolder = vi.fn(async () => '/home/me/pau');
	const { props } = setup({
		'GET /api/workspaces': () => json([]),
		'POST /api/workspaces': () => json(workspace, 201)
	});
	await render(SessionRoute, { props, context: new Map([[desktopNativeCapabilitiesContext, { pickFolder }]]) });

	await expect.element(page.getByRole('textbox', { name: 'Folder path' })).not.toBeInTheDocument();
	await userEvent.click(page.getByRole('main').getByRole('button', { name: 'Open workspace…' }));

	expect(pickFolder).toHaveBeenCalledOnce();
	await expect.element(page.getByRole('heading', { name: 'Pau is open' })).toBeVisible();
});

const at = (time: string) => Date.parse(time);

/** Opens the context menu of the session's row in the rail. */
async function openSessionMenu(title: string | RegExp): Promise<void> {
	await userEvent.click(page.getByRole('button', { name: 'Open navigation' }));
	const row = page.getByRole('button', { name: title });
	await expect.element(row).toBeVisible();
	(row.element() as HTMLElement).focus();
	await userEvent.keyboard('{Shift>}{F10}{/Shift}');
}

test('renames a session in the rail and restores the name when Pi rejects it', async () => {
	let accept = true;
	const rename = vi.fn(() =>
		accept ? new Response(null, { status: 204 }) : json({ code: 'control_rejected', message: 'name rejected' }, 422)
	);
	const { props, sockets } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'PUT /api/sessions/session-1/name': rename
	});
	await render(SessionRoute, props);
	sockets[0]?.open();

	await openSessionMenu(/New Pi session/);
	await userEvent.click(page.getByRole('menuitem', { name: 'Rename…' }));
	await userEvent.fill(page.getByRole('textbox', { name: 'Session name' }), 'Release prep');
	await userEvent.keyboard('{Enter}');

	expect(rename).toHaveBeenCalledWith(expect.objectContaining({ body: '{"name":"Release prep"}' }));
	await expect.element(page.getByRole('button', { name: /Release prep/ })).toBeVisible();

	accept = false;
	(page.getByRole('button', { name: /Release prep/ }).element() as HTMLElement).focus();
	await userEvent.keyboard('{Shift>}{F10}{/Shift}');
	await userEvent.click(page.getByRole('menuitem', { name: 'Rename…' }));
	await userEvent.fill(page.getByRole('textbox', { name: 'Session name' }), 'Bad name');
	await userEvent.keyboard('{Enter}');

	await expect.element(page.getByRole('alert')).toBeVisible();
	await expect.element(page.getByRole('button', { name: /Release prep/ })).toBeVisible();
});

test('shows the name Pi stored for a session after a reload', async () => {
	const { props } = setup({ 'GET /api/sessions': () => json([{ ...idleSession, name: 'Release prep' }]) });
	await render(SessionRoute, props);
	await userEvent.click(page.getByRole('button', { name: 'Open navigation' }));

	await expect.element(page.getByRole('button', { name: /Release prep/ })).toBeVisible();
});

test('clones a session from the rail', async () => {
	const clone = vi.fn(() => json({ native_session_id: 'cloned' }));
	const { props, sockets } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'POST /api/sessions/session-1/clone': clone
	});
	await render(SessionRoute, props);
	sockets[0]?.open();

	await openSessionMenu(/New Pi session/);
	await userEvent.click(page.getByRole('menuitem', { name: 'Clone' }));

	await expect.poll(() => clone.mock.calls.length).toBe(1);
});

test('branches from a user message in the transcript', async () => {
	const branch = vi.fn(() => json({ text: 'Add a test.', cancelled: false }));
	const { props, sockets } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'GET /api/sessions/session-1/messages': () =>
			json({
				sequence: 0,
				truncated: false,
				messages: [
					{ role: 'user', content: 'Fix the gutter', timestamp: at('2026-04-01T12:00:01Z') },
					{
						role: 'assistant',
						content: [{ type: 'text', text: 'Gutter fixed.' }],
						timestamp: at('2026-04-01T12:00:02Z')
					},
					{ role: 'user', content: 'Add a test.', timestamp: at('2026-04-01T12:00:03Z') }
				]
			}),
		'GET /api/sessions/session-1/tree': () =>
			json({
				entries: sessionTree.entries
					.slice(0, 3)
					.map((entry, index) => ({ ...entry, timestamp: `2026-04-01T12:00:0${index + 1}.200Z` })),
				leaf_id: 'u2',
				truncated: false
			}),
		'POST /api/sessions/session-1/branch': branch
	});
	await render(SessionRoute, props);
	sockets[0]?.open();
	const message = page.getByRole('article', { name: 'user message' }).filter({ hasText: 'Add a test.' });
	await expect.element(message).toBeVisible();

	(message.element() as HTMLElement).focus();
	await userEvent.keyboard('{Shift>}{F10}{/Shift}');
	await userEvent.click(page.getByRole('menuitem', { name: 'Branch from here' }));

	await expect.poll(() => branch.mock.calls.length).toBe(1);
	expect(branch).toHaveBeenCalledWith(expect.objectContaining({ body: '{"entry_id":"u2"}' }));
	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Add a test.');
});

function changed(status: AgentSession['status']): ServerEvent {
	return sessionChanged({ ...idleSession, status }).event;
}

test('reports the session on screen so its notifications use the rail title and its badge clears', async () => {
	const notifier = {
		notify: vi.fn().mockResolvedValue(undefined),
		setBadgeCount: vi.fn().mockResolvedValue(undefined)
	};
	const attentionSockets: FakeEventSocket[] = [];
	const attention = new SessionAttention({
		browserOrigin: 'http://localhost:5173',
		notifier,
		socketFactory: (url) => {
			const socket = new FakeEventSocket(url);
			attentionSockets.push(socket);
			return socket;
		}
	});
	attention.connect();
	attentionSockets[0]?.receive({ type: 'snapshot', snapshot: { sequence: 0, events: [changed('idle')] } });
	const { props, sockets } = setup({ 'GET /api/sessions': () => json([idleSession]) });
	const view = await render(SessionRoute, { props, context: new Map([[sessionAttentionContext, attention]]) });
	sockets[0]?.open();
	sockets[0]?.receive(output({ type: 'message_start', message: { role: 'user', content: 'Fix the gutter' } }));
	await expect.element(page.getByRole('heading', { name: 'Fix the gutter' })).toBeVisible();

	attention.focus(false);
	attentionSockets[0]?.receive({ type: 'event', event: changed('waiting') });
	expect(notifier.notify).toHaveBeenCalledWith({ title: 'Fix the gutter', body: 'Pi is waiting for your input.' });
	expect(notifier.setBadgeCount).toHaveBeenLastCalledWith(1);

	attention.focus(true);
	expect(notifier.setBadgeCount).toHaveBeenLastCalledWith(undefined);

	await view.unmount();
	attentionSockets[0]?.receive({ type: 'event', event: changed('failed') });
	expect(notifier.notify).toHaveBeenLastCalledWith({ title: 'Pi session', body: 'Pi exited unexpectedly.' });
	attention.close();
});

/** Preferences that saved `lastRoute` as the view to restore. */
function savedPreferences(lastRoute: LastRoute): Route {
	return () =>
		json({
			version: 1,
			theme: 'eldritch',
			ui_font: 'overpass',
			notifications: 'attention',
			motion: 'system',
			pane_widths: { context_rail: null, inspector: null },
			last_route: lastRoute
		});
}

test('reopens the live session that was open last', async () => {
	const other: AgentSession = { ...idleSession, id: 'session-2', started_at: '2026-04-01T12:01:00Z', name: 'Docs' };
	const changes: string[] = [];
	const { props } = setup({
		'GET /api/sessions': () => json([idleSession, other]),
		'GET /api/preferences': savedPreferences({
			workspace_id: 'pau',
			view: 'session',
			session_id: 'session-2',
			saved_session_id: null
		})
	});
	await render(SessionRoute, {
		...props,
		restoreLastRoute: true,
		onSessionChange: (_workspace: string, id: string) => {
			changes.push(id);
		}
	});

	await expect.element(page.getByRole('heading', { level: 1, name: 'Docs' })).toBeVisible();
	expect(changes).toEqual(['session-2']);
});

test('shows a stopped session with Resume and starts it only when asked', async () => {
	const start = vi.fn(() => json({ ...idleSession, status: 'starting' }, 201));
	const routes: LastRoute[] = [];
	const { props } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'GET /api/workspaces/pau/pi-sessions': () => json(savedList),
		'GET /api/preferences': savedPreferences({
			workspace_id: 'pau',
			view: 'session',
			session_id: 'gone',
			saved_session_id: 'native-1'
		}),
		'POST /api/sessions': start
	});
	await render(SessionRoute, { ...props, restoreLastRoute: true, onRouteChange: (route) => void routes.push(route) });

	await expect.element(page.getByRole('heading', { level: 1, name: 'Fix the gutter' })).toBeVisible();
	await expect.element(page.getByText('Resume it to load the conversation and continue.')).toBeVisible();
	expect(start).not.toHaveBeenCalled();
	expect(routes).toEqual([{ workspace_id: 'pau', view: 'session', session_id: null, saved_session_id: 'native-1' }]);

	// Resume is reachable with Tab from the start of the page.
	const resume = page.getByRole('button', { name: 'Resume', exact: true });
	for (let step = 0; step < 20 && document.activeElement !== resume.element(); step += 1) await userEvent.tab();
	await expect.element(resume).toHaveFocus();
	await userEvent.keyboard('{Enter}');

	await expect.element(page.getByText('Starting the agent process…')).toBeVisible();
	expect(start).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining('"native-1"') }));
	expect(routes.at(-1)).toMatchObject({ view: 'session', session_id: 'session-1' });
});

/** The top bar's breadcrumb text, which names the open workspace. */
function identity(): string | null | undefined {
	return document.querySelector('.app-shell__identity')?.textContent;
}

test('keeps the restored session in the rail and names its workspace in the top bar', async () => {
	const { props } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'GET /api/workspaces/pau/pi-sessions': () => json(savedList),
		'GET /api/preferences': savedPreferences({
			workspace_id: 'pau',
			view: 'session',
			session_id: null,
			saved_session_id: 'native-1'
		})
	});
	await render(SessionRoute, { ...props, restoreLastRoute: true });

	await expect.element(page.getByText('Resume it to load the conversation and continue.')).toBeVisible();
	expect(identity()).toContain('Pau');
	await userEvent.click(page.getByRole('button', { name: 'Open navigation' }));
	const restored = page.getByRole('button', { name: /Fix the gutter/ });
	await expect.element(restored).toHaveAttribute('aria-current', 'page');

	await userEvent.click(document.getElementById('session-row-session-1')!);
	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
	await expect.element(restored).not.toHaveAttribute('aria-current');
	await userEvent.click(restored);
	await expect.element(page.getByText('Resume it to load the conversation and continue.')).toBeVisible();
});

test.each([
	['a removed workspace', { workspace_id: 'removed', view: 'session', session_id: 's', saved_session_id: 'n' }],
	[
		'a saved session Pi no longer has',
		{ workspace_id: 'pau', view: 'session', session_id: 's', saved_session_id: 'n' }
	],
	['a removed workspace view', { workspace_id: 'removed', view: 'files', session_id: null, saved_session_id: null }]
] satisfies [string, LastRoute][])('falls back to the default view for %s', async (_name, lastRoute) => {
	const onOpenView = vi.fn();
	const { props } = setup({
		'GET /api/sessions': () => json([idleSession]),
		'GET /api/workspaces/pau/pi-sessions': () => json(savedList),
		'GET /api/preferences': savedPreferences(lastRoute)
	});
	await render(SessionRoute, { ...props, restoreLastRoute: true, onOpenView });

	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
	expect(page.getByRole('alert').elements()).toEqual([]);
	expect(onOpenView).not.toHaveBeenCalled();
});

test('opens the workspace view that was open last', async () => {
	const onOpenView = vi.fn();
	const { props } = setup({
		'GET /api/preferences': savedPreferences({
			workspace_id: 'pau',
			view: 'terminal',
			session_id: null,
			saved_session_id: null
		})
	});
	await render(SessionRoute, { ...props, restoreLastRoute: true, onOpenView });

	await vi.waitFor(() => expect(onOpenView).toHaveBeenCalledWith('terminal', 'pau'));
	await expect.element(page.getByRole('heading', { name: 'Loading sessions…' })).toBeVisible();
});

/** Opens the workspace menu from its heading in the collapsed rail. */
async function openWorkspaceMenu(): Promise<void> {
	await userEvent.click(page.getByRole('button', { name: 'Open navigation' }));
	await userEvent.click(page.getByRole('heading', { name: 'Pau' }));
	await userEvent.keyboard('{Shift>}{F10}{/Shift}');
}

const claudeMissing = {
	agent: 'claude',
	found: false,
	executable_path: null,
	version: null,
	version_supported: false,
	model_count: null,
	ready: false,
	reason: 'Claude Code was not found. Install Claude Code, add `claude` to PATH, or configure its executable path.'
};

test('disables Claude Code with the reason the readiness report gives', async () => {
	const { props } = setup({ 'GET /api/agents/readiness': () => json({ agents: [claudeMissing] }) });
	await render(SessionRoute, props);

	await openWorkspaceMenu();
	const item = page.getByRole('menuitem', { name: 'New Claude Code session' });
	await expect.element(item).toBeDisabled();
	await expect.element(item).toHaveAccessibleDescription(claudeMissing.reason.replaceAll('`', ''));
});

test('checks Claude Code again from its notice, bypassing the cached report', async () => {
	const refresh = vi.fn(() => json({ agents: [{ ...claudeMissing, found: true, ready: true, reason: null }] }));
	const { props } = setup({
		'GET /api/workspaces': () => json([]),
		'POST /api/workspaces': () => json(workspace, 201),
		'GET /api/agents/readiness': () => json({ agents: [claudeMissing] }),
		'GET /api/agents/readiness?refresh=true': refresh
	});
	await render(SessionRoute, props);
	await userEvent.fill(page.getByRole('textbox', { name: 'Folder path' }), '/home/me/pau');
	await userEvent.click(page.getByRole('button', { name: 'Open', exact: true }));

	const startClaude = page.getByRole('button', { name: 'Start Claude Code session' });
	await expect.element(startClaude).toBeDisabled();
	await userEvent.click(page.getByRole('button', { name: 'Check again' }));

	expect(refresh).toHaveBeenCalledOnce();
	await expect.element(startClaude).toBeEnabled();
	await expect.element(page.getByRole('region', { name: 'Claude Code is not ready' })).not.toBeInTheDocument();
});

test('starts a Claude Code session and streams its reply', async () => {
	const claudeSession: AgentSession = {
		...idleSession,
		id: 'session-1',
		agent: 'claude',
		capabilities: {
			...idleSession.capabilities,
			follow_up: false,
			steer: false,
			message_queue: false,
			model_selection: false,
			thinking_level: false,
			command_discovery: false,
			usage: false,
			compaction: false,
			branching: false,
			retry: false,
			rename: false,
			clone_session: false,
			shell_commands: false
		}
	};
	const start = vi.fn(() => json(claudeSession, 201));
	const { props, sockets } = setup({
		'GET /api/agents/readiness': () => json({ agents: [{ ...claudeMissing, found: true, ready: true, reason: null }] }),
		'POST /api/sessions': start
	});
	await render(SessionRoute, props);
	sockets[0]?.open();

	await openWorkspaceMenu();
	await userEvent.click(page.getByRole('menuitem', { name: 'New Claude Code session' }));
	expect(JSON.parse(String((start.mock.calls[0] as unknown as [RequestInit])[0].body))).toMatchObject({
		agent: 'claude'
	});

	await expect.element(page.getByRole('heading', { name: 'New Claude Code session' })).toBeVisible();
	await expect.element(page.getByRole('button', { name: /^Model/ })).not.toBeInTheDocument();
	await expect.element(page.getByRole('combobox', { name: 'Thinking level' })).not.toBeInTheDocument();

	sockets[0]?.receive(output({ sequence: 0, event: 'text.delta', payload: { text: 'Reading the bridge.' } }));
	await expect.element(page.getByText('Reading the bridge.')).toBeVisible();
	await expect.element(page.getByRole('button', { name: 'Compact' })).not.toBeInTheDocument();
});
