import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { modelFixtures } from '../fixtures/models';
import { sessionFixtures } from '../fixtures/sessions';
import { transcriptSearchFixtures } from '../fixtures/transcript-search';
import ApplicationShellDemo from '../stories/ApplicationShellDemo.svelte';
import ExtensionUi from '../lib/ExtensionUi.svelte';
import { COMPOSER_ATTRIBUTE, createFocusReturn } from '../lib/focus-return';
import ModelPicker from '../lib/ModelPicker.svelte';
import SessionView from '../lib/SessionView.svelte';
import type { ExtensionDialog, ExtensionUiState } from '../lib/types/session';
import KeyboardShortcutsDemo from '../stories/KeyboardShortcutsDemo.svelte';

afterEach(() => {
	for (const element of document.querySelectorAll('[data-test-element]')) element.remove();
});

/** Adds a button outside the component under test and focuses it, as the control that opens an overlay. */
function addInvoker(label = 'Opener'): HTMLButtonElement {
	const button = document.createElement('button');
	button.textContent = label;
	button.dataset.testElement = '';
	document.body.append(button);
	button.focus();
	return button;
}

/** Adds the prompt field that overlays fall back to when their opener is gone. */
function addComposer(): HTMLTextAreaElement {
	const field = document.createElement('textarea');
	field.setAttribute(COMPOSER_ATTRIBUTE, '');
	field.dataset.testElement = '';
	document.body.append(field);
	return field;
}

