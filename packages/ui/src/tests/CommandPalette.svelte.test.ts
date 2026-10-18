import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import CommandPaletteDemo from '../stories/CommandPaletteDemo.svelte';

const palette = () => page.getByRole('dialog', { name: 'Command palette' });
const search = () => page.getByRole('combobox', { name: 'Search or run a command' });
const commandBar = () => page.getByRole('button', { name: /Search or run a command/ });
const lastAction = () => page.getByLabelText('Last action');

/** Dispatches a key press at the focused element, as the browser does. */
function press(init: KeyboardEventInit): void {
	(document.activeElement ?? document.body).dispatchEvent(
		new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
	);
}

afterEach(() => {
	delete document.documentElement.dataset.motion;
});

test('opens instantly from the keyboard and closes on Escape, returning focus', async () => {
	await render(CommandPaletteDemo);
	const prompt = page.getByRole('textbox', { name: 'Prompt' });
	await userEvent.click(prompt);

	press({ key: 'k', code: 'KeyK', metaKey: true });

	await expect.element(palette()).toBeVisible();
	await expect.element(search()).toHaveFocus();
	await expect.element(search()).toHaveAttribute('aria-expanded', 'true');
	expect((palette().element() as HTMLElement).dataset.entrance).toBeUndefined();

	await userEvent.keyboard('{Escape}');
	await expect.element(palette()).not.toBeInTheDocument();
	await expect.element(prompt).toHaveFocus();
});

test('fades in from a pointer open unless motion is reduced', async () => {
	await render(CommandPaletteDemo);

	await userEvent.click(commandBar());
	await expect.element(palette()).toHaveAttribute('data-entrance', 'fade');
	await userEvent.keyboard('{Escape}');
	await expect.element(commandBar()).toHaveFocus();

	document.documentElement.dataset.motion = 'reduce';
	await userEvent.click(commandBar());
	await expect.element(palette()).toBeVisible();
	expect((palette().element() as HTMLElement).dataset.entrance).toBeUndefined();
});

test('filters with fuzzy matching and shows each shortcut', async () => {
	await render(CommandPaletteDemo);
	await userEvent.click(commandBar());

	await userEvent.type(search(), 'nxs');

	const options = page.getByRole('option');
	await expect.element(options).toHaveLength(1);
	await expect.element(page.getByRole('option', { name: /Next session/ })).toHaveTextContent('⌃Tab');
	await expect.element(page.getByRole('option', { name: /Next session/ })).toHaveAttribute('aria-selected', 'true');

	await userEvent.clear(search());
	await userEvent.type(search(), 'gutter');
	await expect.element(page.getByRole('option', { name: /Fix diff gutter markers/ })).toHaveTextContent('pau');
});

test('shows unavailable actions disabled with their reasons', async () => {
	await render(CommandPaletteDemo);
	await userEvent.click(commandBar());

	const shortcuts = page.getByRole('option', { name: /Show keyboard shortcuts/ });
	await expect.element(shortcuts).toHaveAttribute('aria-disabled', 'true');
	await expect.element(shortcuts).toHaveTextContent('Not available in this view');
	await expect.element(page.getByRole('option', { name: /Zoom in/ })).toHaveTextContent('Available in the desktop app');
	await expect.element(page.getByRole('option', { name: /Terminal/ })).toHaveTextContent('Open a workspace first');

	(shortcuts.element() as HTMLElement).click();
	await expect.element(palette()).toBeVisible();

	await userEvent.type(search(), 'keyboard');
	await userEvent.keyboard('{Enter}');
	await expect.element(palette()).toBeVisible();
	await expect.element(lastAction()).toHaveTextContent('None');
});

test('shows an empty result', async () => {
	await render(CommandPaletteDemo);
	await userEvent.click(commandBar());

	await userEvent.type(search(), 'qqqq');

	await expect.element(palette().getByRole('status')).toHaveTextContent('No matches');
	expect(page.getByRole('option').elements()).toHaveLength(0);
	expect(search().element().hasAttribute('aria-activedescendant')).toBe(false);
});

