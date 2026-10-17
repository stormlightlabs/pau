/** Where the composer sits in the prompt history while the user recalls earlier prompts. */
export type HistoryCursor = {
	/** Index into the history, newest first, or -1 when the user is writing a fresh draft. */
	index: number;
	/** The draft that Down restores after the newest recalled prompt. */
	stash: string;
};

/** The composer text and cursor after a successful recall. */
export type HistoryStep = { cursor: HistoryCursor; draft: string };

/** The most prompts kept per session, matching the backend limit. */
export const historyLimit = 100;

export const idleHistoryCursor: HistoryCursor = { index: -1, stash: '' };

/**
 * Moves through earlier prompts the way Pi's editor does. Up recalls an older
 * prompt from an empty draft or while browsing. Down moves toward newer
 * prompts and finally restores the draft that was being written.
 *
 * Returns `undefined` when the key should keep its normal text-editing
 * behavior: the history is exhausted or empty, the draft is a user-written
 * one that Up must not replace, or the caret is not on the first line (Up) or
 * last line (Down) of a multi-line draft. Editing a recalled prompt ends
 * browsing and keeps the edited text as the new draft.
 *
 * @param entries Earlier prompts, newest first.
 * @param caret Caret offset within `draft`.
 */
export function navigateHistory(
	entries: readonly string[],
	cursor: HistoryCursor,
	draft: string,
	caret: number,
	direction: 'previous' | 'next'
): HistoryStep | undefined {
	const browsing = cursor.index >= 0 && entries[cursor.index] === draft;
	if (direction === 'previous') {
		if (draft.slice(0, caret).includes('\n') || (!browsing && draft !== '')) return undefined;
		const index = browsing ? cursor.index + 1 : 0;
		const entry = entries[index];
		if (entry === undefined) return undefined;
		return { cursor: { index, stash: browsing ? cursor.stash : draft }, draft: entry };
	}
	if (!browsing || draft.slice(caret).includes('\n')) return undefined;
	const index = cursor.index - 1;
	const entry = entries[index];
	return entry === undefined
		? { cursor: idleHistoryCursor, draft: cursor.stash }
		: { cursor: { index, stash: cursor.stash }, draft: entry };
}

/** Adds a sent prompt as the newest entry, skipping an immediate repeat. */
export function recordPrompt(entries: readonly string[], prompt: string): string[] {
	return entries[0] === prompt ? [...entries] : [prompt, ...entries].slice(0, historyLimit);
}
