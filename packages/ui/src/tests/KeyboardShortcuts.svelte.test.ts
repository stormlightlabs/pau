import { page, userEvent } from 'vitest/browser';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import KeyboardShortcutsDemo from '../stories/KeyboardShortcutsDemo.svelte';

/** Dispatches a key press at an element, as the browser does for the focused element. */
function press(init: KeyboardEventInit, target: Element = document.activeElement ?? document.body): KeyboardEvent {
	const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
	target.dispatchEvent(event);
	return event;
}

const lastAction = () => page.getByLabelText('Last action');

test.each([
	[{ key: 'o', code: 'KeyO', metaKey: true }, 'Open workspace'],
	[{ key: 'n', code: 'KeyN', metaKey: true }, 'New session'],
	[{ key: 'Tab', ctrlKey: true }, 'Next session'],
	[{ key: 'Tab', ctrlKey: true, shiftKey: true }, 'Previous session'],
	[{ key: '4', code: 'Digit4', metaKey: true }, 'Go to session 1 to 9 (4)'],
	[{ key: 'Escape', shiftKey: true }, 'Clear attention markers'],
	[{ key: 'l', code: 'KeyL', metaKey: true }, 'Focus the composer'],
	[{ key: '[', code: 'BracketLeft', metaKey: true }, 'Go back'],
	[{ key: ']', code: 'BracketRight', metaKey: true }, 'Go forward'],
	[{ key: '=', code: 'Equal', metaKey: true }, 'Zoom in'],
	[{ key: '+', code: 'Equal', metaKey: true, shiftKey: true }, 'Zoom in'],
	[{ key: '-', code: 'Minus', metaKey: true }, 'Zoom out'],
	[{ key: '0', code: 'Digit0', metaKey: true }, 'Actual size']
] satisfies [KeyboardEventInit, string][])('runs %o as %s', async (init, label) => {
	await render(KeyboardShortcutsDemo, { platform: 'mac' });

	const event = press(init, document.body);

	await expect.element(lastAction()).toHaveTextContent(label);
	expect(event.defaultPrevented).toBe(true);
});

test('opens the shortcut list with Command+/ and closes it with Escape', async () => {
	await render(KeyboardShortcutsDemo, { platform: 'mac' });

	press({ key: '/', code: 'Slash', metaKey: true }, document.body);
	const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
	await expect.element(dialog).toBeVisible();
	await expect.element(dialog.getByText('Toggle the workspace column')).toBeVisible();

	await userEvent.keyboard('{Escape}');
	await expect.element(dialog).not.toBeInTheDocument();
});

test('toggles the workspace column, docked or as the narrow overlay', async () => {
	await page.viewport(1280, 800);
	await render(KeyboardShortcutsDemo, { platform: 'mac' });
	const column = page.getByRole('complementary', { name: 'Workspace', exact: true });

	press({ key: '∫', code: 'KeyB', metaKey: true, altKey: true }, document.body);
	await expect.element(column).not.toBeInTheDocument();
	press({ key: '∫', code: 'KeyB', metaKey: true, altKey: true }, document.body);
	await expect.element(column).toBeVisible();

	await page.viewport(1000, 800);
	await expect.element(column).not.toBeInTheDocument();
	press({ key: '∫', code: 'KeyB', metaKey: true, altKey: true }, document.body);
	await expect.element(page.getByRole('dialog', { name: 'Workspace', exact: true })).toHaveFocus();
});

test('gives a chord to a conflicting Pi binding', async () => {
	await render(KeyboardShortcutsDemo, {
		platform: 'other',
		piBindings: [{ action: 'app.session.toggleNamedFilter', keys: ['ctrl+n'] }]
	});

	const event = press({ key: 'n', code: 'KeyN', ctrlKey: true }, document.body);
	press({ key: 'o', code: 'KeyO', ctrlKey: true }, document.body);

	await expect.element(lastAction()).toHaveTextContent('Open workspace');
	expect(event.defaultPrevented).toBe(false);
});

test('names where each Pi binding keeps its chord', async () => {
	await render(KeyboardShortcutsDemo, {
		platform: 'other',
		open: true,
		piBindings: [
			{ action: 'tui.editor.deleteToLineEnd', keys: ['ctrl+k'] },
			{ action: 'app.model.cycleBackward', keys: ['shift+ctrl+p'] }
		]
	});
	const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });

	await expect
		.element(dialog.getByText('Pi uses Ctrl+K to delete to the end of the line while you type'))
		.toBeVisible();
	await expect.element(dialog.getByText('Pi uses Ctrl+Shift+P to switch to the previous model')).toBeVisible();
});

test('leaves keys to the terminal, code editors, and dialogs', async () => {
	await render(KeyboardShortcutsDemo, { platform: 'mac' });

	for (const name of ['Terminal', 'Code editor']) {
		const element = page.getByRole('textbox', { name }).element();
		const event = press({ key: 'n', code: 'KeyN', metaKey: true }, element);
		expect(event.defaultPrevented).toBe(false);
	}
	press({ key: '/', code: 'Slash', metaKey: true }, document.body);
	await expect.element(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
	const close = page.getByRole('button', { name: 'Close keyboard shortcuts' }).element();
	expect(press({ key: 'n', code: 'KeyN', metaKey: true }, close).defaultPrevented).toBe(false);

	await expect.element(lastAction()).toHaveTextContent('Show keyboard shortcuts');
});

test('runs only typing-safe shortcuts from a text field', async () => {
	await render(KeyboardShortcutsDemo, { platform: 'mac' });
	const prompt = page.getByRole('textbox', { name: 'Prompt' }).element();

	expect(press({ key: '[', code: 'BracketLeft', metaKey: true }, prompt).defaultPrevented).toBe(false);
	await expect.element(lastAction()).toHaveTextContent('None');

	press({ key: 'n', code: 'KeyN', metaKey: true }, prompt);
	await expect.element(lastAction()).toHaveTextContent('New session');
});

test('draws the shortcut dialog with the border token and does not start on Close', async () => {
	await render(KeyboardShortcutsDemo, { platform: 'mac' });
	press({ key: '/', code: 'Slash', metaKey: true }, document.body);
	const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
	await expect.element(dialog).toBeVisible();

	const probe = document.createElement('i');
	probe.style.color = 'var(--pau-border)';
	dialog.element().append(probe);
	const border = getComputedStyle(probe).color;
	probe.style.color = 'var(--pau-focus)';
	const focus = getComputedStyle(probe).color;
	probe.remove();
	const style = getComputedStyle(dialog.element());
	expect(style.borderTopColor).toBe(border);
	expect(style.borderTopColor).not.toBe(focus);
	expect(style.borderTopLeftRadius).toBe('5px');

	expect(document.activeElement).toBe(dialog.element());
});
