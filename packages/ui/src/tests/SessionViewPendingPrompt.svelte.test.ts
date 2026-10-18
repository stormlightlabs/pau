import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { sessionFixtures } from '../fixtures/sessions';
import SessionView from '../lib/SessionView.svelte';
import type { SessionViewModel, SessionWorkspace } from '../lib/types/session';

function withSession(workspaces: SessionWorkspace[], overrides: Partial<SessionViewModel>): SessionWorkspace[] {
	return workspaces.map((workspace) => ({
		...workspace,
		sessions: workspace.sessions.map((session) => ({ ...session, ...overrides }))
	}));
}

async function submit(text: string): Promise<void> {
	const prompt = page.getByRole('textbox', { name: 'Prompt' });
	await userEvent.type(prompt, text);
	await userEvent.keyboard('{Control>}{Enter}{/Control}');
}

test('shows a prompt as pending until the session echoes it', async () => {
	const accepted = Promise.withResolvers<void>();
	const onSend = vi.fn(() => accepted.promise);
	const props = { activeSessionId: 'session-idle', onSend };
	const view = await render(SessionView, { workspaces: sessionFixtures.idle, ...props });

	const transcript = page.getByRole('region', { name: 'Transcript' });
	await submit('Add a gutter test.');

	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toHaveValue('');
	await expect.element(transcript.getByText('Sending…')).toBeVisible();
	await expect.element(transcript.getByText('Add a gutter test.')).toBeVisible();

	await view.rerender({ workspaces: withSession(sessionFixtures.idle, { status: 'running' }), ...props });
	accepted.resolve();
	await expect.element(transcript.getByText('Sending…')).toBeVisible();

	await view.rerender({
		workspaces: withSession(sessionFixtures.idle, {
			status: 'running',
			transcript: [{ id: 'echo', kind: 'message', role: 'user', body: 'Add a gutter test.' }]
		}),
		...props
	});
	await expect.element(transcript.getByText('Sending…')).not.toBeInTheDocument();
	expect(transcript.getByText('Add a gutter test.').all()).toHaveLength(1);
});

test('marks a refused prompt as not sent and restores the draft', async () => {
	const onSend = vi.fn().mockRejectedValue(new Error('The session stopped before the prompt arrived.'));
	await render(SessionView, { workspaces: sessionFixtures.idle, activeSessionId: 'session-idle', onSend });

	await submit('Add a gutter test.');

	await expect.element(page.getByRole('alert')).toHaveTextContent('The session stopped before the prompt arrived.');
	await expect.element(page.getByText('Not sent')).toBeVisible();
	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Add a gutter test.');

	onSend.mockResolvedValue(undefined);
	await userEvent.keyboard('{Control>}{Enter}{/Control}');
	await expect.element(page.getByText('Not sent')).not.toBeInTheDocument();
	expect(onSend).toHaveBeenCalledTimes(2);
	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toHaveValue('');
});

test('shows a prompt queued during a run in the queue until Pi lists it', async () => {
	const onSend = vi.fn();
	const props = { activeSessionId: 'session-running', onSend, onClearQueue: vi.fn() };
	const view = await render(SessionView, { workspaces: sessionFixtures.running, ...props });

	await submit('Keep the API stable.');

	expect(onSend).toHaveBeenCalledWith('session-running', 'Keep the API stable.', 'steer');
	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toHaveValue('');
	const queue = page.getByRole('region', { name: 'Queued messages' });
	await expect.element(queue.getByText('Sending…')).toBeVisible();
	await expect.element(queue.getByText('Keep the API stable.')).toBeVisible();
	await expect
		.element(page.getByRole('region', { name: 'Transcript' }).getByText('Keep the API stable.'))
		.not.toBeInTheDocument();

	await view.rerender({
		workspaces: withSession(sessionFixtures.running, {
			messageQueue: { steering: ['Keep the API stable.'], followUp: [] }
		}),
		...props
	});
	await expect.element(queue.getByText('Sending…')).not.toBeInTheDocument();
	expect(queue.getByText('Keep the API stable.').all()).toHaveLength(1);
});
