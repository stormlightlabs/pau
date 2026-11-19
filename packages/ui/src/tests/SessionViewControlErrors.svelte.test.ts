import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { sessionFixtures } from '../fixtures/sessions';
import SessionView from '../lib/SessionView.svelte';
import type { SessionStatus, SessionWorkspace } from '../lib/types/session';

const idle = sessionFixtures.idle[0]!.sessions[0]!;
const running = sessionFixtures.running[0]!.sessions[0]!;

/** One workspace with the idle and running sessions, the idle one in `status`. */
const workspaces = (status: SessionStatus = idle.status): SessionWorkspace[] => [
	{ id: 'pau', name: 'Pau', sessions: [{ ...idle, status }, running] }
];

const exportButton = () => page.getByRole('button', { name: 'Export', exact: true });

test('shows a failed action only in the session it ran in', async () => {
	const failed = Promise.withResolvers<string | undefined>();
	const onExportTranscript = vi.fn(() => failed.promise);
	const view = await render(SessionView, {
		workspaces: workspaces(),
		activeSessionId: idle.id,
		onStop: async () => {},
		onExportTranscript
	});

	await userEvent.click(exportButton());
	await view.rerender({ activeSessionId: running.id });
	failed.reject(new Error('Pi could not export this session: Nothing to export'));
	// Let the view handle the failure before checking that nothing shows.
	await new Promise((resolve) => setTimeout(resolve, 0));
	await expect.element(page.getByRole('alert')).not.toBeInTheDocument();

	// The failure waits in its own session until the operator returns.
	await view.rerender({ activeSessionId: idle.id });
	await expect
		.element(page.getByRole('alert'))
		.toHaveTextContent('Pi could not export this session: Nothing to export');

	// The next export in that session clears it, and success leaves it clear.
	onExportTranscript.mockResolvedValueOnce('/Users/operator/fixed.html');
	await userEvent.click(exportButton());
	await expect.element(page.getByText('Transcript saved to /Users/operator/fixed.html')).toBeVisible();
	await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
});

test("drops a session's failed action when the session ends", async () => {
	const view = await render(SessionView, {
		workspaces: workspaces(),
		activeSessionId: idle.id,
		onStop: async () => {
			throw new Error('The agent did not stop.');
		}
	});

	await userEvent.click(page.getByRole('button', { name: 'Stop' }));
	await expect.element(page.getByRole('alert')).toHaveTextContent('The agent did not stop.');

	await view.rerender({ workspaces: workspaces('stopped') });
	await expect.element(page.getByRole('status').filter({ hasText: 'Session stopped.' })).toBeVisible();
	await expect.element(page.getByText('The agent did not stop.')).not.toBeInTheDocument();
});

test('shows a failed interrupt when the operator returns to its session', async () => {
	const failed = Promise.withResolvers<undefined>();
	const view = await render(SessionView, {
		workspaces: workspaces(),
		activeSessionId: running.id,
		onStop: async () => {},
		onInterrupt: () => failed.promise
	});

	await userEvent.click(page.getByRole('button', { name: /Interrupt/ }));
	await view.rerender({ activeSessionId: idle.id });
	failed.reject(new Error('The agent did not take the interrupt.'));
	// Let the view handle the failure before checking that nothing shows.
	await new Promise((resolve) => setTimeout(resolve, 0));
	await expect.element(page.getByRole('alert')).not.toBeInTheDocument();

	await view.rerender({ activeSessionId: running.id });
	await expect.element(page.getByRole('alert')).toHaveTextContent('The agent did not take the interrupt.');
});

test('drops a stop that fails after the session has already stopped', async () => {
	const failed = Promise.withResolvers<void>();
	const view = await render(SessionView, {
		workspaces: workspaces(),
		activeSessionId: idle.id,
		onStop: () => failed.promise
	});

	await userEvent.click(page.getByRole('button', { name: 'Stop' }));
	await view.rerender({ workspaces: workspaces('stopped') });
	await expect.element(page.getByRole('status').filter({ hasText: 'Session stopped.' })).toBeVisible();
	failed.reject(new Error('The stop request timed out.'));
	await new Promise((resolve) => setTimeout(resolve, 0));
	await expect.element(page.getByText('The stop request timed out.')).not.toBeInTheDocument();
});
