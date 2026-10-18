import type { FileMention } from './types/session';

/** The `@` mention being typed at the caret. */
export type MentionToken = {
	/** Index of the `@` in the draft. */
	start: number;
	/** The text typed after the `@`, without a quote. */
	query: string;
	/** Whether the mention opened with `@"`, so it may contain spaces. */
	quoted: boolean;
};

/**
 * Finds the `@` mention that ends at the caret. The `@` must start the draft or
 * follow whitespace, so an email address does not open completion. Like Pi, a
 * mention that opens with `@"` stays open through spaces until the closing quote.
 */
export function mentionAt(draft: string, caret: number): MentionToken | undefined {
	const before = draft.slice(0, caret);
	const quote = before.lastIndexOf('@"');
	if (quote !== -1 && (quote === 0 || /\s/.test(before[quote - 1] ?? '')) && !before.slice(quote + 2).includes('"')) {
		return { start: quote, query: before.slice(quote + 2), quoted: true };
	}
	const query = /(?:^|\s)@([^\s"]*)$/.exec(before)?.[1];
	return query === undefined ? undefined : { start: before.length - query.length - 1, query, quoted: false };
}

/**
 * Replaces the mention with the chosen path in Pi's format: `@path ` with a
 * trailing space, or `@"path with spaces" ` when the path holds whitespace. A
 * folder gets no trailing space so the user can keep descending, and the caret
 * stays inside the closing quote. Returns the new draft and caret.
 */
export function insertMention(
	draft: string,
	token: MentionToken,
	caret: number,
	mention: FileMention
): { draft: string; caret: number } {
	const quoted = token.quoted || /\s/.test(mention.path);
	const text = quoted ? `@"${mention.path}"` : `@${mention.path}`;
	const space = mention.directory ? '' : ' ';
	const end = token.start + text.length + space.length;
	return {
		draft: draft.slice(0, token.start) + text + space + draft.slice(caret),
		caret: quoted && mention.directory ? end - 1 : end
	};
}
