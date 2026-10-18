/** Marks the prompt field that overlays fall back to when their opener is gone. */
export const COMPOSER_ATTRIBUTE = 'data-pau-composer';

const COMPOSER_SELECTOR = `[${COMPOSER_ATTRIBUTE}]`;

/**
 * Focuses `invoker` when it is still in the document and focusable, and the
 * composer otherwise, including when nothing but the page body had focus. Call it after an overlay closes so the keyboard
 * operator lands where they started instead of on the page body.
 */
export function returnFocus(invoker: Element | null | undefined): void {
	if (
		invoker instanceof HTMLElement &&
		invoker !== document.body &&
		invoker.isConnected &&
		!invoker.matches(':disabled')
	) {
		invoker.focus();
		if (document.activeElement === invoker) return;
	}
	document.querySelector<HTMLElement>(COMPOSER_SELECTOR)?.focus();
}

/** Remembers the element that opened an overlay and returns focus to it on close. */
export type FocusReturn = {
	/** Records the focused element, or `invoker` when the opener is not the focused one. Call it before the overlay moves focus. */
	capture: (invoker?: Element | null) => void;
	/** Returns focus to the recorded element, or the composer when it is gone. A no-op when nothing was captured. */
	restore: () => void;
};

/**
 * Creates the capture and restore pair that dialogs, popovers, and overlay
 * rails share.
 */
export function createFocusReturn(): FocusReturn {
	let invoker: Element | null | undefined;
	let captured = false;
	return {
		capture(element = document.activeElement) {
			invoker = element;
			captured = true;
		},
		restore() {
			if (!captured) return;
			captured = false;
			const target = invoker;
			invoker = undefined;
			returnFocus(target);
		}
	};
}
