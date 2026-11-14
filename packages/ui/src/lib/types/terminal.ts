/** How a terminal process ended. A process ended by a signal names it. */
export type TerminalExit = { exitCode: number; signal: string | null };

/** One terminal opened by the application in the current workspace. */
export type TerminalTab = { id: string; title: string };

/** Callbacks that a terminal connection uses to report its byte stream and lifecycle. */
export type TerminalConnectionEvents = {
	/**
	 * Receives the terminal's scrollback, which each stream sends once before
	 * any live output. Old queries in it, such as a device attributes request,
	 * must not be answered to the running program.
	 */
	replay: (bytes: Uint8Array) => void;
	/** Receives raw PTY output bytes in arrival order. */
	output: (bytes: Uint8Array) => void;
	/**
	 * Clears the screen and scrollback before the connection replays the
	 * terminal's output again, as it does after reconnecting.
	 */
	reset: () => void;
	/** Reports the final status after the process exits. No output follows. */
	exit: (status: TerminalExit) => void;
	/** Reports a stream that closed before the process exit was known. */
	disconnect: () => void;
};

/**
 * A live connection to one terminal. The application owns the transport;
 * implementations must keep the most recent size and apply it once the
 * transport opens.
 */
export type TerminalConnection = {
	write: (bytes: Uint8Array<ArrayBuffer>) => void;
	resize: (cols: number, rows: number) => void;
	close: () => void;
};

/** Terminal operations supplied to the terminal surface by the application. */
export type TerminalSource = {
	/** Lists the terminals still open from an earlier view, oldest first. */
	list: () => Promise<TerminalTab[]>;
	create: () => Promise<TerminalTab>;
	connect: (id: string, events: TerminalConnectionEvents) => TerminalConnection;
	close: (id: string) => Promise<void>;
};

/**
 * Lets a terminal turn workspace file paths in its output into links. The
 * application owns the workspace, so it answers whether a path is a file and
 * decides where opening one goes.
 */
export type TerminalFileLinks = {
	/** Resolves whether `path`, relative to the workspace root, names a file. */
	exists: (path: string) => Promise<boolean>;
	/** Opens a workspace file, at `line` when the output named one. */
	open: (path: string, line?: number) => void;
};
