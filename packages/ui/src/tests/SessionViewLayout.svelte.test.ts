import { page } from 'vitest/browser';
import { beforeEach, expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { savedSessionFixtures } from '../fixtures/saved-sessions';
import { sessionFixtures } from '../fixtures/sessions';
import SessionView from '../lib/SessionView.svelte';
import type { SessionWorkspace } from '../lib/types/session';

beforeEach(async () => {
	await page.viewport(1440, 900);
});

const longName: SessionWorkspace[] = [
	{ id: 'ankify', name: 'ankify-spaced-repetition-sync-service', path: '/Users/me/ankify', sessions: [] }
];

function renderBay() {
	return render(SessionView, {
		workspaces: longName,
		onStartSession: async () => {},
		onLoadSavedSessions: async () => savedSessionFixtures.empty,
		onResumeSession: async () => {},
		onOpenWorkspace: async () => 'ankify'
	});
}

const rect = (element: Element) => element.getBoundingClientRect();

test('lays out the saved-session picker as a top-aligned panel', async () => {
	await renderBay();
	await page.getByRole('button', { name: 'More ways to start a session' }).click();
	await page.getByRole('menuitem', { name: 'Saved sessions…' }).click();

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

test('keeps prose and lists at every level to 75ch inside the full-width session column', async () => {
	const base = sessionFixtures.running[0]!;
	const session = base.sessions[0]!;
	const prose = 'Gutter rows now follow visual line offsets, so wrapped lines keep their markers. '.repeat(4);
	const body = [
		prose,
		`- ${prose}\n  - ${prose}`,
		'99. Ninety-nine\n100. One hundred',
		'Then the long list.',
		'999. Nine hundred ninety-nine\n1000. One thousand',
		'```ts\nconst offsets = rows.map((row) => row.visualLine);\n```'
	].join('\n\n');
	await render(SessionView, {
		workspaces: [
			{ ...base, sessions: [{ ...session, transcript: [{ id: 'a1', kind: 'message', role: 'assistant', body }] }] }
		],
		activeSessionId: session.id
	});
	await document.fonts.ready;

	// The column's content box, inside its gutters, is at most 58rem wide.
	const content = document.querySelector('.session-view__transcript-content')!;
	const gutter = Number(getComputedStyle(content).paddingLeft.replace('px', ''));
	const box = rect(content);
	const column = { left: box.left + gutter, right: box.right - gutter, width: box.width - 2 * gutter };
	const remPx = Number(getComputedStyle(document.documentElement).fontSize.replace('px', ''));
	expect(column.width).toBeLessThanOrEqual(58 * remPx);

	// 75 advances of the paragraph font's zero, the width of its `ch`.
	const paragraph = document.querySelector('.session-message .markdown > p')!;
	const style = getComputedStyle(paragraph);
	const context = document.createElement('canvas').getContext('2d')!;
	context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
	const measure = 75 * context.measureText('0').width;
	expect(measure).toBeLessThanOrEqual(column.width);
	expect(rect(paragraph).left).toBeCloseTo(column.left, 0);
	expect(rect(paragraph).width).toBeCloseTo(measure, 0);

	// Items at both levels end on the paragraph's right edge, not an indent past it.
	const outer = document.querySelector('.session-message .markdown > ul > li')!;
	const inner = outer.querySelector(':scope > ul > li')!;
	expect(rect(inner).left).toBeGreaterThan(rect(outer).left);
	expect(rect(outer).right).toBeCloseTo(rect(paragraph).right, 0);
	expect(rect(inner).right).toBeCloseTo(rect(paragraph).right, 0);

	// Numbers end `space/2` before their text and stay inside the column.
	for (const item of document.querySelectorAll('.session-message .markdown > ol > li')) {
		const marker = getComputedStyle(item, '::before');
		context.font = `${marker.fontWeight} ${marker.fontSize} ${marker.fontFamily}`;
		const number = String(
			Number(item.parentElement!.getAttribute('start')) + [...item.parentElement!.children].indexOf(item)
		);
		const width = context.measureText(`${'0'.repeat(number.length)}.`).width;
		expect(marker.content, number).toBe('counter(list-item) "."');
		expect(Number(marker.height.replace('px', '')), number).toBeLessThanOrEqual(
			Number(marker.lineHeight.replace('px', ''))
		);
		expect(rect(item).left - remPx / 2 - width, number).toBeGreaterThanOrEqual(column.left);
	}

	// Code takes the whole column, and the composer shares the column's edges.
	const code = rect(document.querySelector('.session-message .markdown__code')!);
	const composer = rect(document.querySelector('.session-composer')!);
	expect(code.left).toBeCloseTo(column.left, 0);
	expect(code.right).toBeCloseTo(column.right, 0);
	expect(composer.left).toBeCloseTo(column.left, 0);
	expect(composer.right).toBeCloseTo(column.right, 0);
});
