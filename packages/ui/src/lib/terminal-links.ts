import type { IBufferLine, ILink, ILinkProvider, Terminal } from '@xterm/xterm';

import type { TerminalFileLinks } from './types/terminal';

/** A possible workspace file reference in one line of terminal output. */
export type TerminalPathMatch = {
	/** Slash-separated path relative to the workspace root. */
	path: string;
	line?: number;
	column?: number;
	/** UTF-16 offset of the first character of the match in the line. */
	start: number;
	/** UTF-16 offset just past the match, including any `:line:column` suffix. */
	end: number;
};

/** Runs of characters that can hold a path. Quotes, brackets and separators end a run. */
const TOKEN = /[^\s'"`()[\]{}<>,;|]+/g;

/**
 * A relative path whose last segment has an extension starting with a letter,
 * with an optional `:line` or `:line:column` suffix. A segment may start with
 * one dot, as `.github` does, or with `@`, as a scoped package does, but never
 * with `..`. Absolute paths, home and variable prefixes, URLs and version
 * numbers such as `1.2.3` do not match.
 */
const PATH = /^(?:\.\/)?((?:[.@]?[\w+-][\w.+-]*\/)*[.@]?[\w+-][\w.+-]*\.[A-Za-z][A-Za-z0-9]*)(?::(\d+)(?::(\d+))?)?$/;

/**
 * Finds text in one line of terminal output that may name a workspace file.
 *
 * Detection is deliberately narrow: the caller must still confirm that each
 * path is a file in the workspace before showing it as a link. Text that
 * looks like a web address is left to the URL detector.
 */
export function findTerminalPaths(text: string): TerminalPathMatch[] {
	const matches: TerminalPathMatch[] = [];
	for (const token of text.matchAll(TOKEN)) {
		// Sentence punctuation and a dangling suffix colon follow paths in prose and logs.
		const value = token[0].replace(/[.:]+$/, '');
		if (value.startsWith('www.')) continue;
		const parts = PATH.exec(value);
		if (!parts?.[1]) continue;
		matches.push({
			path: parts[1],
			line: parts[2] ? Number(parts[2]) : undefined,
			column: parts[3] ? Number(parts[3]) : undefined,
			start: token.index,
			end: token.index + value.length
		});
	}
	return matches;
}

/**
 * Reads a buffer line as text, with the cell column of each UTF-16 unit, so a
 * match in the text maps back to the cells it covers even after wide characters.
 */
function lineText(line: IBufferLine): { text: string; columns: number[] } {
	let text = '';
	const columns: number[] = [];
	for (let x = 0; x < line.length; x += 1) {
		const cell = line.getCell(x);
		if (!cell) break;
		// The second cell of a wide character carries no text of its own.
		if (cell.getWidth() === 0) continue;
		const chars = cell.getChars() || ' ';
		for (let index = 0; index < chars.length; index += 1) columns.push(x);
		text += chars;
	}
	return { text, columns };
}

/** How long an answer about one path is reused before the workspace is asked again. */
const EXISTS_TTL_MS = 5000;

/**
 * Turns workspace file paths in a terminal's output into links. A path
 * becomes a link only after `links.exists` confirms it names a file, so
 * text that merely looks like a path stays plain. Paths that continue onto
 * a wrapped line are not detected.
 */
export function createTerminalPathLinks(terminal: Terminal, links: TerminalFileLinks): ILinkProvider {
	const answers = new Map<string, { at: number; exists: Promise<boolean> }>();
	const exists = (path: string): Promise<boolean> => {
		const cached = answers.get(path);
		if (cached && performance.now() - cached.at < EXISTS_TTL_MS) return cached.exists;
		const answer = (async () => {
			try {
				return await links.exists(path);
			} catch {
				return false;
			}
		})();
		answers.set(path, { at: performance.now(), exists: answer });
		return answer;
	};

	return {
		provideLinks(y, callback) {
			const line = terminal.buffer.active.getLine(y - 1);
			if (!line) return callback(undefined);
			const { text, columns } = lineText(line);
			const matches = findTerminalPaths(text);
			if (matches.length === 0) return callback(undefined);
			void Promise.all(matches.map((match) => exists(match.path))).then((found) => {
				const result: ILink[] = matches
					.filter((_, index) => found[index])
					.map((match) => ({
						range: {
							start: { x: (columns[match.start] ?? 0) + 1, y },
							end: { x: (columns[match.end - 1] ?? 0) + 1, y }
						},
						text: text.slice(match.start, match.end),
						decorations: { underline: true, pointerCursor: true },
						activate: () => links.open(match.path, match.line)
					}));
				callback(result.length > 0 ? result : undefined);
			});
		}
	};
}
