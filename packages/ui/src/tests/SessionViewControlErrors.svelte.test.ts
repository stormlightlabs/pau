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

test('keeps a failure when an unrelated action starts and clears it on its own retry', async () => {
	const onExportTranscript = vi.fn((): Promise<string | undefined> =>
		Promise.reject(new Error('The transcript could not be written.'))
	);
	await render(SessionView, {
		workspaces: workspaces(),
		activeSessionId: idle.id,
		onStop: async () => {},
		onExportTranscript
	});

	await userEvent.click(exportButton());
	await expect.element(page.getByRole('alert')).toHaveTextContent('The transcript could not be written.');

	await userEvent.click(page.getByRole('button', { name: 'Stop' }));
	await expect.element(page.getByRole('alert')).toHaveTextContent('The transcript could not be written.');

	onExportTranscript.mockResolvedValueOnce('/Users/operator/fixed.html');
	await userEvent.click(exportButton());
	await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
});

test("drops a session's failures when it starts a new run", async () => {
	vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));
	const pau = sessionFixtures.idleWithPath[0]!;
	const withStatus = (status: SessionStatus) => [{ ...pau, sessions: [{ ...pau.sessions[0]!, status }] }];
	const view = await render(SessionView, {
		workspaces: withStatus('stopped'),
		activeSessionId: pau.sessions[0]!.id,
		onStop: async () => {}
	});

	(page.getByRole('article', { name: 'assistant message' }).element() as HTMLElement).focus();
	await userEvent.keyboard('{Shift>}{F10}{/Shift}');
	await userEvent.click(page.getByRole('menuitem', { name: 'Copy message' }));
	await expect.element(page.getByRole('alert')).toHaveTextContent('Pau could not copy the message.');

	await view.rerender({ workspaces: withStatus('idle') });
	await expect.element(page.getByText('Pau could not copy the message.')).not.toBeInTheDocument();
});

test('drops a stop that fails after the session stopped and started again', async () => {
	const failed = Promise.withResolvers<void>();
	const view = await render(SessionView, {
		workspaces: workspaces(),
		activeSessionId: idle.id,
		onStop: () => failed.promise
	});

	await userEvent.click(page.getByRole('button', { name: 'Stop' }));
	await view.rerender({ workspaces: workspaces('stopped') });
	await expect.element(page.getByRole('status').filter({ hasText: 'Session stopped.' })).toBeVisible();
	await view.rerender({ workspaces: workspaces('idle') });
	await expect.element(page.getByRole('button', { name: 'Stop' })).toBeVisible();
	failed.reject(new Error('The stop request timed out.'));
	await new Promise((resolve) => setTimeout(resolve, 0));
	await expect.element(page.getByText('The stop request timed out.')).not.toBeInTheDocument();
});

test('drops a failed retry once a new prompt is sent', async () => {
	await render(SessionView, {
		workspaces: sessionFixtures.failedTurn,
		activeSessionId: 'session-idle',
		onRetry: () => Promise.reject(new Error('The provider is still overloaded.')),
		onSend: async () => {}
	});

	await userEvent.click(page.getByRole('button', { name: 'Send message again' }));
	await expect.element(page.getByRole('alert')).toHaveTextContent('The provider is still overloaded.');

	await userEvent.fill(page.getByRole('textbox', { name: 'Prompt' }), 'Try a smaller diff instead.');
	await userEvent.keyboard('{Enter}');
	await expect.element(page.getByText('The provider is still overloaded.')).not.toBeInTheDocument();
});

test('drops a failed retry once its failed message is no longer last', async () => {
	const workspace = sessionFixtures.failedTurn[0]!;
	const failedSession = workspace.sessions[0]!;
	const view = await render(SessionView, {
		workspaces: sessionFixtures.failedTurn,
		activeSessionId: failedSession.id,
		onRetry: () => Promise.reject(new Error('The provider is still overloaded.'))
	});

	await userEvent.click(page.getByRole('button', { name: 'Send message again' }));
	await expect.element(page.getByRole('alert')).toHaveTextContent('The provider is still overloaded.');

	const reply = { id: 'reply-2', kind: 'message' as const, role: 'assistant' as const, label: 'Pi', body: 'Done.' };
	await view.rerender({
		workspaces: [{ ...workspace, sessions: [{ ...failedSession, transcript: [...failedSession.transcript, reply] }] }]
	});
	await expect.element(page.getByText('The provider is still overloaded.')).not.toBeInTheDocument();
});

test("shows a failed workspace action in that workspace's column", async () => {
	const fixture = sessionFixtures.idleWithPath[0]!;
	const pau = { ...fixture, sessions: [fixture.sessions[0]!, running] };
	const other = { id: 'other', name: 'Other', sessions: [{ ...running, id: 'session-other' }] };
	const view = await render(SessionView, {
		workspaces: [pau, other],
		activeSessionId: fixture.sessions[0]!.id,
		revealPath: () => Promise.reject(new Error('The folder no longer exists.'))
	});
	const column = page.getByRole('complementary', { name: 'Workspace' });

	await userEvent.click(page.getByRole('button', { name: 'Pau actions' }));
	await userEvent.click(page.getByRole('menuitem', { name: /Reveal in Finder|Show in folder/ }));
	await expect.element(column.getByRole('alert')).toHaveTextContent('The folder no longer exists.');

	// It belongs to the workspace, so every session there shows it and others do not.
	await view.rerender({ activeSessionId: running.id });
	await expect.element(column.getByRole('alert')).toHaveTextContent('The folder no longer exists.');
	await view.rerender({ activeSessionId: 'session-other' });
	await expect.element(page.getByText('The folder no longer exists.')).not.toBeInTheDocument();
});
