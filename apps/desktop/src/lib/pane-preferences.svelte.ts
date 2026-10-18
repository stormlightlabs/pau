import type { UiPreferences } from '@stormlightlabs/pau-protocol';
import type { ShellPaneWidths } from '@stormlightlabs/pau-ui';

import { getUiPreferences, updateUiPreferences } from './api';
import { EventStreamClient, type EventSocketFactory } from './event-stream';

/** Time after the last resize before the widths are saved. */
const SAVE_DELAY_MS = 400;

export type PanePreferencesOptions = {
	browserOrigin?: string;
	saveDelayMs?: number;
	fetcher?: typeof fetch;
	socketFactory?: EventSocketFactory;
};

/**
 * Keeps the resizable pane widths in step with the saved interface
 * preferences.
 *
 * The shell reports each resize through {@link PanePreferences.resize}. The
 * widths apply at once and save once the operator stops resizing. A
 * `preferences_changed` event from another window reloads them, except while
 * a local change is waiting to save, so a stale echo never undoes a resize.
 */
export class PanePreferences {
	#saved: UiPreferences | undefined;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#saving: Promise<void> | undefined;
	#stream: EventStreamClient | undefined;
	readonly #options: PanePreferencesOptions;

	/** Widths to hand to the shell. `null` keeps a pane at its default width. */
	widths = $state<ShellPaneWidths>({ contextRail: null, inspector: null });

	constructor(options: PanePreferencesOptions = {}) {
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
				{ ...base, pane_widths: { context_rail: contextRail, inspector } },
				this.#options.fetcher
			);
		} catch {
			// Nothing to roll back: the widths stay applied in this window.
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
		if (this.#timer !== undefined || this.#saving !== undefined) return;
		this.widths = { contextRail: preferences.pane_widths.context_rail, inspector: preferences.pane_widths.inspector };
	}

	/** Applies widths the operator chose and schedules saving them. */
	resize(widths: ShellPaneWidths): void {
		this.widths = widths;
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.#flush(), this.#options.saveDelayMs ?? SAVE_DELAY_MS);
	}
}

/** The pane widths shared by every route in this window. */
export const panePreferences = new PanePreferences();