function press(target: Element, init: KeyboardEventInit): void {
	target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

const unsupportedDialog: ExtensionDialog = { id: 'later', kind: 'unsupported', method: 'custom' };
const extensionState = (dialog?: ExtensionDialog): ExtensionUiState => ({
	dialog,
	notifications: [],
	statuses: [],
	widgets: []
});

test('restores focus to the opener, or to the composer when the opener is gone', () => {
	const composer = addComposer();
	const opener = addInvoker();
	const focusReturn = createFocusReturn();

	focusReturn.capture();
	composer.focus();
	focusReturn.restore();
	expect(document.activeElement).toBe(opener);

	focusReturn.capture();
	opener.remove();
	focusReturn.restore();
	expect(document.activeElement).toBe(composer);

	// A second restore without a new capture leaves focus alone.
	addInvoker('Elsewhere');
	focusReturn.restore();
	expect(document.activeElement?.textContent).toBe('Elsewhere');
});

test.each([
	['Escape', async () => userEvent.keyboard('{Escape}')],
	['the close control', async () => userEvent.click(page.getByRole('button', { name: 'Close keyboard shortcuts' }))]
])('returns focus from the shortcut list to its opener with %s', async (_name, close) => {
	await render(KeyboardShortcutsDemo, { platform: 'mac' });
	const opener = addInvoker();

	press(opener, { key: '/', code: 'Slash', metaKey: true });
	await expect.element(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
	await close();

	await expect.element(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
	expect(document.activeElement).toBe(opener);
});

test('returns focus from the shortcut list to the composer when its opener is gone', async () => {
	await render(KeyboardShortcutsDemo, { platform: 'mac' });
	const composer = addComposer();
	const opener = addInvoker();

	press(opener, { key: '/', code: 'Slash', metaKey: true });
	await expect.element(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
	opener.remove();
	await userEvent.keyboard('{Escape}');

	await expect.element(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
	expect(document.activeElement).toBe(composer);
});

test.each([
	['Escape', async () => userEvent.keyboard('{Escape}')],
	['the dismiss control', async () => userEvent.click(page.getByRole('button', { name: 'Dismiss' }))]
])('returns focus from an extension dialog to its opener with %s', async (_name, close) => {
	// The host clears the request once the dialog responds.
	const onRespond = vi.fn(() => screen.rerender({ state: extensionState() }));
	const screen = await render(ExtensionUi, { state: extensionState(), onRespond });
	const opener = addInvoker();

	await screen.rerender({ state: extensionState(unsupportedDialog) });
	await expect.element(page.getByRole('dialog')).toBeVisible();
	await close();

	await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
	expect(document.activeElement).toBe(opener);
});

test('returns focus from an extension dialog to the composer when its opener is gone', async () => {
	const screen = await render(ExtensionUi, { state: extensionState() });
	const composer = addComposer();
	const opener = addInvoker();

	await screen.rerender({ state: extensionState(unsupportedDialog) });
	await expect.element(page.getByRole('dialog')).toBeVisible();
	opener.remove();
	await screen.rerender({ state: extensionState() });

	await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
	expect(document.activeElement).toBe(composer);
});

test.each([
	['Escape', async () => userEvent.keyboard('{Escape}')],
	['the trigger', async () => userEvent.click(page.getByRole('button', { name: /^Model:/ }))]
])('returns focus from the model list to its trigger with %s', async (_name, close) => {
	await render(ModelPicker, { load: async () => modelFixtures.populated, onSelect: vi.fn() });
	const trigger = page.getByRole('button', { name: /^Model:/ });

	await userEvent.click(trigger);
	await expect.element(page.getByRole('group', { name: 'Models' })).toBeVisible();
	await close();

	await expect.element(page.getByRole('group', { name: 'Models' })).not.toBeInTheDocument();
	await expect.element(trigger).toHaveFocus();
});

test('returns focus from the model list to the composer when the trigger becomes unavailable', async () => {
	const screen = await render(ModelPicker, { load: async () => modelFixtures.populated, onSelect: vi.fn() });
	const composer = addComposer();

	await userEvent.click(page.getByRole('button', { name: /^Model:/ }));
	await expect.element(page.getByRole('group', { name: 'Models' })).toBeVisible();
	await screen.rerender({ unavailableReason: 'Wait for this run to finish before switching models.' });

	await expect.element(page.getByRole('group', { name: 'Models' })).not.toBeInTheDocument();
	expect(document.activeElement).toBe(composer);
});

test('returns focus from the find bar to its opener, or to the composer when the opener is gone', async () => {
	const onSearchSession = vi.fn(async () => transcriptSearchFixtures.results);
	await render(SessionView, {
		workspaces: sessionFixtures.running,
		activeSessionId: 'session-running',
		onSearchSession
	});
	const field = page.getByRole('searchbox', { name: 'Search transcript' });
	const opener = addInvoker();

	press(opener, { key: 'f', ctrlKey: true });
	await expect.element(field).toHaveFocus();
	await userEvent.keyboard('{Escape}');
	await expect.element(field).not.toBeInTheDocument();
	expect(document.activeElement).toBe(opener);

	press(opener, { key: 'f', ctrlKey: true });
	await expect.element(field).toHaveFocus();
	opener.remove();
	await userEvent.click(page.getByRole('button', { name: 'Close search' }));
	await expect.element(field).not.toBeInTheDocument();
	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toHaveFocus();
});

test.each([
	['Escape', async () => userEvent.keyboard('{Escape}')],
	['the close control', async () => userEvent.click(page.getByRole('button', { name: 'Close checks' }).last())]
])('returns focus from the workspace overlay to its toggle with %s', async (_name, close) => {
	await page.viewport(1000, 800);
	await render(ApplicationShellDemo);
	const toggle = page.getByRole('button', { name: 'Show checks' });

	await userEvent.click(toggle);
	await expect.element(toggle).toHaveAttribute('aria-expanded', 'true');
	await close();

	await expect.element(page.getByRole('dialog', { name: 'Checks' })).not.toBeInTheDocument();
	await expect.element(toggle).toHaveFocus();
});

test('returns focus from the workspace overlay to the composer when its toggle is gone', async () => {
	await page.viewport(1000, 800);
	await render(ApplicationShellDemo);
	const composer = addComposer();
	const toggle = page.getByRole('button', { name: 'Show checks' });

	await userEvent.click(toggle);
	await expect.element(page.getByRole('dialog', { name: 'Checks' })).toHaveFocus();
	toggle.element().remove();
	await userEvent.keyboard('{Escape}');

	expect(document.activeElement).toBe(composer);
});
