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
const inset = (element: Element) =>
	rect(element).left + Number(getComputedStyle(element).paddingLeft.replace('px', ''));

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
	expect(getComputedStyle(heading).textOverflow).toBe('ellipsis');
	expect(getComputedStyle(heading).whiteSpace).toBe('nowrap');
	expect(heading.getAttribute('title')).toContain('ankify-spaced-repetition-sync-service');
	const nameBox = rect(heading);
	const startBox = rect(start.element());
	expect(startBox.left).toBeGreaterThanOrEqual(nameBox.right);
	expect(Math.abs(startBox.top + startBox.height / 2 - (nameBox.top + nameBox.height / 2))).toBeLessThan(1);
});

test('aligns the empty session note with the workspace name', async () => {
	await render(SessionView, { workspaces: [{ id: 'empty', name: 'Empty', sessions: [] }, ...sessionFixtures.waiting] });

	const note = page.getByText('No sessions yet').element();
	const heading = page.getByRole('heading', { name: 'Empty' }).element();
	expect(Math.abs(inset(note) - inset(heading))).toBeLessThan(1);
});

test('stacks session rows without gaps and spans the selected row across the rail', async () => {
	await render(SessionView, { workspaces: sessionFixtures.concurrent, activeSessionId: 'diff-gutter' });

	const rail = rect(document.querySelector('.session-rail')!);
	const rows = [...document.querySelectorAll<HTMLElement>('.session-rail li')].slice(0, 3).map((row) => rect(row));
	for (const [index, row] of rows.entries()) {
		expect(row.height).toBe(32);
		if (index > 0) expect(row.top).toBe(rows[index - 1]!.bottom);
	}

	const selected = rect(page.getByRole('button', { name: /Fix diff gutter/ }).element());
	expect(selected.left).toBe(rail.left);
	expect(selected.right).toBe(rail.right);
	expect(getComputedStyle(page.getByRole('button', { name: /Fix diff gutter/ }).element()).boxShadow).not.toBe('none');
});

test('gives the workspace icon buttons a resting border and a 44px hit area', async () => {
	await renderRail(null);

	const start = page.getByRole('button', { name: 'New session in ankify-spaced-repetition-sync-service' }).element();
	expect(getComputedStyle(start).borderTopWidth).toBe('1px');
	const after = getComputedStyle(start, '::after');
	expect(Number(after.width.replace('px', ''))).toBeGreaterThanOrEqual(44);
	expect(Number(after.height.replace('px', ''))).toBeGreaterThanOrEqual(44);
	// The rail's buttons share one height, the Open workspace button's.
	const open = page.getByRole('button', { name: 'Open workspace…' }).element();
	expect(rect(start).height).toBe(32);
	expect(rect(start).width).toBe(32);
	expect(rect(open).height).toBe(32);
});

test('sets the rail status mark one spacing step from the name, as in the header', async () => {
	await render(SessionView, { workspaces: sessionFixtures.idle, activeSessionId: 'session-idle' });

	const row = page.getByRole('button', { name: /Fix diff gutter/ }).element();
	const mark = rect(row.querySelector('.session-status-mark')!);
	const name = rect(row.querySelector('.session-rail__name')!);
	expect(name.left - mark.right).toBe(8);

	const header = document.querySelector('.session-view__status')!;
	const headerMark = rect(header.querySelector('.session-status-mark')!);
	const headerLabel = rect(header.querySelector('span')!);
	expect(headerLabel.left - headerMark.right).toBe(8);

	// Names start where the shell's context rail starts its labels: 20px row inset, 8px dot column, 8px gap.
	const rail = rect(document.querySelector('.session-rail')!);
	expect(name.left - rail.left).toBe(36);
	// The mark lines up with the workspace name above it.
	expect(mark.left).toBe(inset(page.getByRole('heading', { name: 'Pau' }).element()));
});

test('truncates long session names on one line and keeps the full name', async () => {
	const title = 'Reconcile the saved session registry with the running agents';
	await render(SessionView, {
		workspaces: [
			{
				id: 'ankify',
				name: 'ankify',
				sessions: [{ ...sessionFixtures.concurrent[0]!.sessions[0]!, id: 'long', title }]
			}
		],
		paneWidths: { contextRail: 160, inspector: null }
	});

	const row = page.getByRole('button', { name: new RegExp(title) });
	await expect.element(row).toHaveAttribute('title', title);
	const name = document.querySelector<HTMLElement>('.session-rail__name')!;
	const status = rect(document.querySelector('.session-rail__state')!);
	expect(name.scrollWidth).toBeGreaterThan(name.clientWidth);
	expect(getComputedStyle(name).textOverflow).toBe('ellipsis');
	expect(getComputedStyle(name).whiteSpace).toBe('nowrap');
	expect(rect(name).height).toBeLessThan(24);
	// The status shares the name's line and stays inside the rail.
	expect(Math.abs(status.top + status.height / 2 - (rect(name).top + rect(name).height / 2))).toBeLessThan(1);
	expect(status.right).toBeLessThanOrEqual(rect(document.querySelector('#shell-context-rail')!).right);
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

test('keeps prose to 75ch inside the full-width session column', async () => {
	const base = sessionFixtures.running[0]!;
	const session = base.sessions[0]!;
	const prose = 'Gutter rows now follow visual line offsets, so wrapped lines keep their markers. '.repeat(4);
	const body = `${prose}\n\n\`\`\`ts\nconst offsets = rows.map((row) => row.visualLine);\n\`\`\``;
	await render(SessionView, {
		workspaces: [
			{ ...base, sessions: [{ ...session, transcript: [{ id: 'a1', kind: 'message', role: 'assistant', body }] }] }
		],
		activeSessionId: session.id
	});
	await document.fonts.ready;

	const column = rect(document.querySelector('.session-view')!);
	const remPx = Number(getComputedStyle(document.documentElement).fontSize.replace('px', ''));
	expect(column.width).toBeCloseTo(58 * remPx, 0);

	const paragraph = document.querySelector('.session-message .markdown p')!;
	const measure = Number(getComputedStyle(paragraph).maxWidth.replace('px', ''));
	expect(rect(paragraph).width).toBeLessThanOrEqual(measure);
	expect(rect(paragraph).width).toBeLessThan(column.width - 100);

	// Code takes the whole column, and the composer shares the column's edges.
	const code = rect(document.querySelector('.session-message .markdown__code')!);
	const composer = rect(document.querySelector('.session-view__composer-stack')!);
	expect(code.left).toBeCloseTo(column.left, 0);
	expect(code.right).toBeCloseTo(column.right, 0);
	expect(composer.left).toBeCloseTo(column.left, 0);
	expect(composer.right).toBeCloseTo(column.right, 0);
});
