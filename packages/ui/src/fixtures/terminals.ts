import type { TerminalExit, TerminalSandboxChoice, TerminalSource, TerminalTab } from '../lib/types/terminal';

/** Options for the in-memory terminal used by stories and component tests. */
export type TerminalFixtureOptions = {
	/** Ends each new terminal with this status right after it connects. */
	exitOnConnect?: TerminalExit;
	/** Rejects terminal creation with this message. */
	createError?: string;
	/** Earlier output that each new terminal prints before its ready line. */
	history?: readonly string[];
	/** Terminals already running before a surface mounts, which it reattaches. */
	running?: number;
	/** Rejects listing the running terminals with this message. */
	listError?: string;
	/** The workspace's sandbox profile for new terminals. Without it, the source offers none. */
	sandbox?: TerminalSandboxChoice;
	/** Rejects sandboxed terminals with this message, as when the relay cannot start. */
	sandboxError?: string;
};

/** An in-memory terminal source and the input and sizes it received. */
export type TerminalFixture = {
	source: TerminalSource;
	sizes: Map<string, { cols: number; rows: number }>;
	input: Map<string, string>;
	/** Prints output to a connected terminal, as a program running in it would. */
	print: (id: string, text: string) => void;
};

const PROMPT = '\u{1B}[1;34m~/pau\u{1B}[0m $ ';

/**
 * Creates a line-echoing shell stand-in. Typed characters echo back, Enter
 * prints the line, a size change redraws the prompt, and `exit [code]` ends
 * the terminal with that code.
 * Terminals stay open until closed, so a surface rendered again with the same
 * fixture reattaches them, as after a route change.
 */
export function createTerminalFixture(options: TerminalFixtureOptions = {}): TerminalFixture {
	const sizes = new Map<string, { cols: number; rows: number }>();
	const input = new Map<string, string>();
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const open: TerminalTab[] = [];
	const printers = new Map<string, (text: string) => void>();
	const connected = new Set<string>();
	let created = 0;
	const sandbox = options.sandbox;
	const openTerminal = (profile?: TerminalTab['sandbox']): TerminalTab => {
		created += 1;
		const tab: TerminalTab = { id: `fixture-${created}`, title: created === 1 ? 'zsh' : `zsh ${created}` };
		if (profile) tab.sandbox = profile;
		open.push(tab);
		return tab;
	};
	for (let index = 0; index < (options.running ?? 0); index += 1) openTerminal();

	const source: TerminalSource = {
		list: async () => {
			if (options.listError) throw new Error(options.listError);
			return [...open];
		},
		create: async (request) => {
			if (options.createError) throw new Error(options.createError);
			if (!request?.sandboxed) return openTerminal();
			if (options.sandboxError) throw new Error(options.sandboxError);
			const profile = options.sandbox?.profile;
			if (!profile || options.sandbox?.unavailable) throw new Error('No sandbox profile is available.');
			return openTerminal(profile);
		},
		...(sandbox && { sandbox: async () => sandbox }),
		connect: (id, events) => {
			let line = '';
			let exited = false;
			// Like the desktop source, a connection holds the last size its view
			// reported and applies it each time its stream opens.
			let size: { cols: number; rows: number } | undefined;
			const send = (text: string) => events.output(encoder.encode(text));
			printers.set(id, send);
			const applySize = () => {
				if (!size) return;
				const previous = sizes.get(id);
				sizes.set(id, size);
				// A shell redraws its prompt when its window size changes.
				if (previous && (previous.cols !== size.cols || previous.rows !== size.rows)) send(`\r${PROMPT}${line}`);
			};
			const exit = (status: TerminalExit) => {
				exited = true;
				events.exit(status);
			};
			queueMicrotask(() => {
				// Like the server, every stream opens with the scrollback, empty or not.
				// The ready line prints once; a reattach finds it in the scrollback.
				const history = (options.history ?? []).map((output) => `${output}\r\n`).join('');
				const ready = `Terminal ready: 界 🙂\r\n${PROMPT}`;
				if (connected.has(id)) {
					events.replay(encoder.encode(history + ready));
				} else {
					connected.add(id);
					events.replay(encoder.encode(history));
					send(ready);
				}
				applySize();
				if (options.exitOnConnect) exit(options.exitOnConnect);
			});
			return {
				write: (bytes) => {
					if (exited) return;
					const text = decoder.decode(bytes);
					input.set(id, (input.get(id) ?? '') + text);
					for (const character of text) {
						if (character === '\r') {
							const command = line.trim();
							line = '';
							const code = /^exit(?:\s+(\d+))?$/.exec(command);
							if (code) {
								send('\r\n');
								exit({ exitCode: Number(code[1] ?? 0), signal: null });
								return;
							}
							send(command ? `\r\n${command}\r\n${PROMPT}` : `\r\n${PROMPT}`);
						} else if (character === '\u{7F}') {
							if (line) send('\b \b');
							line = line.slice(0, -1);
						} else if (character >= ' ') {
							line += character;
							send(character);
						}
					}
				},
				resize: (cols, rows) => {
					size = { cols, rows };
					applySize();
				},
				close: () => {}
			};
		},
		close: async (id) => {
			open.splice(
				open.findIndex((tab) => tab.id === id),
				1
			);
		}
	};
	return { source, sizes, input, print: (id, text) => printers.get(id)?.(text) };
}