test('runs the active entry with Enter and closes', async () => {
	await render(CommandPaletteDemo);
	await userEvent.click(commandBar());

	await userEvent.type(search(), 'session');
	await userEvent.keyboard('{ArrowDown}');
	await expect.element(page.getByRole('option', { name: /Next session/ })).toHaveAttribute('aria-selected', 'true');
	await userEvent.keyboard('{Enter}');

	await expect.element(palette()).not.toBeInTheDocument();
	await expect.element(lastAction()).toHaveTextContent('Next session');
});

test('runs a clicked session and lets an action move focus after closing', async () => {
	await render(CommandPaletteDemo);
	await userEvent.click(commandBar());
	await userEvent.click(page.getByRole('option', { name: /Rename theme tokens/ }));
	await expect.element(palette()).not.toBeInTheDocument();
	await expect.element(lastAction()).toHaveTextContent('Opened Rename theme tokens');

	await userEvent.click(commandBar());
	await userEvent.type(search(), 'focus composer');
	await userEvent.keyboard('{Enter}');
	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toHaveFocus();
});

test('closes with the same chord that opened it', async () => {
	await render(CommandPaletteDemo);
	press({ key: 'k', code: 'KeyK', metaKey: true });
	await expect.element(search()).toHaveFocus();

	press({ key: 'k', code: 'KeyK', metaKey: true });
	await expect.element(palette()).not.toBeInTheDocument();
});

const PREVIOUS_MODEL = { action: 'app.model.cycleBackward', keys: ['shift+ctrl+p'] };
/** Pi's Linux defaults for the chords that open the palette. */
const PI_LINUX_DEFAULTS = [{ action: 'tui.editor.deleteToLineEnd', keys: ['ctrl+k'] }, PREVIOUS_MODEL];

/** Dispatches a key press at an element and reports whether Pau took it. */
function pressAt(element: Element, init: KeyboardEventInit): boolean {
	const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
	element.dispatchEvent(event);
	return event.defaultPrevented;
}

test('leaves Ctrl+K to the composer and opens the palette with it elsewhere on Linux', async () => {
	await render(CommandPaletteDemo, { platform: 'other', piBindings: PI_LINUX_DEFAULTS });
	const prompt = page.getByRole('textbox', { name: 'Prompt' }).element();
	await expect.element(commandBar()).toHaveTextContent('Ctrl+K');

	expect(pressAt(prompt, { key: 'k', code: 'KeyK', ctrlKey: true })).toBe(false);
	await expect.element(palette()).not.toBeInTheDocument();

	expect(pressAt(document.body, { key: 'k', code: 'KeyK', ctrlKey: true })).toBe(true);
	await expect.element(palette()).toBeVisible();
});

test('gives Ctrl+Shift+P to Pi everywhere and keeps F1', async () => {
	await render(CommandPaletteDemo, { platform: 'other', piBindings: PI_LINUX_DEFAULTS });
	const prompt = page.getByRole('textbox', { name: 'Prompt' }).element();

	for (const target of [prompt, document.body]) {
		expect(pressAt(target, { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true })).toBe(false);
	}
	await expect.element(palette()).not.toBeInTheDocument();

	press({ key: 'F1', code: 'F1' });
	await expect.element(palette()).toBeVisible();
});

test('opens the palette with Ctrl+K in the composer once Pi deletes to the line end with another chord', async () => {
	await render(CommandPaletteDemo, {
		platform: 'other',
		piBindings: [{ action: 'tui.editor.deleteToLineEnd', keys: ['ctrl+shift+k'] }, PREVIOUS_MODEL]
	});
	const prompt = page.getByRole('textbox', { name: 'Prompt' }).element();

	expect(pressAt(prompt, { key: 'k', code: 'KeyK', ctrlKey: true })).toBe(true);
	await expect.element(palette()).toBeVisible();
});
