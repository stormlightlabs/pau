import type { Attachment } from 'svelte/attachments';

/** What an overlay does when the operator dismisses it. */
export type Dismissal = {
	/** Closes the overlay without moving focus. */
	close: () => void;
	/** Returns focus to the overlay's trigger, or to the composer when the trigger is gone. */
	restoreFocus: () => void;
};

/**
 * Closes a dropdown, list, details panel, or menu the same way everywhere: a
 * pointer press outside it, Escape, or the window losing focus. Attach it to
 * the element that holds both the trigger and the overlay, and only while the
 * overlay is open, as in `{@attach open && dismissible(...)}`.
 *
 * Presses are watched in the capture phase, so the overlay closes before the
 * pressed control reacts. A press on another overlay's trigger closes this
 * overlay and opens that one in the same press. A press on the trigger itself
 * is inside, so the trigger's own click decides whether to close.
 *
 * Escape is also caught in the capture phase and stopped there, so it closes
 * only the overlay and never reaches the composer or an overlay rail.
 *
 * The browser `popover="auto"` light dismiss is not used. It closes on the
 * press that lands on the trigger, so the trigger's click reopens the
 * overlay, and it handles neither window blur nor focus return for overlays
 * opened without `popovertarget`.
 */
export function dismissible({ close, restoreFocus }: Dismissal): Attachment<HTMLElement> {
	function dismiss(): void {
		close();
		restoreFocus();
	}

	return (bounds) => {
		function handlePointerdown(event: PointerEvent): void {
			if (event.target instanceof Node && bounds.contains(event.target)) return;
			close();
			// The press focuses the control it lands on after this handler runs.
			// Focus returns to the trigger only when the press left it on the
			// page body. The timer outlives this attachment, which closing removes.
			setTimeout(() => {
				const active = document.activeElement;
				if (!active || active === document.body) restoreFocus();
			}, 0);
		}

		function handleKeydown(event: KeyboardEvent): void {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			dismiss();
		}

		addEventListener('pointerdown', handlePointerdown, true);
		addEventListener('keydown', handleKeydown, true);
		addEventListener('blur', dismiss);
		return () => {
			removeEventListener('pointerdown', handlePointerdown, true);
			removeEventListener('keydown', handleKeydown, true);
			removeEventListener('blur', dismiss);
		};
	};
}
