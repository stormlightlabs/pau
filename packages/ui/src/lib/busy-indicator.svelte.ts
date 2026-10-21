import { untrack } from 'svelte';

import { busyIndicatorTiming } from '../motion';

/**
 * Times a loading indicator so that fast waits never flash one. The indicator
 * appears once a wait has lasted `busyIndicatorTiming.delay`, and once shown it
 * stays for `busyIndicatorTiming.minimumVisible` even if the wait ends sooner.
 *
 * Create it while a component initializes. It follows `busy` with an effect and
 * clears its timer when the component is destroyed. Render a `role="status"`
 * indicator only while `visible` is true, so screen readers hear it only when
 * sighted operators see it.
 */
export class BusyIndicator {
	readonly #busy: () => boolean;
	#visible = $state(false);
	/** Whether the shown indicator has not yet reached its minimum display. */
	#holding = false;
	/** The pending show timer before the indicator appears, or the hold timer after. */
	#timer: ReturnType<typeof setTimeout> | undefined;
	/** Callers of `hidden()` waiting for a shown indicator to go away. */
	#waiters: (() => void)[] = [];

	constructor(busy: () => boolean) {
		this.#busy = busy;
		$effect(() => {
			const waiting = busy();
			untrack(() => this.#follow(waiting));
		});
		$effect(() => () => {
			clearTimeout(this.#timer);
			this.#hide();
		});
	}

	#follow(waiting: boolean): void {
		if (waiting) {
			if (this.#visible || this.#timer !== undefined) return;
			this.#timer = setTimeout(() => this.#show(), busyIndicatorTiming.delay);
		} else if (!this.#visible) {
			clearTimeout(this.#timer);
			this.#timer = undefined;
		} else if (!this.#holding) {
			this.#hide();
		}
	}

	#show(): void {
		this.#visible = true;
		this.#holding = true;
		this.#timer = setTimeout(() => {
			this.#holding = false;
			this.#timer = undefined;
			if (!this.#busy()) this.#hide();
		}, busyIndicatorTiming.minimumVisible);
	}

	#hide(): void {
		this.#visible = false;
		for (const resolve of this.#waiters.splice(0)) resolve();
	}

	/** Whether to render the indicator. */
	get visible(): boolean {
		return this.#visible;
	}

	/**
	 * Whether the wait is still underway for the view: the wait runs, or its
	 * indicator is still within its minimum display. Content that replaces the
	 * indicator waits for this to clear.
	 */
	get active(): boolean {
		return this.#busy() || this.#visible;
	}

	/**
	 * Resolves once no indicator shows, at once when none does. Call it after
	 * the wait ends, before rendering content that needs its element mounted,
	 * such as an editor that replaces the indicator.
	 */
	hidden(): Promise<void> {
		if (!this.#visible) return Promise.resolve();
		return new Promise((resolve) => {
			this.#waiters.push(resolve);
		});
	}
}
