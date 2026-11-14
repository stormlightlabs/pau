/**
 * Where the operator keeps terminals while working in a session. The state
 * lives for the window, so the dock stays open or closed, and at its height,
 * as the operator moves between views. It is not saved across launches.
 */
class TerminalDock {
	/** Whether the dock shows under the session. */
	open = $state(false);
	/** Operator-chosen height in CSS pixels, `null` for the default. */
	height = $state<number | null>(null);
	/**
	 * The session last shown, so moving terminals from the main area to the
	 * dock returns to it instead of the first session.
	 */
	session = $state<{ workspaceId: string; sessionId: string }>();
}

export const terminalDock = new TerminalDock();
