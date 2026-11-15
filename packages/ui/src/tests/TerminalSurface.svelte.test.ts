import { expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import { createTerminalFixture } from '../fixtures/terminals';
import { detectPlatform, Keymap, keymapContext } from '../lib/keymap.svelte';
import TerminalSurface from '../lib/TerminalSurface.svelte';
import TerminalView from '../lib/TerminalView.svelte';
import type { TerminalConnectionEvents } from '../lib/types/terminal';
import { THEMES, type ThemeName } from '../theme';

function screenText(label: string): string {
	return document.querySelector(`[aria-label="${CSS.escape(label)}"] .xterm-rows`)?.textContent ?? '';
}

function rgb(hex: string): string {
	const [red, green, blue] = hex
		.slice(1)
		.match(/.{2}/g)!
		.map((channel) => Number.parseInt(channel, 16));
	return `rgb(${red}, ${green}, ${blue})`;
}

test('opens, switches, and closes terminal tabs that carry typed Unicode input', async () => {
	const fixture = createTerminalFixture();
	await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });

	await userEvent.click(page.getByRole('button', { name: 'Open a terminal' }));
	await expect.element(page.getByRole('tab', { name: 'zsh' })).toHaveAttribute('aria-selected', 'true');
	await expect.poll(() => screenText('zsh terminal')).toContain('Terminal ready: 界 🙂');

	await userEvent.keyboard('echo 界{Enter}');
	await expect.poll(() => fixture.input.get('fixture-1')).toBe('echo 界\r');
	await expect.poll(() => screenText('zsh terminal')).toContain('$ echo 界');

	await userEvent.click(page.getByRole('button', { name: 'New terminal' }));
	await expect.element(page.getByRole('tab', { name: 'zsh 2' })).toHaveAttribute('aria-selected', 'true');
	await expect.element(page.getByRole('group', { name: 'zsh 2 terminal' })).toBeVisible();
	await expect.element(page.getByRole('group', { name: 'zsh terminal', exact: true })).not.toBeInTheDocument();

	await userEvent.click(page.getByRole('tab', { name: 'zsh 2' }));
	await userEvent.keyboard('{ArrowLeft}');
	await expect.element(page.getByRole('tab', { name: 'zsh', exact: true })).toHaveAttribute('aria-selected', 'true');

	await userEvent.click(page.getByRole('button', { name: 'Close zsh', exact: true }));
	await expect.element(page.getByRole('tab', { name: 'zsh', exact: true })).not.toBeInTheDocument();
	await expect.element(page.getByRole('tab', { name: 'zsh 2' })).toHaveAttribute('aria-selected', 'true');
});

test('reattaches open terminals when the surface mounts again', async () => {
	const fixture = createTerminalFixture();
	const first = await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });
	await userEvent.click(page.getByRole('button', { name: 'Open a terminal' }));
	await userEvent.click(page.getByRole('button', { name: 'New terminal' }));
	await expect.element(page.getByRole('tab', { name: 'zsh 2' })).toBeVisible();
	first.unmount();

	await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });
	await expect.element(page.getByRole('tab', { name: 'zsh', exact: true })).toHaveAttribute('aria-selected', 'true');
	await expect.element(page.getByRole('tab', { name: 'zsh 2' })).toBeVisible();
	await expect.poll(() => screenText('zsh terminal')).toContain('Terminal ready');
	expect(page.getByRole('button', { name: 'Open a terminal' }).query()).toBeNull();

	await userEvent.click(page.getByRole('button', { name: 'Close zsh', exact: true }));
	await expect.poll(() => fixture.source.list()).toEqual([{ id: 'fixture-2', title: 'zsh 2' }]);
});

test('keeps hidden tabs at their size and unmarked when the terminals move to another surface', async () => {
	await page.viewport(1200, 800);
	const fixture = createTerminalFixture();
	const first = await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });
	await userEvent.click(page.getByRole('button', { name: 'Open a terminal' }));
	await userEvent.click(page.getByRole('button', { name: 'New terminal' }));
	await userEvent.click(page.getByRole('tab', { name: 'zsh', exact: true }));
	await expect.poll(() => fixture.sizes.get('fixture-2')?.cols ?? 0).toBeGreaterThan(80);
	const size = fixture.sizes.get('fixture-2');
	first.unmount();

	await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });
	const hidden = page.getByRole('tab', { name: /^zsh 2/ });
	await expect.poll(() => screenText('zsh terminal')).toContain('Terminal ready');
	await expect.element(hidden).toHaveAttribute('aria-selected', 'false');
	expect(fixture.sizes.get('fixture-2')).toEqual(size);
	await expect.element(hidden).not.toHaveTextContent('New output');
});

