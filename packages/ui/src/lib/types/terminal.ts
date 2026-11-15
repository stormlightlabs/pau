import type { SandboxProfile } from './sandbox';

/** How a terminal process ended. A process ended by a signal names it. */
export type TerminalExit = { exitCode: number; signal: string | null };

/** One terminal opened by the application in the current workspace. */
export type TerminalTab = {
	id: string;
	title: string;
	/** Sandbox profile the shell runs under. Absent when it runs with normal access. */
	sandbox?: SandboxProfile;
};

/**
 * Whether new terminals can open in the workspace's sandbox profile, the one
 * its new sessions use.
 */
export type TerminalSandboxChoice = {
	/** The workspace's profile, or `null` when the workspace has none. */
	profile: SandboxProfile | null;
	/** Why a sandboxed terminal cannot start on this host, when it cannot. */
	unavailable: string | null;
};

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
	/** Opens a terminal, under the workspace's sandbox profile when `sandboxed` is set. */
	create: (options?: { sandboxed?: boolean }) => Promise<TerminalTab>;
	/** Reports the sandbox profile for new terminals. Without it, the panel offers no sandboxed terminal. */
	sandbox?: () => Promise<TerminalSandboxChoice>;
	/**
	 * Calls `listener` whenever the workspace's sandbox selection may have
	 * changed, so the panel reads `sandbox` again. Returns a function that stops
	 * the calls.
	 */
	watchSandbox?: (listener: () => void) => () => void;
	connect: (id: string, events: TerminalConnectionEvents) => TerminalConnection;
	close: (id: string) => Promise<void>;
};

/**
 * Lets a terminal turn workspace file paths in its output into links. The
 * application owns the workspace, so it answers whether a path is a file and
 * decides where opening one goes.
 */
export type TerminalFileLinks = {
	/**
	 * Lists the paths of the regular files directly inside `directory`, both
	 * relative to the workspace root. The root is `''`.
	 */
	files: (directory: string) => Promise<readonly string[]>;
	/** Opens a workspace file, at `line` when the output named one. */
	open: (path: string, line?: number) => void;
};
