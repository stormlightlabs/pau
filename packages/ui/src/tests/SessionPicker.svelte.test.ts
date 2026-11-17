import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { savedSessionFixtures, savedSessionsNow } from '../fixtures/saved-sessions';
import { sessionFixtures } from '../fixtures/sessions';
import SessionPicker from '../lib/SessionPicker.svelte';
import SessionView from '../lib/SessionView.svelte';
import type { SavedSessionList } from '../lib/types/session';

function renderPicker(list: SavedSessionList | Promise<SavedSessionList>, props: Record<string, unknown> = {}) {
	return render(SessionPicker, {
		workspaceName: 'Pau',
		now: savedSessionsNow,
		load: async () => list,
		onNew: vi.fn(),
		onResume: vi.fn(),
		...props
	});
}

test('shows the empty state and still offers a new session', async () => {
	await renderPicker(savedSessionFixtures.empty);

	await expect.element(page.getByText(/Saved Pi sessions in this workspace appear here/)).toBeVisible();
	await expect.element(page.getByRole('button', { name: 'New session' })).toBeEnabled();
});

test('shows a loading state until the list arrives', async () => {
	await renderPicker(new Promise(() => {}));

	await expect.element(page.getByRole('status')).toHaveTextContent('Loading saved sessions…');
});

test('lists saved sessions with relative times and resumes the chosen one', async () => {
	const onResume = vi.fn();
	await renderPicker(savedSessionFixtures.populated, { onResume });

	await expect.element(page.getByText('Modified 3 hours ago')).toBeVisible();
	await expect.element(page.getByText('Modified 2 days ago')).toBeVisible();
	await userEvent.click(page.getByRole('button', { name: 'Resume Fix the flaky terminal test' }));

	expect(onResume).toHaveBeenCalledWith('native-2');
});

test('offers to open a saved session that is already running', async () => {
	const onResume = vi.fn();
	const sessions = savedSessionFixtures.populated.sessions.map((saved) =>
		saved.id === 'native-2' ? { ...saved, live: true } : saved
	);
	await renderPicker({ ...savedSessionFixtures.populated, sessions }, { onResume });

	await expect.element(page.getByText('Running')).toBeVisible();
	await expect
		.element(page.getByRole('button', { name: 'Resume Fix the flaky terminal test' }))
		.not.toBeInTheDocument();
	await userEvent.click(page.getByRole('button', { name: 'Open Fix the flaky terminal test' }));

	expect(onResume).toHaveBeenCalledWith('native-2');
});

test('starts a new session', async () => {
	const onNew = vi.fn();
	await renderPicker(savedSessionFixtures.populated, { onNew });

	await userEvent.click(page.getByRole('button', { name: 'New session' }));

	expect(onNew).toHaveBeenCalledOnce();
});

test('keeps skipped files collapsed until opened', async () => {
	await renderPicker(savedSessionFixtures.withWarnings);

	await expect.element(page.getByText('1 file was skipped')).toBeVisible();
	await expect.element(page.getByText(/session header is not valid JSON/)).not.toBeVisible();
});

test('shows the reason a resume failed and keeps the list usable', async () => {
	const onResume = vi.fn().mockRejectedValue(new Error('Pi no longer has that session.'));
	await renderPicker(savedSessionFixtures.populated, { onResume });

	await userEvent.click(page.getByRole('button', { name: 'Resume Review the sandbox policy' }));

	await expect.element(page.getByRole('alert')).toHaveTextContent('Pi no longer has that session.');
	await expect.element(page.getByRole('button', { name: 'Resume Review the sandbox policy' })).toBeEnabled();
});

test('retries a failed load', async () => {
	const load = vi
		.fn<() => Promise<SavedSessionList>>()
		.mockRejectedValueOnce(new Error('Could not list sessions.'))
		.mockResolvedValue(savedSessionFixtures.populated);
	await render(SessionPicker, { workspaceName: 'Pau', load, onNew: vi.fn(), onResume: vi.fn() });

	await expect.element(page.getByRole('alert')).toHaveTextContent('Could not list sessions.');
	await userEvent.click(page.getByRole('button', { name: 'Try again' }));

	await expect.element(page.getByText('Fix the flaky terminal test')).toBeVisible();
});

test('opens from the rail and closes after a resume', async () => {
	const onResumeSession = vi.fn();
	await render(SessionView, {
		workspaces: sessionFixtures.workspaceWithoutSessions,
		onLoadSavedSessions: async () => savedSessionFixtures.populated,
		onResumeSession
	});

	await userEvent.click(page.getByRole('button', { name: 'More ways to start a session' }));
	await userEvent.click(page.getByRole('menuitem', { name: 'Saved sessions…' }));
	await userEvent.click(page.getByRole('button', { name: 'Resume Review the sandbox policy' }));

	expect(onResumeSession).toHaveBeenCalledWith('pau', 'native-3');
	await expect.element(page.getByRole('heading', { name: 'No session selected' })).toBeVisible();
});
