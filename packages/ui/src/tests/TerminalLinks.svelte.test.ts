import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { externalLinkContext, type ExternalLinkOpener } from '../lib/external-links';
import TerminalView from '../lib/TerminalView.svelte';
import type { TerminalConnection, TerminalConnectionEvents, TerminalFileLinks } from '../lib/types/terminal';

/**
 * Renders a terminal that prints `lines`, one per row. The cursor ends on a
 * row of its own, since each cursor blink redraws its row and drops the
 * hovered link there.
 */
async function renderLines(lines: string[], fileLinks?: TerminalFileLinks) {
	const open = vi.fn<ExternalLinkOpener>().mockResolvedValue(undefined);
	const connect = (events: TerminalConnectionEvents): TerminalConnection => {
		events.output(new TextEncoder().encode(lines.join('\r\n') + '\r\n'));
		return { write: () => {}, resize: () => {}, close: () => {} };
	};
	await render(TerminalView, {
		props: { label: 'Links', connect, fileLinks },
		context: new Map([[externalLinkContext, open]])
	});
	await expect.poll(() => document.querySelector('.xterm-rows')?.textContent ?? '').toContain(lines.at(-1)!.trim());
	return open;
}

/** The pointer position, relative to the terminal screen, of the first cell of a row. */
function rowStart(index: number): { x: number; y: number } {
	const row = document.querySelectorAll<HTMLElement>('.xterm-rows > div')[index]!;
	const screen = document.querySelector<HTMLElement>('.xterm-screen')!;
	const box = row.getBoundingClientRect();
	return { x: 4, y: box.top - screen.getBoundingClientRect().top + box.height / 2 };
}

/** Hovers and clicks the first cell of a row, where each test line starts. */
async function clickRow(index: number): Promise<void> {
	const screen = document.querySelector<HTMLElement>('.xterm-screen')!;
	await userEvent.hover(screen, { position: rowStart(index) });
	// Link providers answer after the pointer arrives; the workspace check is asynchronous.
	await new Promise((resolve) => setTimeout(resolve, 50));
	await userEvent.click(screen, { position: rowStart(index) });
}

test('opens a plain-text web address from the output', async () => {
	const open = await renderLines(['https://example.com/docs?page=2.', 'javascript:alert(1)', 'ftp://example.com/file']);

	for (const row of [0, 1, 2]) await clickRow(row);

	await expect.poll(() => open.mock.calls).toEqual([['https://example.com/docs?page=2']]);
});

test('opens workspace file paths, leaves other text plain, and lists each directory once', async () => {
	const listings: Record<string, string[]> = { src: ['src/main.rs', 'src/lib.rs'], notes: ['notes/plan.md'] };
	const files = vi.fn(async (directory: string) => listings[directory] ?? []);
	const openFile = vi.fn();
	const open = await renderLines(
		['src/main.rs:12:5: error', 'src/missing.rs', 'v1.2.3', '../notes/plan.md', 'notes/plan.md', 'src/lib.rs'],
		{ files, open: openFile }
	);

	for (const row of [0, 1, 2, 3, 4, 5]) await clickRow(row);

	await expect
		.poll(() => openFile.mock.calls)
		.toEqual([
			['src/main.rs', 12],
			['notes/plan.md', undefined],
			['src/lib.rs', undefined]
		]);
	expect(files.mock.calls.map(([directory]) => directory).toSorted((a, b) => a.localeCompare(b))).toEqual([
		'notes',
		'src'
	]);
	expect(open).not.toHaveBeenCalled();
});

test('shows a confirmed file path as a link on hover', async () => {
	await renderLines(['crates/term/src/modes.rs:48'], {
		files: async () => ['crates/term/src/modes.rs'],
		open: () => {}
	});
	await userEvent.hover(document.querySelector<HTMLElement>('.xterm-screen')!, { position: rowStart(0) });

	await expect.poll(() => document.querySelector('.xterm-cursor-pointer')).not.toBeNull();
	await expect.element(page.getByRole('group', { name: 'Links' })).toBeVisible();
});
