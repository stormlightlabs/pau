import { getContext, setContext } from 'svelte';

/**
 * The shell's workspace column, as the page header sees it. Below 1200px the
 * column leaves the grid and opens as an overlay from a toggle in the page
 * header. The shell owns the column's state, focus return and dismissal, and
 * shares this handle with the views it renders.
 */
export type WorkspaceColumn = {
	/** Whether the current view has a workspace column at all. */
	readonly available: boolean;
	/** Whether the column is an overlay, so the page header shows its toggle. */
	readonly overlay: boolean;
	/** Whether the column shows: docked beside the main surface, or open as the overlay. */
	readonly visible: boolean;
	/** The column's accessible name, which the toggle names too. */
	readonly label: string;
	/** Shows or hides the column. Opening the overlay remembers the focused control, and closing returns focus to it. */
	toggle: () => void;
};

const key = Symbol('workspace-column');

/** Shares the shell's workspace column with the views inside it. */
export function setWorkspaceColumn(column: WorkspaceColumn): void {
	setContext(key, column);
}

/** The workspace column of the shell around this component, if any. */
export function getWorkspaceColumn(): WorkspaceColumn | undefined {
	return getContext<WorkspaceColumn | undefined>(key);
}
