import { getContext, setContext, type Snippet } from 'svelte';

const key = Symbol('shell-status-bar');

/**
 * Gives every shell below the caller the same status bar, which spans the
 * foot of the window in every view. Call it during component
 * initialization.
 */
export function setShellStatusBar(statusBar: Snippet): void {
	setContext(key, statusBar);
}

/** The status bar an ancestor shares with every shell, if any. */
export function getShellStatusBar(): Snippet | undefined {
	return getContext<Snippet | undefined>(key);
}