test('waits for the open terminals before opening another, so titles keep opening order', async () => {
	const fixture = createTerminalFixture();
	const first = await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });
	await userEvent.click(page.getByRole('button', { name: 'Open a terminal' }));
	await expect.element(page.getByRole('tab', { name: 'zsh' })).toBeVisible();
	first.unmount();

	const listed = Promise.withResolvers<void>();
	const source = {
		...fixture.source,
		list: async () => {
			await listed.promise;
			return fixture.source.list();
		}
	};
	await render(TerminalSurface, { workspaceName: 'pau', source });
	const newTerminal = page.getByRole('button', { name: 'New terminal' });
	await expect.element(newTerminal).toBeDisabled();

	listed.resolve();
	await expect.element(newTerminal).toBeEnabled();
	await userEvent.click(newTerminal);
	await expect.element(page.getByRole('tab', { name: 'zsh 2' })).toHaveAttribute('aria-selected', 'true');
	const titles = page
		.getByRole('tab')
		.elements()
		.map((tab) => tab.textContent?.trim());
	expect(titles).toEqual(['zsh', 'zsh 2']);
});

test('still opens terminals when the open ones cannot be listed', async () => {
	const fixture = createTerminalFixture({ listError: 'The server stopped responding.' });
	await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });
	await expect
		.element(page.getByRole('alert'))
		.toHaveTextContent('Could not reopen your terminals. The server stopped responding.');

	await userEvent.click(page.getByRole('button', { name: 'Open a terminal' }));
	await expect.element(page.getByRole('tab', { name: 'zsh' })).toHaveAttribute('aria-selected', 'true');
});

test('clears the screen before a reconnect replays the output', async () => {
	let events: TerminalConnectionEvents | undefined;
	await render(TerminalView, {
		label: 'zsh terminal',
		connect: (connected) => {
			events = connected;
			return { write: () => {}, resize: () => {}, close: () => {} };
		}
	});
	const encoder = new TextEncoder();
	events!.output(encoder.encode('before'));
	await expect.poll(() => screenText('zsh terminal')).toContain('before');

	events!.reset();
	events!.replay(encoder.encode('replayed'));
	await expect.poll(() => screenText('zsh terminal')).toContain('replayed');
	expect(screenText('zsh terminal')).not.toContain('before');
});

test('answers no queries from the replay but still sends input and answers live queries', async () => {
	let events: TerminalConnectionEvents | undefined;
	const written: string[] = [];
	const decoder = new TextDecoder();
	await render(TerminalView, {
		label: 'zsh terminal',
		connect: (connected) => {
			events = connected;
			return {
				write: (bytes) => {
					written.push(decoder.decode(bytes));
				},
				resize: () => {},
				close: () => {}
			};
		}
	});
	const encoder = new TextEncoder();
	// Device attributes, cursor position and background colour queries.
	events!.replay(encoder.encode('old\u{1B}[c\u{1B}[6n\u{1B}]11;?\u{7}'));
	await expect.poll(() => screenText('zsh terminal')).toContain('old');
	events!.output(encoder.encode('live'));
	await expect.poll(() => screenText('zsh terminal')).toContain('live');
	expect(written).toEqual([]);

	await userEvent.click(page.getByRole('group', { name: 'zsh terminal' }));
	await userEvent.keyboard('x');
	await expect.poll(() => written).toEqual(['x']);
	events!.output(encoder.encode('\u{1B}[c'));
	await expect.poll(() => written).toEqual(['x', '\u{1B}[?1;2c']);
});

test('reports exit status and stops accepting input', async () => {
	const fixture = createTerminalFixture();
	await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });
	await userEvent.click(page.getByRole('button', { name: 'Open a terminal' }));
	await expect.poll(() => screenText('zsh terminal')).toContain('$');

	await userEvent.keyboard('exit 3{Enter}');
	await expect.element(page.getByText('The process exited with code 3.')).toBeVisible();
	await expect.element(page.getByRole('tab', { name: 'zsh exit 3' })).toBeVisible();
	await expect.element(page.getByRole('button', { name: 'Paste' })).toBeDisabled();

	await userEvent.keyboard('more');
	expect(fixture.input.get('fixture-1')).toBe('exit 3\r');
});

