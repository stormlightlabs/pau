import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';

/** Desktop window operations that shared feature views may request from their app owner. */
export interface DesktopWindowCapability {
	close(): Promise<void>;
}

/**
 * Native services supplied by the desktop application rather than shared UI code.
 *
 * `pickFolder` shows the system folder picker and resolves to the chosen path,
 * or `undefined` when the operator cancels. `setZoom` scales the whole page,
 * where 1 is actual size. `onMenuAction` calls the listener with the key map
 * action ID of each app menu item the operator chooses, and returns a function
 * that stops listening.
 */
export type DesktopNativeCapabilities = {
	window?: DesktopWindowCapability;
	pickFolder?: () => Promise<string | undefined>;
	setZoom?: (factor: number) => Promise<void>;
	onMenuAction?: (listener: (actionId: string) => void) => () => void;
};

/** The event the desktop shell emits when the operator chooses an app menu item. */
export const MENU_ACTION_EVENT = 'pau://menu-action';

/** Context key used when desktop routes supply native services to a feature view. */
export const desktopNativeCapabilitiesContext = Symbol('pau.desktop.native-capabilities');

type DesktopHost = { __TAURI_INTERNALS__?: unknown };

/** Reports only capabilities implemented by the current desktop host. */
export function createDesktopNativeCapabilities(
	host: DesktopHost = globalThis as unknown as DesktopHost
): DesktopNativeCapabilities {
	if (!('__TAURI_INTERNALS__' in host)) return {};

	return {
		window: { close: async () => getCurrentWindow().close() },
		pickFolder: async () => (await open({ directory: true, multiple: false, title: 'Open workspace' })) ?? undefined,
		setZoom: (factor) => getCurrentWebview().setZoom(factor),
		onMenuAction: (listener) => {
			const subscription = listen<string>(MENU_ACTION_EVENT, (event) => listener(event.payload));
			return () => void subscription.then((unlisten) => unlisten());
		}
	};
}
