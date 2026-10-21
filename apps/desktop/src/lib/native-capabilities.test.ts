import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { expect, test, vi } from 'vitest';

import { createDesktopNativeCapabilities, MENU_ACTION_EVENT } from './native-capabilities';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-notification', () => ({
	isPermissionGranted: vi.fn(),
	requestPermission: vi.fn(),
	sendNotification: vi.fn()
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));

test('does not expose native window controls in development browser mode', () => {
	expect(createDesktopNativeCapabilities({})).toEqual({});
});

test('exposes implemented window controls in the Tauri host', async () => {
	const close = vi.fn().mockResolvedValue(undefined);
	vi.mocked(getCurrentWindow).mockReturnValue({ close } as unknown as ReturnType<typeof getCurrentWindow>);
	const capabilities = createDesktopNativeCapabilities({ __TAURI_INTERNALS__: {} });

	await capabilities.window?.close();

	expect(close).toHaveBeenCalledOnce();
});

test('picks one folder with the native dialog and treats cancel as no choice', async () => {
	const capabilities = createDesktopNativeCapabilities({ __TAURI_INTERNALS__: {} });

	vi.mocked(open).mockResolvedValueOnce('/Users/operator/project');
	await expect(capabilities.pickFolder?.()).resolves.toBe('/Users/operator/project');
	expect(open).toHaveBeenCalledWith({ directory: true, multiple: false, title: 'Open workspace' });

	vi.mocked(open).mockResolvedValueOnce(null);
	await expect(capabilities.pickFolder?.()).resolves.toBeUndefined();
});

test('reveals a path in the file manager', async () => {
	const capabilities = createDesktopNativeCapabilities({ __TAURI_INTERNALS__: {} });

	await capabilities.revealPath?.('/Users/operator/project/README.md');

	expect(revealItemInDir).toHaveBeenCalledWith('/Users/operator/project/README.md');
});

test('opens a link in the default browser', async () => {
	const capabilities = createDesktopNativeCapabilities({ __TAURI_INTERNALS__: {} });

	await capabilities.openLink?.('https://example.com/docs');

	expect(openUrl).toHaveBeenCalledWith('https://example.com/docs');
});

test('zooms the webview', async () => {
	const setZoom = vi.fn().mockResolvedValue(undefined);
	vi.mocked(getCurrentWebview).mockReturnValue({ setZoom } as unknown as ReturnType<typeof getCurrentWebview>);

	await createDesktopNativeCapabilities({ __TAURI_INTERNALS__: {} }).setZoom?.(1.25);

	expect(setZoom).toHaveBeenCalledWith(1.25);
});

test('forwards app menu choices until the listener stops', async () => {
	const unlisten = vi.fn();
	let emit: ((event: { payload: string }) => void) | undefined;
	vi.mocked(listen).mockImplementation((_event, handler) => {
		emit = handler as typeof emit;
		return Promise.resolve(unlisten);
	});
	const listener = vi.fn();

	const stop = createDesktopNativeCapabilities({ __TAURI_INTERNALS__: {} }).onMenuAction?.(listener);
	emit?.({ payload: 'session.new' });
	stop?.();
	await Promise.resolve();

	expect(listen).toHaveBeenCalledWith(MENU_ACTION_EVENT, expect.any(Function));
	expect(listener).toHaveBeenCalledWith('session.new');
	expect(unlisten).toHaveBeenCalledOnce();
});

test('asks for notification permission on the first notification, not before', async () => {
	vi.mocked(isPermissionGranted).mockResolvedValue(false);
	vi.mocked(requestPermission).mockResolvedValue('granted');
	const capabilities = createDesktopNativeCapabilities({ __TAURI_INTERNALS__: {} });
	expect(isPermissionGranted).not.toHaveBeenCalled();

	await capabilities.notify?.({ title: 'Fix the login bug', body: 'Pi is waiting for your input.' });
	await capabilities.notify?.({ title: 'Fix the login bug', body: 'Pi exited unexpectedly.' });

	expect(requestPermission).toHaveBeenCalledOnce();
	expect(sendNotification).toHaveBeenCalledTimes(2);
	expect(sendNotification).toHaveBeenCalledWith({ title: 'Fix the login bug', body: 'Pi is waiting for your input.' });
});

test('drops notifications the operator refused', async () => {
	vi.mocked(sendNotification).mockClear();
	vi.mocked(isPermissionGranted).mockResolvedValue(false);
	vi.mocked(requestPermission).mockResolvedValue('denied');

	await createDesktopNativeCapabilities({ __TAURI_INTERNALS__: {} }).notify?.({ title: 'Session', body: 'Body' });

	expect(sendNotification).not.toHaveBeenCalled();
});

test('badges the app icon and follows window focus', async () => {
	const setBadgeCount = vi.fn().mockResolvedValue(undefined);
	const unlisten = vi.fn();
	let emit: ((event: { payload: boolean }) => void) | undefined;
	const onFocusChanged = vi.fn((handler: typeof emit) => {
		emit = handler;
		return Promise.resolve(unlisten);
	});
	const isFocused = vi.fn().mockResolvedValue(true);
	vi.mocked(getCurrentWindow).mockReturnValue({ setBadgeCount, onFocusChanged, isFocused } as unknown as ReturnType<
		typeof getCurrentWindow
	>);
	const capabilities = createDesktopNativeCapabilities({ __TAURI_INTERNALS__: {} });

	await capabilities.setBadgeCount?.(3);
	await capabilities.setBadgeCount?.(undefined);
	const listener = vi.fn();
	const stop = capabilities.onWindowFocusChange?.(listener);
	await Promise.resolve();
	emit?.({ payload: false });
	stop?.();
	await Promise.resolve();

	expect(setBadgeCount.mock.calls).toEqual([[3], [undefined]]);
	expect(listener.mock.calls).toEqual([[true], [false]]);
	expect(unlisten).toHaveBeenCalledOnce();
});
