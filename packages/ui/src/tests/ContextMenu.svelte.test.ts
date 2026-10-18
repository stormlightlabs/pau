import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { contextMenuRequest, isContextMenuKey, revealLabel, type ContextMenuItem } from '../lib/context-menu';
import ContextMenu from '../lib/ContextMenu.svelte';

const items: ContextMenuItem[] = [
	{ id: 'open', label: 'Open' },
	{ id: 'copy', label: 'Copy path' },
	{ id: 'archive', label: 'Archive', separatorBefore: true, disabled: true, reason: 'Coming soon' }
];

const invokers: HTMLElement[] = [];

afterEach(() => {
	for (const invoker of invokers.splice(0)) invoker.remove();
});

async function renderMenu(onSelect = vi.fn(), onClose = vi.fn()) {
	const invoker = document.createElement('button');
	invokers.push(invoker);
	invoker.textContent = 'Session row';
	document.body.append(invoker);
	invoker.focus();
	await render(ContextMenu, {
		request: { label: 'Session actions', items, x: 40, y: 40, keyboard: true, invoker, onSelect },
		onClose
	});
	return { onSelect, onClose, invoker };
}

test('focuses the first item and moves with the arrow, Home, End, and typeahead keys', async () => {
	await renderMenu();
	const menu = page.getByRole('menu', { name: 'Session actions' });

	await expect.element(menu).toBeVisible();
	await expect.element(page.getByRole('menuitem', { name: 'Open' })).toHaveFocus();
	await userEvent.keyboard('{ArrowDown}');
	await expect.element(page.getByRole('menuitem', { name: 'Copy path' })).toHaveFocus();
	await userEvent.keyboard('{End}');
	await expect.element(page.getByRole('menuitem', { name: 'Archive' })).toHaveFocus();
	await userEvent.keyboard('{ArrowDown}');
	await expect.element(page.getByRole('menuitem', { name: 'Open' })).toHaveFocus();
	await userEvent.keyboard('c');
	await expect.element(page.getByRole('menuitem', { name: 'Copy path' })).toHaveFocus();
	await userEvent.keyboard('{Home}');
	await expect.element(page.getByRole('menuitem', { name: 'Open' })).toHaveFocus();
});

test('explains a disabled item and refuses it', async () => {
	const { onSelect, onClose } = await renderMenu();
	const archive = page.getByRole('menuitem', { name: 'Archive' });

	await expect.element(archive).toHaveAttribute('aria-disabled', 'true');
	await expect.element(archive).toHaveAccessibleDescription('Coming soon');
	await userEvent.click(archive, { force: true });

	expect(onSelect).not.toHaveBeenCalled();
	expect(onClose).not.toHaveBeenCalled();
});

test('runs the chosen item and returns focus to the invoker', async () => {
	const { onSelect, onClose, invoker } = await renderMenu();

	await userEvent.keyboard('{ArrowDown}{Enter}');

	expect(onSelect).toHaveBeenCalledWith('copy');
	expect(onClose).toHaveBeenCalledOnce();
	expect(document.activeElement).toBe(invoker);
});

test('closes on Escape and returns focus to the invoker', async () => {
	const { onSelect, onClose, invoker } = await renderMenu();

	await userEvent.keyboard('{Escape}');

	expect(onClose).toHaveBeenCalledOnce();
	expect(onSelect).not.toHaveBeenCalled();
	expect(document.activeElement).toBe(invoker);
});

test('recognizes the menu keys and opens a keyboard menu below its element', () => {
	expect(isContextMenuKey(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true }))).toBe(true);
	expect(isContextMenuKey(new KeyboardEvent('keydown', { key: 'ContextMenu' }))).toBe(true);
	expect(isContextMenuKey(new KeyboardEvent('keydown', { key: 'F10' }))).toBe(false);
	expect(revealLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('Reveal in Finder');
	expect(revealLabel('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Show in folder');

	const element = document.createElement('button');
	document.body.append(element);
	const key = new KeyboardEvent('keydown', { key: 'ContextMenu', cancelable: true });
	Object.defineProperties(key, { currentTarget: { value: element }, target: { value: element } });
	const request = contextMenuRequest(key, 'Actions', items, () => {});
	const bounds = element.getBoundingClientRect();

	expect(key.defaultPrevented).toBe(true);
	expect(request).toMatchObject({ keyboard: true, invoker: element, y: bounds.bottom });
	element.remove();
});