test('enables copying once output is selected', async () => {
	const fixture = createTerminalFixture();
	await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });
	await userEvent.click(page.getByRole('button', { name: 'Open a terminal' }));
	await expect.poll(() => screenText('zsh terminal')).toContain('Terminal ready');
	await expect.element(page.getByRole('button', { name: 'Copy selection' })).toBeDisabled();

	const screen = page.getByRole('group', { name: 'zsh terminal' }).element().querySelector('.xterm-screen')!;
	await userEvent.tripleClick(screen, { position: { x: 24, y: 8 } });
	await expect.element(page.getByRole('button', { name: 'Copy selection' })).toBeEnabled();
});

test('fits the grid to the surface and reports each resize', async () => {
	await page.viewport(1200, 800);
	const fixture = createTerminalFixture();
	await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });
	await userEvent.click(page.getByRole('button', { name: 'Open a terminal' }));
	await expect.poll(() => fixture.sizes.get('fixture-1')?.cols ?? 0).toBeGreaterThan(80);
	const wide = fixture.sizes.get('fixture-1')!;

	await page.viewport(900, 500);
	await expect.poll(() => fixture.sizes.get('fixture-1')!.cols).toBeLessThan(wide.cols);
	expect(fixture.sizes.get('fixture-1')!.rows).toBeLessThan(wide.rows);
});

test('applies each theme to the terminal background and ANSI palette', async () => {
	const fixture = createTerminalFixture();
	const screen = await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });
	await userEvent.click(page.getByRole('button', { name: 'Open a terminal' }));
	await expect.poll(() => screenText('zsh terminal')).toContain('~/pau');

	for (const name of Object.keys(THEMES) as ThemeName[]) {
		const { terminal } = THEMES[name];
		await screen.rerender({ theme: name });
		const view = page.getByRole('group', { name: 'zsh terminal' }).element() as HTMLElement;
		// The fixture prompt is bold blue, which xterm.js draws in bright blue.
		const prompt = view.querySelector(':scope .xterm-rows span.xterm-fg-12')!;
		await expect.poll(() => getComputedStyle(prompt).color).toBe(rgb(terminal.ansi[12]));
		expect(getComputedStyle(view).backgroundColor).toBe(rgb(terminal.background));
		// Nothing inside paints another color over the padding around the grid.
		for (const layer of view.querySelectorAll(':scope .xterm, :scope .xterm-viewport, :scope .xterm-screen')) {
			expect(['rgba(0, 0, 0, 0)', rgb(terminal.background)]).toContain(getComputedStyle(layer).backgroundColor);
		}
		expect(view.dataset.theme).toBe(name);
	}
});

/** The platform find chord in `userEvent.keyboard` notation. */
const FIND = detectPlatform() === 'mac' ? '{Meta>}f{/Meta}' : '{Control>}{Shift>}F{/Shift}{/Control}';

/** Build output long enough that the first lines scroll out of view. */
const HISTORY = [
	'error: first failure',
	...Array.from({ length: 200 }, (_, index) => `compiling crate ${index + 1}`),
	'error: last failure'
];

test('finds matches across the scrollback and steps between them', async () => {
	const fixture = createTerminalFixture({ history: HISTORY });
	await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });
	await userEvent.click(page.getByRole('button', { name: 'Open a terminal' }));
	await expect.poll(() => screenText('zsh terminal')).toContain('Terminal ready');
	expect(screenText('zsh terminal')).not.toContain('first failure');

	await userEvent.keyboard(FIND);
	await expect.element(page.getByRole('textbox', { name: 'Find in terminal' })).toHaveFocus();
	await userEvent.keyboard('error:');
	const count = page.getByRole('search', { name: 'Find in terminal' }).getByRole('status');
	await expect.element(count).toHaveTextContent('1 of 2');

	// The first match sits in the scrollback, so finding it scrolls there.
	await expect.poll(() => screenText('zsh terminal')).toContain('first failure');
	await userEvent.keyboard('{Enter}');
	await expect.element(count).toHaveTextContent('2 of 2');
	await expect.poll(() => screenText('zsh terminal')).toContain('last failure');
	await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
	await expect.element(count).toHaveTextContent('1 of 2');
	await userEvent.click(page.getByRole('button', { name: 'Next match' }));
	await expect.element(count).toHaveTextContent('2 of 2');

	await userEvent.keyboard('{Escape}');
	await expect.element(page.getByRole('search')).not.toBeInTheDocument();
	await userEvent.keyboard('ls{Enter}');
	await expect.poll(() => fixture.input.get('fixture-1')).toBe('ls\r');
});

