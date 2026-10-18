import { page } from 'vitest/browser';
import { beforeEach, expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { savedSessionFixtures } from '../fixtures/saved-sessions';
import { sessionFixtures } from '../fixtures/sessions';
import SessionView from '../lib/SessionView.svelte';
import type { SessionWorkspace } from '../lib/types/session';

// The rail docks beside the main surface only on a wide viewport.
beforeEach(async () => {
	await page.viewport(1440, 900);
});

const longName: SessionWorkspace[] = [
	{ id: 'ankify', name: 'ankify-spaced-repetition-sync-service', path: '/Users/me/ankify', sessions: [] }
];

function renderRail(contextRail: number | null) {
	return render(SessionView, {
		workspaces: longName,
		paneWidths: { contextRail, inspector: null },
		onStartSession: async () => {},
		onLoadSavedSessions: async () => savedSessionFixtures.empty,
		onResumeSession: async () => {},
		onOpenWorkspace: async () => 'ankify'
	});
}

const rect = (element: Element) => element.getBoundingClientRect();

test.each([
	['minimum', 160],
	['default', null]
])('keeps the workspace row inside the rail at the %s width', async (_label, width) => {
	await renderRail(width);

	const rail = rect(document.querySelector('#shell-context-rail')!);
	const start = page.getByRole('button', { name: 'New session in ankify-spaced-repetition-sync-service' });
	const saved = page.getByRole('button', { name: 'Saved sessions in ankify-spaced-repetition-sync-service' });
	await expect.element(start).toHaveAttribute('title', 'New session in ankify-spaced-repetition-sync-service');
	await expect.element(saved).toHaveAttribute('title', 'Saved sessions in ankify-spaced-repetition-sync-service');

	const heading = page.getByRole('heading', { name: 'ankify-spaced-repetition-sync-service' }).element();
	const open = page.getByRole('button', { name: 'Open workspace…' }).element();
	for (const element of [heading, start.element(), saved.element(), open]) {
		const box = rect(element);
		expect(box.left).toBeGreaterThanOrEqual(rail.left);
		expect(box.right).toBeLessThanOrEqual(rail.right);
	}

	// The name truncates instead of pushing the controls out, and they share its row.
	expect(heading.scrollWidth).toBeGreaterThan(heading.clientWidth);
	expect(getComputedStyle(heading).textTransform).toBe('none');
	const nameBox = rect(heading);
	const startBox = rect(start.element());
	expect(startBox.left).toBeGreaterThanOrEqual(nameBox.right);
	expect(Math.abs(startBox.top + startBox.height / 2 - (nameBox.top + nameBox.height / 2))).toBeLessThan(1);
});

test('insets the empty session note to the session titles', async () => {
	await render(SessionView, { workspaces: [{ id: 'empty', name: 'Empty', sessions: [] }, ...sessionFixtures.waiting] });

	const note = page.getByText('No sessions yet').element();
	const title = document.querySelector('.session-rail .session-rail__name')!;
	const noteText = rect(note).left + Number(getComputedStyle(note).paddingLeft.replace('px', ''));
	expect(Math.abs(noteText - rect(title).left)).toBeLessThan(1);
});

test('lays out the saved-session picker as a top-aligned panel', async () => {
	await renderRail(null);
	await page.getByRole('button', { name: 'Saved sessions in ankify-spaced-repetition-sync-service' }).click();

	const title = page.getByRole('heading', { name: 'Sessions in ankify-spaced-repetition-sync-service' });
	await expect.element(title).toBeVisible();
	const main = rect(document.querySelector('.app-shell__main-content')!);
	const titleBox = rect(title.element());
	const newBox = rect(page.getByRole('button', { name: 'New session', exact: true }).element());
	const panel = rect(document.querySelector('.session-picker')!);

	expect(titleBox.top - main.top).toBeLessThan(80);
	expect(Math.abs(newBox.top + newBox.height / 2 - (titleBox.top + titleBox.height / 2))).toBeLessThan(2);
	expect(panel.width).toBeLessThanOrEqual(640);
	await expect.element(page.getByText(/^Start a new session to begin\./)).toBeVisible();
});

test('top-aligns the empty main surface', async () => {
	await render(SessionView, { workspaces: longName });

	const main = rect(document.querySelector('.app-shell__main-content')!);
	const heading = rect(page.getByRole('heading', { name: 'No session selected' }).element());
	expect(heading.top - main.top).toBeLessThan(80);
});

test('shows the connection only while it is down', async () => {
	const view = await render(SessionView, { workspaces: longName });
	expect(document.querySelector('.app-shell__connection')).toBeNull();
	expect(document.body.textContent).not.toContain('Connected');

	await view.rerender({ workspaces: longName, disconnected: true });
	await expect.element(page.getByRole('status').filter({ hasText: 'Disconnected' })).toBeVisible();
});
