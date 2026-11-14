import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import type { ComponentProps } from 'svelte';

import { Keymap, keymapContext } from '../lib/keymap.svelte';
import TerminalDockDemo from '../stories/TerminalDockDemo.svelte';

const stops: (() => void)[] = [];
afterEach(() => {
	for (const stop of stops.splice(0)) stop();
});

/** Renders the session view with a key map listening on the window, as the app provides one. */
async function renderDock(props: ComponentProps<typeof TerminalDockDemo> = {}) {
	const keymap = new Keymap({ platform: 'mac' });
	const listen = (event: KeyboardEvent) => keymap.handleKeydown(event);
	addEventListener('keydown', listen);
	stops.push(() => removeEventListener('keydown', listen));
	return render(TerminalDockDemo, { props, context: new Map([[keymapContext, keymap]]) });
}

const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
const terminalFocused = () => Boolean(document.activeElement?.closest('#shell-dock .xterm'));

test('docks terminals under the session on a desktop window', async () => {
	await page.viewport(1440, 900);
	await renderDock();
	const toggle = page.getByRole('button', { name: 'Show terminal dock' });
	await userEvent.click(toggle);

	const dock = page.getByRole('region', { name: 'Terminal dock' });
	await expect.element(dock.getByRole('tab', { name: 'zsh' })).toHaveAttribute('aria-selected', 'true');
	await expect.element(page.getByRole('region', { name: 'Transcript' })).toBeVisible();
	await expect.poll(terminalFocused).toBe(true);

	const main = box('#main-surface');
	const content = box('.app-shell__main-content');
	const docked = box('#shell-dock');
	expect(docked.bottom).toBeCloseTo(main.bottom, 0);
	expect(docked.left).toBeCloseTo(main.left, 0);
	expect(docked.width).toBeCloseTo(main.width, 0);
	expect(content.bottom).toBeCloseTo(docked.top, 0);
	expect(docked.height).toBeCloseTo(main.height * 0.4, -1);

	await userEvent.click(page.getByRole('button', { name: 'Hide terminal dock' }).first());
	await expect.element(dock).not.toBeInTheDocument();
	await expect.element(page.getByRole('button', { name: 'Show terminal dock' })).toHaveFocus();
});

test('gives the dock the whole main surface on a narrow window', async () => {
	await page.viewport(700, 900);
	await renderDock({ open: true });

	const dock = page.getByRole('region', { name: 'Terminal dock' });
	await expect.element(dock.getByRole('tab', { name: 'zsh' })).toBeVisible();
	// The session and the dock's resize handle step aside rather than shrink.
	expect(getComputedStyle(document.querySelector('.app-shell__main-content')!).display).toBe('none');
	expect(getComputedStyle(document.querySelector('.app-shell__resizer--dock')!).display).toBe('none');
	const main = box('#main-surface');
	const docked = box('#shell-dock');
	expect(docked.top).toBeCloseTo(main.top, 0);
	expect(docked.height).toBeCloseTo(main.height, 0);

	await userEvent.click(page.getByRole('button', { name: 'Hide terminal dock' }).first());
	await expect.element(page.getByRole('region', { name: 'Transcript' })).toBeVisible();
});

test('resizes the dock from its edge by keyboard and keeps the session its room', async () => {
	await page.viewport(1440, 900);
	await renderDock({ open: true });
	const separator = page.getByRole('separator', { name: 'Resize terminal dock' });
	await expect.element(separator).toHaveAttribute('aria-orientation', 'horizontal');
	const before = box('#shell-dock').height;

	(separator.element() as HTMLElement).focus();
	await userEvent.keyboard('{ArrowUp}');
	await expect.poll(() => box('#shell-dock').height).toBeCloseTo(before + 16, 0);
	await userEvent.keyboard('{End}');
	await expect.poll(() => box('.app-shell__main-content').height).toBeCloseTo(160, 0);
	await userEvent.keyboard('{Home}');
	await expect.poll(() => box('#shell-dock').height).toBeCloseTo(120, 0);
});

test('toggles the dock with its shortcut, from the session and from inside the terminal', async () => {
	await page.viewport(1440, 900);
	await renderDock();
	const composer = page.getByRole('textbox', { name: 'Prompt' });
	await userEvent.click(composer);

	await userEvent.keyboard('{Control>}`{/Control}');
	await expect.element(page.getByRole('region', { name: 'Terminal dock' })).toBeVisible();
	await expect.poll(terminalFocused).toBe(true);

	await userEvent.keyboard('{Control>}`{/Control}');
	await expect.element(page.getByRole('region', { name: 'Terminal dock' })).not.toBeInTheDocument();
	await expect.element(composer).toHaveFocus();
});

test('returns focus to the opener when a control inside the dock hides it, and moves terminals out', async () => {
	await page.viewport(1440, 900);
	const onMove = vi.fn();
	await renderDock({ onMove });
	const toggle = page.getByRole('button', { name: 'Show terminal dock' });
	await userEvent.click(toggle);
	const dock = page.getByRole('region', { name: 'Terminal dock' });

	await userEvent.click(dock.getByRole('button', { name: 'Move to main area' }));
	expect(onMove).toHaveBeenCalledOnce();

	await userEvent.click(dock.getByRole('button', { name: 'Hide terminal dock' }));
	await expect.element(dock).not.toBeInTheDocument();
	await expect.element(page.getByRole('button', { name: 'Show terminal dock' })).toHaveFocus();
});