test('reports no matches and disables stepping', async () => {
	const fixture = createTerminalFixture({ history: HISTORY });
	await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });
	await userEvent.click(page.getByRole('button', { name: 'Open a terminal' }));
	await expect.poll(() => screenText('zsh terminal')).toContain('Terminal ready');

	await userEvent.click(page.getByRole('button', { name: 'Find in terminal' }));
	await userEvent.keyboard('warning');
	const count = page.getByRole('search', { name: 'Find in terminal' }).getByRole('status');
	await expect.element(count).toHaveTextContent('No matches');
	await expect.element(page.getByRole('button', { name: 'Previous match' })).toBeDisabled();
	await expect.element(page.getByRole('button', { name: 'Next match' })).toBeDisabled();

	// Reopening keeps the query selected, so typing replaces it.
	await userEvent.click(page.getByRole('button', { name: 'Close find' }));
	await userEvent.keyboard(FIND);
	await userEvent.keyboard('crate 200');
	await expect.element(count).toHaveTextContent('1 of 1');
	expect(fixture.input.get('fixture-1')).toBeUndefined();
});

test('leaves Ctrl+F to the shell outside macOS', async () => {
	const fixture = createTerminalFixture();
	await render(TerminalView, {
		label: 'zsh terminal',
		platform: 'other',
		connect: (events) => fixture.source.connect('fixture-1', events)
	});
	await expect.poll(() => screenText('zsh terminal')).toContain('Terminal ready');

	await userEvent.keyboard('{Control>}f{/Control}');
	await expect.poll(() => fixture.input.get('fixture-1')).toBe('\u{6}');
	expect(document.querySelector('[role="search"]')).toBeNull();

	await userEvent.keyboard('{Control>}{Shift>}F{/Shift}{/Control}');
	await expect.element(page.getByRole('textbox', { name: 'Find in terminal' })).toHaveFocus();
});

test('leaves Ctrl+` to the terminal when there is no dock to toggle', async () => {
	const keymap = new Keymap({ platform: 'mac' });
	const prevented: boolean[] = [];
	const listen = (event: KeyboardEvent) => {
		keymap.handleKeydown(event);
		if (event.key === '`') prevented.push(event.defaultPrevented);
	};
	addEventListener('keydown', listen);
	try {
		const fixture = createTerminalFixture();
		await render(TerminalSurface, {
			props: { workspaceName: 'pau', source: fixture.source },
			context: new Map([[keymapContext, keymap]])
		});
		await userEvent.click(page.getByRole('button', { name: 'Open a terminal' }));
		await expect.poll(() => screenText('zsh terminal')).toContain('Terminal ready');

		await userEvent.keyboard('{Control>}`{/Control}');
		expect(prevented).toEqual([false]);
		expect(keymap.canRun('panel.dock')).toBe(false);
	} finally {
		removeEventListener('keydown', listen);
	}
});

test('marks background tabs that print while another tab shows, until the operator opens them', async () => {
	const fixture = createTerminalFixture();
	await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });
	await userEvent.click(page.getByRole('button', { name: 'Open a terminal' }));
	await userEvent.click(page.getByRole('button', { name: 'New terminal' }));
	await userEvent.click(page.getByRole('button', { name: 'New terminal' }));
	const first = page.getByRole('tab', { name: /^zsh/ }).first();
	const idle = page.getByRole('tab', { name: /^zsh 2/ });
	const active = page.getByRole('tab', { name: /^zsh 3/ });
	const status = page.getByRole('list', { name: 'Terminal status' });
	await expect.element(active).toHaveAttribute('aria-selected', 'true');
	await expect.poll(() => screenText('zsh 3 terminal')).toContain('Terminal ready');

	// Each tab's own ready line arrived while it was the one showing.
	for (const tab of [first, idle, active]) await expect.element(tab).not.toHaveTextContent('New output');

	fixture.print('fixture-1', 'build finished\r\n');
	fixture.print('fixture-3', 'still here\r\n');
	await expect.element(first).toHaveTextContent('New output');
	await expect.element(status.getByRole('button', { name: /^zsh New output/ })).toBeVisible();
	await expect.element(idle).not.toHaveTextContent('New output');
	await expect.element(active).not.toHaveTextContent('New output');

	await userEvent.click(first);
	await expect.element(first).not.toHaveTextContent('New output');
	await expect.poll(() => screenText('zsh terminal')).toContain('build finished');
	await expect.element(status.getByRole('button', { name: /^zsh Running/ })).toBeVisible();
});

