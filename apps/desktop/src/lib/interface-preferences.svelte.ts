import type { LastRoute, MotionPreference, UiPreferences } from '@stormlightlabs/pau-protocol';
import type { ShellPaneWidths } from '@stormlightlabs/pau-ui';

import { getUiPreferences, updateUiPreferences } from './api';
import { EventStreamClient, type EventSocketFactory } from './event-stream';

/** Time after the last resize before the widths are saved. */
const SAVE_DELAY_MS = 400;

/** Local copy of the motion setting, read by the inline script in `app.html` before first paint. */
export const MOTION_CACHE_KEY = 'pau.motion';

export type InterfacePreferencesOptions = {
	root?: HTMLElement;
	browserOrigin?: string;
	saveDelayMs?: number;
	fetcher?: typeof fetch;
	socketFactory?: EventSocketFactory;
};

/**
 * Keeps the pane widths and the motion setting in step with the saved
 * interface preferences.
 *
 * The shell reports each resize through {@link InterfacePreferences.resize}. The
 * widths apply at once and save once the operator stops resizing. A
 * `preferences_changed` event from another window reloads them, except while
 * a local change is waiting to save, so a stale echo never undoes a resize.
 *
 * The motion setting sets `data-motion` on the root element, which the UI
 * tokens and transitions read. `system` removes the attribute so the OS
 * reduced-motion query decides. Every save writes the whole document built
 * from the latest loaded copy, so a motion change keeps the saved widths and
 * a resize keeps the motion setting.
 *
 * The view the operator has open is saved too, through
 * {@link InterfacePreferences.rememberRoute}, so the next launch can return
 * to it.
 */
export class InterfacePreferences {
	#saved: UiPreferences | undefined;
	/** The view this window last opened. Unset until it opens one, so a save keeps the stored view. */
	#route: LastRoute | undefined;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#saving: Promise<void> | undefined;
	#stream: EventStreamClient | undefined;
	readonly #options: InterfacePreferencesOptions;

	/** The motion setting. Change it through {@link InterfacePreferences.setMotion}. */
	motion = $state<MotionPreference>('system');

	/** Widths to hand to the shell. `null` keeps a pane at its default width. */
	widths = $state<ShellPaneWidths>({ contextRail: null, inspector: null });

	constructor(options: InterfacePreferencesOptions = {}) {
		this.#options = options;
	}

	async #flush(): Promise<void> {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		await this.#saving;
		this.#saving = this.#write();
		await this.#saving;
		this.#saving = undefined;
	}

	/** Saves the current widths. A failure leaves them applied; the next resize saves again. */
	async #write(): Promise<void> {
		try {
			const base = this.#saved ?? (await getUiPreferences(this.#options.fetcher));
			const { contextRail, inspector } = this.widths;
			this.#saved = await updateUiPreferences(
				{
					...base,
					motion: this.motion,
					pane_widths: { context_rail: contextRail, inspector },
					last_route: this.#route ?? base.last_route
				},
				this.#options.fetcher
			);
		} catch {
			// Nothing to roll back: the widths stay applied in this window.
		}
	}

	/** Sets the root attribute and the local copy that the next launch reads before first paint. */
	#applyMotion(motion: MotionPreference): void {
		this.motion = motion;
		const root = this.#options.root ?? document.documentElement;
		if (motion === 'system') delete root.dataset.motion;
		else root.dataset.motion = motion;
		try {
			localStorage.setItem(MOTION_CACHE_KEY, motion);
		} catch {
			// Without storage the first paint follows the OS until preferences load.
		}
	}

	/** Loads the saved widths and follows changes made elsewhere. */
	connect(): void {
		void this.load();
		this.#stream = new EventStreamClient({
			browserOrigin: this.#options.browserOrigin ?? location.origin,
			socketFactory: this.#options.socketFactory,
			onState: (_state, event) => {
				if (event?.kind === 'preferences_changed') void this.load();
			},
			onConnectionChange: (connected) => {
				if (connected) void this.load();
			}
		});
		this.#stream.connect();
	}

	/** Stops following changes and writes any width still waiting to save. */
	stop(): void {
		this.#stream?.stop();
		this.#stream = undefined;
		if (this.#timer !== undefined) void this.#flush();
	}

	/** Reads the saved preferences. Failing to read leaves the default widths. */
	async load(): Promise<void> {
		let preferences: UiPreferences;
		try {
			preferences = await getUiPreferences(this.#options.fetcher);
		} catch {
			return;
		}
		this.#saved = preferences;
		if (this.#saving === undefined) this.#applyMotion(preferences.motion);
		if (this.#timer !== undefined || this.#saving !== undefined) return;
		this.widths = { contextRail: preferences.pane_widths.context_rail, inspector: preferences.pane_widths.inspector };
	}

	/** Applies a motion setting the operator chose and saves it at once. */
	setMotion(motion: MotionPreference): void {
		this.#applyMotion(motion);
		void this.#flush();
	}

	/** Saves the view the operator opened, unless it is already the saved one. */
	rememberRoute(route: LastRoute): void {
		const current = this.#route ?? this.#saved?.last_route;
		if (current && sameRoute(current, route)) return;
		this.#route = route;
		void this.#flush();
	}

	/** Applies widths the operator chose and schedules saving them. */
	resize(widths: ShellPaneWidths): void {
		this.widths = widths;
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.#flush(), this.#options.saveDelayMs ?? SAVE_DELAY_MS);
	}
}

function sameRoute(left: LastRoute, right: LastRoute): boolean {
	return (
		left.workspace_id === right.workspace_id &&
		left.view === right.view &&
		left.session_id === right.session_id &&
		left.saved_session_id === right.saved_session_id
	);
}

/** The pane widths shared by every route in this window. */
export const interfacePreferences = new InterfacePreferences();
