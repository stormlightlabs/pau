import { page } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import AppKeymap from './AppKeymap.svelte';
import type { DesktopNativeCapabilities } from './native-capabilities';

function press(init: KeyboardEventInit): KeyboardEvent {
	const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
	document.body.dispatchEvent(event);
	return event;
}

function keybindings(bindings: { action: string; keys: string[] }[] = []): typeof fetch {
	const body = {
		bindings: bindings.map((binding) => ({ ...binding, default_keys: binding.keys, source: 'user' })),
		warnings: []
	};
	return vi.fn(async () => Response.json(body)) as unknown as typeof fetch;
}

function nativeHost() {
	let menuListener: ((actionId: string) => void) | undefined;
	const native = {
		setZoom: vi.fn(async () => {}),
		onMenuAction: (listener: (actionId: string) => void) => {
			menuListener = listener;
			return () => (menuListener = undefined);
		}
	} satisfies DesktopNativeCapabilities;
	return { native, chooseMenuItem: (actionId: string) => menuListener?.(actionId) };
}

test('zooms in, out, and back to actual size', async () => {
	const { native } = nativeHost();
	await render(AppKeymap, { native, fetcher: keybindings(), platform: 'mac' });

	press({ key: '=', code: 'Equal', metaKey: true });
	press({ key: '+', code: 'Equal', metaKey: true, shiftKey: true });
	press({ key: '-', code: 'Minus', metaKey: true });
	press({ key: '0', code: 'Digit0', metaKey: true });

	expect(native.setZoom.mock.calls).toEqual([[1.1], [1.25], [1.1], [1]]);
});

test('keeps browser zoom in the development browser', async () => {
	await render(AppKeymap, { fetcher: keybindings(), platform: 'mac' });

	expect(press({ key: '=', code: 'Equal', metaKey: true }).defaultPrevented).toBe(false);
});

test('gives a zoom chord to a conflicting Pi binding', async () => {
	const { native } = nativeHost();
	const fetcher = keybindings([{ action: 'app.model.cycleForward', keys: ['ctrl+-'] }]);
	await render(AppKeymap, { native, fetcher, platform: 'other' });
	await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
	// Let the response reach the key map.
	await new Promise((settled) => setTimeout(settled, 0));

	expect(press({ key: '-', code: 'Minus', ctrlKey: true }).defaultPrevented).toBe(false);
	press({ key: '=', code: 'Equal', ctrlKey: true });

	expect(native.setZoom.mock.calls).toEqual([[1.1]]);
});

test('opens the shortcut list from the keyboard and the app menu', async () => {
	const { native, chooseMenuItem } = nativeHost();
	await render(AppKeymap, { native, fetcher: keybindings(), platform: 'mac' });
	const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });

	press({ key: '/', code: 'Slash', metaKey: true });
	await expect.element(dialog).toBeVisible();
	await page.getByRole('button', { name: 'Close keyboard shortcuts' }).click();
	await expect.element(dialog).not.toBeInTheDocument();

	chooseMenuItem('app.shortcuts');
	await expect.element(dialog).toBeVisible();
});

test('opens the session view for a menu action only it can run', async () => {
	const { native, chooseMenuItem } = nativeHost();
	const onOpenSessionView = vi.fn();
	await render(AppKeymap, { native, fetcher: keybindings(), platform: 'mac', onOpenSessionView });

	chooseMenuItem('session.new');

	expect(onOpenSessionView).toHaveBeenCalledOnce();
});

test('ignores the menu event that repeats a key press', async () => {
	const { native, chooseMenuItem } = nativeHost();
	await render(AppKeymap, { native, fetcher: keybindings(), platform: 'mac' });

	press({ key: '=', code: 'Equal', metaKey: true });
	chooseMenuItem('view.zoomIn');

	expect(native.setZoom).toHaveBeenCalledOnce();
});
