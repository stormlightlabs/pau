import { getContext, setContext, type Snippet } from 'svelte';

const key = Symbol('shell-bay');

/**
 * Gives every shell below the caller the same bay, so the sessions stay in
 * view on Files, Settings and the other views, not only on Sessions. A
 * shell's own `bay` prop wins. Call it during component initialization.
 */
export function setShellBay(bay: Snippet): void {
	setContext(key, bay);
}

/** The bay an ancestor shares with every shell, if any. */
export function getShellBay(): Snippet | undefined {
	return getContext<Snippet | undefined>(key);
}
