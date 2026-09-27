import { getCurrentWindow } from '@tauri-apps/api/window';

/** Desktop window operations that shared feature views may request from their app owner. */
export interface DesktopWindowCapability {
	close(): Promise<void>;
}

/** Native services supplied by the desktop application rather than shared UI code. */
export type DesktopNativeCapabilities = { window?: DesktopWindowCapability };

/** Context key used when desktop routes supply native services to a feature view. */
export const desktopNativeCapabilitiesContext = Symbol('pau.desktop.native-capabilities');

type DesktopHost = { __TAURI_INTERNALS__?: unknown };

/** Reports only capabilities implemented by the current desktop host. */
export function createDesktopNativeCapabilities(
	host: DesktopHost = globalThis as unknown as DesktopHost
): DesktopNativeCapabilities {
	if (!('__TAURI_INTERNALS__' in host)) return {};

	return { window: { close: async () => getCurrentWindow().close() } };
}
