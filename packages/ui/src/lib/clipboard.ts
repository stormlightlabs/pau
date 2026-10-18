import type { TranscriptEntry } from './types/session';

/** Outcome of a copy. `error` is a sentence the operator can read. */
export type CopyResult = { ok: true } | { ok: false; error: string };

/**
 * Writes text to the system clipboard. The Tauri webview and browsers share
 * `navigator.clipboard`, which is missing outside secure contexts and rejects
 * when the document lacks permission, so both cases return a readable error.
 */
export async function copyText(text: string): Promise<CopyResult> {
	if (!globalThis.navigator?.clipboard?.writeText) {
		return { ok: false, error: 'The clipboard is not available here.' };
	}
	try {
		await navigator.clipboard.writeText(text);
		return { ok: true };
	} catch {
		return { ok: false, error: 'The clipboard refused the copy.' };
	}
}

/** The message with this id, or undefined when the entry is missing or not a message. */
export function findMessage(transcript: TranscriptEntry[], entryId: string) {
	const entry = transcript.find((candidate) => candidate.id === entryId);
	return entry?.kind === 'message' ? entry : undefined;
}

/** The newest assistant message with text, which is what `/copy` copies. */
export function lastAssistantReply(transcript: TranscriptEntry[]) {
	for (let index = transcript.length - 1; index >= 0; index -= 1) {
		const entry = transcript[index]!;
		if (entry.kind === 'message' && entry.role === 'assistant' && entry.body !== '') return entry;
	}
}