test('shows an exited background tab by its exit status instead of new output', async () => {
	const fixture = createTerminalFixture();
	await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });
	await userEvent.click(page.getByRole('button', { name: 'Open a terminal' }));
	await expect.poll(() => screenText('zsh terminal')).toContain('Terminal ready');
	await userEvent.click(page.getByRole('button', { name: 'New terminal' }));
	await expect.element(page.getByRole('tab', { name: /^zsh 2/ })).toHaveAttribute('aria-selected', 'true');

	fixture.print('fixture-1', 'last words\r\n');
	const background = page.getByRole('tab', { name: /^zsh/ }).first();
	await expect.element(background).toHaveTextContent('New output');

	await userEvent.click(background);
	await userEvent.keyboard('exit 3{Enter}');
	await userEvent.click(page.getByRole('tab', { name: /^zsh 2/ }));
	await expect.element(background).toHaveTextContent('exit 3');
	await expect.element(background).not.toHaveTextContent('New output');
	await expect
		.element(
			page.getByRole('list', { name: 'Terminal status' }).getByRole('button', { name: /^zsh Exited with code 3/ })
		)
		.toBeVisible();
});

test('offers a move to the dock only when the app supplies one', async () => {
	const fixture = createTerminalFixture({ running: 1 });
	const onMoveToDock = vi.fn();
	const surface = await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });
	await expect.element(page.getByRole('tab', { name: 'zsh' })).toBeVisible();
	expect(page.getByRole('button', { name: 'Move to dock' }).query()).toBeNull();

	await surface.rerender({ onMoveToDock });
	await userEvent.click(page.getByRole('button', { name: 'Move to dock' }));
	expect(onMoveToDock).toHaveBeenCalledOnce();
});

test('opens a sandboxed terminal and shows its profile on the tab', async () => {
	const fixture = createTerminalFixture({ sandbox: { profile: 'read-only', unavailable: null } });
	await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });

	await userEvent.click(page.getByRole('button', { name: 'Open a terminal' }));
	const plain = page.getByRole('tab', { name: 'zsh', exact: true });
	await expect.element(plain).toBeVisible();
	expect(plain.element().textContent).not.toContain('read only');

	const sandboxed = page.getByRole('button', { name: 'New sandboxed terminal (Read only)' });
	await expect.element(sandboxed).toBeEnabled();
	await userEvent.click(sandboxed);
	const tab = page.getByRole('tab', { name: /^zsh 2/ });
	await expect.element(tab).toHaveAttribute('aria-selected', 'true');
	await expect.element(tab).toHaveAccessibleName(/^zsh 2\s*Sandboxed:\s*read only$/);
	await expect.poll(() => screenText('zsh 2 terminal')).toContain('Terminal ready');
});

test('offers no sandboxed terminal while the workspace has no profile', async () => {
	const fixture = createTerminalFixture({ sandbox: { profile: null, unavailable: null } });
	await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });

	const button = page.getByRole('button', { name: 'New sandboxed terminal' });
	await expect.element(button).toBeDisabled();
	await expect.element(button).toHaveAccessibleDescription(/This workspace has no sandbox profile/);
});

test('keeps the sandboxed terminal unavailable when the host cannot start it', async () => {
	const unavailable = "sandbox-runtime's srt command was not found on PATH.";
	const fixture = createTerminalFixture({ sandbox: { profile: 'workspace-write', unavailable } });
	await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });

	const button = page.getByRole('button', { name: 'New sandboxed terminal (Workspace write)' });
	await expect.element(button).toBeDisabled();
	await expect.element(button).toHaveAccessibleDescription(unavailable);
	await expect.element(page.getByRole('button', { name: 'Open a terminal' })).toBeEnabled();
});

test('keeps the profile unavailable after the relay fails to start, without opening a plain terminal', async () => {
	const fixture = createTerminalFixture({
		sandbox: { profile: 'workspace-write', unavailable: null },
		sandboxError: 'The terminal relay exited before it started.'
	});
	await render(TerminalSurface, { workspaceName: 'pau', source: fixture.source });

	const button = page.getByRole('button', { name: 'New sandboxed terminal (Workspace write)' });
	await userEvent.click(button);

	await expect
		.element(page.getByRole('alert'))
		.toHaveTextContent('Could not open a sandboxed terminal. The terminal relay exited before it started.');
	await expect.element(button).toBeDisabled();
	await expect.element(button).toHaveAccessibleDescription('The terminal relay exited before it started.');
	expect(await fixture.source.list()).toEqual([]);
	expect(page.getByRole('tab').query()).toBeNull();
});
