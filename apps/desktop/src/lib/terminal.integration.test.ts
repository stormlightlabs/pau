import { TerminalSurface, THEMES, type ThemeName } from '@stormlightlabs/pau-ui';
import { afterEach, expect, inject, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import { closeTerminal, DESKTOP_CONNECTION_GLOBAL, listTerminals } from './api';
import { createTerminalSource } from './terminal-source';

declare module 'vitest' {
	export interface ProvidedContext {
		pauApi: { connection: { apiOrigin: string; token: string }; workspaceId: string };
	}
}

const { connection, workspaceId } = inject('pauApi');

// Connect the way the desktop shell does, through a frozen global that exists
// before the client reads it.
Object.defineProperty(globalThis, DESKTOP_CONNECTION_GLOBAL, { value: Object.freeze(connection) });

// Terminals outlive the surface, so close each test's terminals before the
// next test mounts a surface that would reattach them.
afterEach(async () => {
	const terminals = await listTerminals();
	for (const terminal of terminals) await closeTerminal(terminal.id);
});

function renderSurface(theme: ThemeName = 'eldritch') {
	return render(TerminalSurface, {
		workspaceName: 'integration',
		source: createTerminalSource(location.origin, workspaceId),
		theme
	});
}

function terminalRows(label: string): HTMLElement[] {
	return [...document.querySelectorAll<HTMLElement>(`[aria-label="${CSS.escape(label)}"] .xterm-rows > div`)];
}

function screenText(label: string): string {
	return terminalRows(label)
		.map((row) => (row.textContent ?? '').replaceAll(' ', ' ').trimEnd())
		.join('\n');
}

function rgb(hex: string): string {
	const [red, green, blue] = hex
		.slice(1)
		.match(/.{2}/g)!
		.map((channel) => Number.parseInt(channel, 16));
	return `rgb(${red}, ${green}, ${blue})`;
}

/** Opens a terminal from the empty state or the tab bar and waits for the shell prompt. */
async function openShell(label: string): Promise<void> {
	const empty = page.getByRole('button', { name: 'Open a terminal' });
	await userEvent.click(empty.query() ? empty : page.getByRole('button', { name: 'New terminal' }));
	await expect.poll(() => screenText(label), { timeout: 10_000 }).toContain('pau$');
}

async function run(label: string, command: string, expected: string | RegExp): Promise<void> {
	// `[` and `{` start key descriptors in userEvent.keyboard; doubling types them literally.
	await userEvent.keyboard(command.replaceAll('[', '[[').replaceAll('{', '{{') + '{Enter}');
	await expect.poll(() => screenText(label), { timeout: 10_000 }).toMatch(expected);
}

test('runs shell commands with Unicode input and output', async () => {
	await renderSurface();
	await openShell('sh terminal');

	await run('sh terminal', String.raw`printf '%s\n' "typed 界 é"`, /^typed 界 é$/m);
	await run('sh terminal', String.raw`printf '\344\270\226 \360\237\231\202\n'`, /^世 🙂$/m);
});

test('reattaches running terminals after the surface unmounts', async () => {
	const first = await renderSurface();
	await openShell('sh terminal');
	await run('sh terminal', 'echo before-route-change', /^before-route-change$/m);
	first.unmount();

	await renderSurface();
	await expect.element(page.getByRole('tab', { name: 'sh' })).toHaveAttribute('aria-selected', 'true');
	await expect.poll(() => screenText('sh terminal'), { timeout: 10_000 }).toMatch(/^before-route-change$/m);
	await run('sh terminal', 'echo after-route-change', /^after-route-change$/m);
});

test('copies selected output and pastes clipboard text as input', async () => {
	await renderSurface();
	await openShell('sh terminal');
	await run('sh terminal', 'echo copy-me-123', /^copy-me-123$/m);

	const row = terminalRows('sh terminal').find((candidate) => candidate.textContent?.trim() === 'copy-me-123')!;
	const screen = row.closest('.xterm')!.querySelector('.xterm-screen')!;
	const offset = row.getBoundingClientRect().top - screen.getBoundingClientRect().top;
	await userEvent.tripleClick(screen, { position: { x: 12, y: offset + row.offsetHeight / 2 } });
	await userEvent.click(page.getByRole('button', { name: 'Copy selection' }));
	await expect.poll(() => navigator.clipboard.readText()).toMatch(/^copy-me-123\s*$/);

	await navigator.clipboard.writeText('echo pasted-界');
	await userEvent.click(page.getByRole('button', { name: 'Paste' }));
	await run('sh terminal', '', /^pasted-界$/m);
});

test('resizes the shell when the surface changes size', async () => {
	await page.viewport(1280, 820);
	await renderSurface();
	await openShell('sh terminal');
	const size = /^(\d+) (\d+)$/m;
	await run('sh terminal', 'stty size', size);
	const [, wideRows, wideCols] = size.exec(screenText('sh terminal'))!.map(Number);

	await page.viewport(900, 520);
	await userEvent.keyboard('clear; stty size{Enter}');
	await expect
		.poll(() => Number(/^(\d+) (\d+)$/m.exec(screenText('sh terminal'))?.[2] ?? wideCols), { timeout: 10_000 })
		.toBeLessThan(wideCols);
	const [, narrowRows] = size.exec(screenText('sh terminal'))!.map(Number);
	expect(narrowRows).toBeLessThan(wideRows);
});

test('shows exit state and the ANSI palette in each theme', async () => {
	const surface = await renderSurface();
	const themes = Object.keys(THEMES) as ThemeName[];

	for (const [index, theme] of themes.entries()) {
		await surface.rerender({ theme });
		const label = index === 0 ? 'sh terminal' : `sh ${index + 1} terminal`;
		await openShell(label);
		await run(label, String.raw`printf '\033[31mred-%s\033[0m\n' ${index}`, new RegExp(`^red-${index}$`, 'm'));

		const view = page.getByRole('group', { name: label }).element() as HTMLElement;
		const red = [...view.querySelectorAll(':scope .xterm-rows span.xterm-fg-1')].find((span) =>
			span.textContent?.includes(`red-${index}`)
		)!;
		expect(getComputedStyle(red).color).toBe(rgb(THEMES[theme].terminal.ansi[1]));
		expect(getComputedStyle(view).backgroundColor).toBe(rgb(THEMES[theme].terminal.background));

		await run(label, `exit ${index + 2}`, /exit \d+$/m);
		await expect.element(page.getByText(`The process exited with code ${index + 2}.`)).toBeVisible();
	}

	await userEvent.click(page.getByRole('button', { name: 'Close sh 5' }));
	await expect.element(page.getByRole('tab', { name: /^sh 5/ })).not.toBeInTheDocument();
});
