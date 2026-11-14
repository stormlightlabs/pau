/** One action in a context menu. */
export type ContextMenuItem = {
	id: string;
	label: string;
	/** Shows the action but refuses it. Pair it with `reason`. */
	disabled?: boolean;
	/** Why the action is disabled, shown under its label and read as its description. */
	reason?: string;
	/** Draws a rule above the item to start a new group. */
	separatorBefore?: boolean;
};

/** An open context menu: its items, where it opens, and who receives the choice. */
export type ContextMenuRequest = {
	/** Accessible name of the menu, such as the item it acts on. */
	label: string;
	items: ContextMenuItem[];
	/** Viewport coordinates of the menu's top-left corner before it is kept on screen. */
	x: number;
	y: number;
	/**
	 * Whether the keyboard opened the menu. It skips the entry animation, and
	 * the menu moves to the invoker once a pane around it stops sliding.
	 */
	keyboard: boolean;
	/** The element that opened the menu. Focus returns to it when the menu closes. */
	invoker: HTMLElement;
	/** Runs the chosen enabled item after the menu closes. */
	onSelect: (id: string) => void;
};

/** Whether a key press asks for the focused item's context menu: Shift+F10 or the menu key. */
export function isContextMenuKey(event: KeyboardEvent): boolean {
	return event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
}

/**
 * Builds a menu request from a `contextmenu` event or a menu key press handled
 * by the element that owns the menu, and stops the browser's own menu. A
 * pointer opens the menu at the pointer. The keyboard, including a
 * `contextmenu` event that the menu key raises without a pointer position,
 * opens it below the focused element.
 */
export function contextMenuRequest(
	event: MouseEvent | KeyboardEvent,
	label: string,
	items: ContextMenuItem[],
	onSelect: (id: string) => void
): ContextMenuRequest {
	event.preventDefault();
	event.stopPropagation();
	// The owner may be a row around the control that has focus, so focus
	// returns to the nearest focusable element inside it.
	const owner = event.currentTarget as HTMLElement;
	const focusable = (event.target as HTMLElement).closest?.<HTMLElement>('button, a[href], input, [tabindex]');
	const invoker = focusable && owner.contains(focusable) ? focusable : owner;
	const pointer = event instanceof MouseEvent && (event.clientX !== 0 || event.clientY !== 0);
	if (pointer) return { label, items, x: event.clientX, y: event.clientY, keyboard: false, invoker, onSelect };
	return { label, items, ...keyboardAnchor(invoker), keyboard: true, invoker, onSelect };
}

/** Where a keyboard-opened menu starts: just inside the element's left edge, below it. */
export function keyboardAnchor(element: Element): { x: number; y: number } {
	const bounds = element.getBoundingClientRect();
	return { x: bounds.left + 8, y: bounds.bottom };
}

/** Names the action that shows a path in the system file manager. */
export function revealLabel(userAgent = globalThis.navigator?.userAgent ?? ''): string {
	return /Mac/.test(userAgent) ? 'Reveal in Finder' : 'Show in folder';
}
