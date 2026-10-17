import type { CommandOption } from './types/session';

/**
 * Returns the command name being typed when the draft is a bare `/name`
 * token at the start, or `undefined` once the draft holds anything else
 * (including a space after the name, which ends completion).
 */
export function commandQuery(draft: string): string | undefined {
	const match = /^\/(\S*)$/.exec(draft);
	return match ? match[1] : undefined;
}

/** Returns the name right after a leading slash, even when arguments follow. */
export function commandName(draft: string): string | undefined {
	const match = /^\/(\S+)/.exec(draft);
	return match ? match[1] : undefined;
}

function isSubsequence(query: string, name: string): boolean {
	let at = 0;
	for (const char of name) if (char === query[at]) at += 1;
	return at === query.length;
}

/**
 * Filters commands by a typed name. Prefix matches come first, then names that
 * contain the query, then names that contain its letters in order. Each group
 * keeps the agent's order. Matching ignores case.
 */
export function filterCommands(commands: readonly CommandOption[], query: string): CommandOption[] {
	const needle = query.toLowerCase();
	const rank = (name: string): number => {
		const lower = name.toLowerCase();
		if (lower.startsWith(needle)) return 0;
		if (lower.includes(needle)) return 1;
		return isSubsequence(needle, lower) ? 2 : 3;
	};
	return commands
		.map((command, order) => ({ command, order, rank: rank(command.name) }))
		.filter((entry) => entry.rank < 3)
		.sort((a, b) => a.rank - b.rank || a.order - b.order)
		.map((entry) => entry.command);
}
