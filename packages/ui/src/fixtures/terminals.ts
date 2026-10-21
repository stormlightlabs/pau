import type { TerminalExit, TerminalSource } from '../lib/types/terminal';

/** Options for the in-memory terminal used by stories and component tests. */
export type TerminalFixtureOptions = {
	/** Ends each new terminal with this status right after it connects. */
	exitOnConnect?: TerminalExit;
	/** Rejects terminal creation with this message. */
	createError?: string;
	/** Earlier output that each new terminal prints before its ready line. */
	history?: readonly string[];
};

/** An in-memory terminal source and the input and sizes it received. */
export type TerminalFixture = {
	source: TerminalSource;
	sizes: Map<string, { cols: number; rows: number }>;
	input: Map<string, string>;
};

const PROMPT = '\u{1B}[1;34m~/pau\u{1B}[0m $ ';

/**
 * Creates a line-echoing shell stand-in. Typed characters echo back, Enter
 * prints the line, and `exit [code]` ends the terminal with that code.
 */
export function createTerminalFixture(options: TerminalFixtureOptions = {}): TerminalFixture {
	const sizes = new Map<string, { cols: number; rows: number }>();
	const input = new Map<string, string>();
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	let created = 0;

	const source: TerminalSource = {
		create: async () => {
			if (options.createError) throw new Error(options.createError);
			created += 1;
			const id = `fixture-${created}`;
			return { id, title: created === 1 ? 'zsh' : `zsh ${created}` };
		},
		connect: (id, events) => {
			let line = '';
			let exited = false;
			const send = (text: string) => events.output(encoder.encode(text));
			const exit = (status: TerminalExit) => {
				exited = true;
				events.exit(status);
			};
			queueMicrotask(() => {
				const history = options.history ?? [];
				for (const output of history) send(`${output}\r\n`);
				send(`Terminal ready: 界 🙂\r\n${PROMPT}`);
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
				resize: (cols, rows) => sizes.set(id, { cols, rows }),
				close: () => {}
			};
		},
		close: async () => {}
	};
	return { source, sizes, input };
}
