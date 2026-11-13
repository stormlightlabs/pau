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
	/** The last write queued. Each write starts once this one settles, so writes reach the server in order. */
	#saving: Promise<unknown> = Promise.resolve();
	/** Writes queued or in flight. While any remain, a loaded copy does not replace local changes. */
	#pending = 0;
	#stream: EventStreamClient | undefined;
	readonly #options: InterfacePreferencesOptions;

	/** The motion setting. Change it through {@link InterfacePreferences.setMotion}. */
	motion = $state<MotionPreference>('system');

	/** Widths to hand to the shell. `null` keeps a pane at its default width. */
	widths = $state<ShellPaneWidths>({ contextRail: null, inspector: null });

	constructor(options: InterfacePreferencesOptions = {}) {
		this.#options = options;
	}

	/**
	 * Queues a write of the current preferences behind every write already
	 * queued, and rejects when this write fails.
	 *
	 * Each write reads the preferences when it starts, so a later write
	 * carries every change made before it. A failed write therefore restores
	 * the saved motion setting only when no later write is queued and the
	 * screen still shows the setting it sent. Otherwise the later write
	 * decides what is saved, and restoring here would leave the screen
	 * disagreeing with the stored value. `fallback` is used when no saved
	 * copy has loaded.
	 */
	async #flush(fallback?: MotionPreference): Promise<void> {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		this.#pending += 1;
		const previous = this.#saving;
		const write = (async () => {
			await previous;
			return this.#write();
		})();
		this.#saving = write;
		const { sent, failure } = await write;
		this.#pending -= 1;
		if (!failure) return;
		const restore = this.#saved?.motion ?? fallback;
		if (restore && this.#pending === 0 && this.motion === sent) this.#applyMotion(restore);
		throw failure;
	}

	/**
	 * Saves widths and the open view. A failure leaves them applied in this
	 * window, and the next resize or view change saves again. A motion
	 * setting this write failed to save is restored as {@link #flush} says.
	 */
	async #save(): Promise<void> {
		try {
			await this.#flush();
		} catch {
			// Nothing to roll back.
		}
	}

	/**
	 * Saves the whole document and resolves with the motion setting it sent
	 * and any failure instead of rejecting, so a write that waits on this one
	 * is not failed by it.
	 */
	async #write(): Promise<{ sent: MotionPreference; failure?: Error }> {
		const sent = this.motion;
		try {
			const base = this.#saved ?? (await getUiPreferences(this.#options.fetcher));
			const { contextRail, inspector } = this.widths;
			this.#saved = await updateUiPreferences(
				{
					...base,
					motion: sent,
					pane_widths: { context_rail: contextRail, inspector },
					last_route: this.#route ?? base.last_route
				},
				this.#options.fetcher
			);
			return { sent };
		} catch (error) {
			return { sent, failure: error instanceof Error ? error : new Error(String(error)) };
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
		if (this.#timer !== undefined) void this.#save();
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
		if (this.#pending === 0) this.#applyMotion(preferences.motion);
		if (this.#timer !== undefined || this.#pending > 0) return;
		this.widths = { contextRail: preferences.pane_widths.context_rail, inspector: preferences.pane_widths.inspector };
	}

	/**
	 * Applies a motion setting the operator chose and saves it at once. When
	 * the save fails, the saved setting comes back and the promise rejects
	 * with the reason, so Settings can show it. A failure that a later choice
	 * has already replaced changes nothing, as {@link #flush} explains.
	 */
	async setMotion(motion: MotionPreference): Promise<void> {
		const previous = this.motion;
		this.#applyMotion(motion);
		await this.#flush(previous);
	}

	/** Saves the view the operator opened, unless it is already the saved one. */
	rememberRoute(route: LastRoute): void {
		const current = this.#route ?? this.#saved?.last_route;
		if (current && sameRoute(current, route)) return;
		this.#route = route;
		void this.#save();
	}

	/** Applies widths the operator chose and schedules saving them. */
	resize(widths: ShellPaneWidths): void {
		this.widths = widths;
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.#save(), this.#options.saveDelayMs ?? SAVE_DELAY_MS);
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
