import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';

/** Desktop window operations that shared feature views may request from their app owner. */
export interface DesktopWindowCapability {
	close(): Promise<void>;
}

/**
 * Native services supplied by the desktop application rather than shared UI code.
 *
 * `pickFolder` shows the system folder picker and resolves to the chosen path,
 * or `undefined` when the operator cancels. `revealPath` selects a file or
 * folder in the system file manager. `openLink` opens an http, https, or
 * mailto URL in the operator's default browser or mail app. `setZoom` scales the whole page, where 1
 * is actual size. `onMenuAction` calls the listener with the key map action ID
 * of each app menu item the operator chooses, and returns a function that
 * stops listening.
 *
 * `notify` shows a system notification. The first call that finds no
 * permission asks the operator for it, and a refused request drops the
 * notification. `setBadgeCount` shows a count on the app icon, or removes
 * the badge when the count is `undefined`. `onWindowFocusChange` calls the
 * listener with the window's current focus, then again whenever it changes,
 * and returns a function that stops listening.
 */
export type DesktopNativeCapabilities = {
	window?: DesktopWindowCapability;
	pickFolder?: () => Promise<string | undefined>;
	revealPath?: (path: string) => Promise<void>;
	openLink?: (url: string) => Promise<void>;
	setZoom?: (factor: number) => Promise<void>;
	onMenuAction?: (listener: (actionId: string) => void) => () => void;
	notify?: (notification: { title: string; body: string }) => Promise<void>;
	setBadgeCount?: (count: number | undefined) => Promise<void>;
	onWindowFocusChange?: (listener: (focused: boolean) => void) => () => void;
};

/** The event the desktop shell emits when the operator chooses an app menu item. */
export const MENU_ACTION_EVENT = 'pau://menu-action';

/** Context key used when desktop routes supply native services to a feature view. */
export const desktopNativeCapabilitiesContext = Symbol('pau.desktop.native-capabilities');

/** Whether the system lets Pau notify, asking the operator when it has no answer yet. */
async function notificationsPermitted(): Promise<boolean> {
	return (await isPermissionGranted()) || (await requestPermission()) === 'granted';
}

type DesktopHost = { __TAURI_INTERNALS__?: unknown };

/** Reports only capabilities implemented by the current desktop host. */
export function createDesktopNativeCapabilities(
	host: DesktopHost = globalThis as unknown as DesktopHost
): DesktopNativeCapabilities {
	if (!('__TAURI_INTERNALS__' in host)) return {};
	// Asks once per launch. The system remembers the answer.
	let permission: Promise<boolean> | undefined;

	return {
		window: { close: async () => getCurrentWindow().close() },
		pickFolder: async () => (await open({ directory: true, multiple: false, title: 'Open workspace' })) ?? undefined,
		revealPath: (path) => revealItemInDir(path),
		openLink: (url) => openUrl(url),
		setZoom: (factor) => getCurrentWebview().setZoom(factor),
		onMenuAction: (listener) => {
			const subscription = listen<string>(MENU_ACTION_EVENT, (event) => listener(event.payload));
			return () => void subscription.then((unlisten) => unlisten());
		},
		notify: async (notification) => {
			permission ??= notificationsPermitted();
			if (await permission) sendNotification(notification);
		},
		setBadgeCount: (count) => getCurrentWindow().setBadgeCount(count),
		onWindowFocusChange: (listener) => {
			const window = getCurrentWindow();
			void window.isFocused().then(listener);
			const subscription = window.onFocusChanged((event) => listener(event.payload));
			return () => void subscription.then((unlisten) => unlisten());
		}
	};
}
