import { getCurrentWindow } from '@tauri-apps/api/window';
import { expect, test, vi } from 'vitest';

import { createDesktopNativeCapabilities } from './native-capabilities';

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }));

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
