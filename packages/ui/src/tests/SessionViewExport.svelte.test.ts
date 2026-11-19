import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { sessionFixtures } from '../fixtures/sessions';
import SessionView from '../lib/SessionView.svelte';
import type { SessionWorkspace } from '../lib/types/session';

const open = (
	workspaces: SessionWorkspace[],
	onExportTranscript?: (sessionId: string) => Promise<string | undefined>
) => ({ workspaces, activeSessionId: workspaces[0]!.sessions[0]!.id, onStop: async () => {}, onExportTranscript });

/** An export the operator cancels in the save dialog. */
const cancelled = async (): Promise<undefined> => {};

const exportButton = () => page.getByRole('button', { name: 'Export', exact: true });

test('exports the transcript and says where the file went', async () => {
	const saved = Promise.withResolvers<string | undefined>();
	const onExportTranscript = vi.fn(() => saved.promise);
	await render(SessionView, open(sessionFixtures.idle, onExportTranscript));

	await userEvent.click(exportButton());
	expect(onExportTranscript).toHaveBeenCalledWith('session-idle');
	// A second press cannot start another export while the first runs.
	await expect.element(exportButton()).toBeDisabled();
	await expect.element(exportButton()).toHaveAttribute('aria-busy', 'true');

	saved.resolve('/Users/operator/Fix diff gutter.html');
	await expect
		.element(page.getByRole('status').filter({ hasText: 'Transcript saved' }))
		.toHaveTextContent('Transcript saved to /Users/operator/Fix diff gutter.html');
	await expect.element(exportButton()).toBeEnabled();
});

test("keeps each session's export busy until that export finishes", async () => {
	const pending = new Map<string, PromiseWithResolvers<string | undefined>>();
	const onExportTranscript = vi.fn((sessionId: string) => {
		const saved = Promise.withResolvers<string | undefined>();
		pending.set(sessionId, saved);
		return saved.promise;
	});
	const workspaces: SessionWorkspace[] = [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [sessionFixtures.idle[0]!.sessions[0]!, sessionFixtures.running[0]!.sessions[0]!]
		}
	];
	const view = await render(SessionView, open(workspaces, onExportTranscript));

	await userEvent.click(exportButton());
	await view.rerender({ activeSessionId: 'session-running' });
	await userEvent.click(exportButton());
	await expect.element(exportButton()).toBeDisabled();

	// The first session's export finishes while the second one still runs.
	pending.get('session-idle')!.resolve(undefined);
	await view.rerender({ activeSessionId: 'session-idle' });
	await expect.element(exportButton()).toBeEnabled();
	await view.rerender({ activeSessionId: 'session-running' });
	await expect.element(exportButton()).toBeDisabled();

	pending.get('session-running')!.resolve(undefined);
	await expect.element(exportButton()).toBeEnabled();
});

test('shows nothing when the operator cancels the save dialog', async () => {
	const onExportTranscript = vi.fn(cancelled);
	await render(SessionView, open(sessionFixtures.idle, onExportTranscript));

	await userEvent.click(exportButton());

	await expect.element(exportButton()).toBeEnabled();
	await expect.element(page.getByText('Transcript saved')).not.toBeInTheDocument();
	await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
});

test('reports a failed export in the notices', async () => {
	const onExportTranscript = vi
		.fn<(sessionId: string) => Promise<string | undefined>>()
		.mockResolvedValueOnce('/Users/operator/first.html')
		.mockRejectedValueOnce(new Error('Pi could not export this session: Nothing to export'));
	await render(SessionView, open(sessionFixtures.idle, onExportTranscript));

	await userEvent.click(exportButton());
	await expect.element(page.getByText('Transcript saved to /Users/operator/first.html')).toBeVisible();
	await userEvent.click(exportButton());

	await expect
		.element(page.getByRole('alert'))
		.toHaveTextContent('Pi could not export this session: Nothing to export');
	// The earlier success no longer describes the latest export.
	await expect.element(page.getByText('Transcript saved')).not.toBeInTheDocument();
	await expect.element(exportButton()).toBeEnabled();
});

test('offers Export only where the session and the app can export', async () => {
	const offline = await render(SessionView, { ...open(sessionFixtures.idle, cancelled), disconnected: true });
	await expect.element(exportButton()).toBeDisabled();
	await expect
		.element(exportButton())
		.toHaveAttribute('title', 'Pau is reconnecting to the backend. You can export once it reconnects.');
	offline.unmount();

	// Without a save dialog, as in a browser, there is nowhere to save to.
	const browser = await render(SessionView, open(sessionFixtures.idle));
	await expect.element(page.getByRole('button', { name: 'Stop' })).toBeVisible();
	await expect.element(exportButton()).not.toBeInTheDocument();
	browser.unmount();

	await render(SessionView, open(sessionFixtures.claude, cancelled));
	await expect.element(page.getByRole('button', { name: 'Stop' })).toBeVisible();
	await expect.element(exportButton()).not.toBeInTheDocument();
});
