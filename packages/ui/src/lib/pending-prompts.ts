import type { PromptQueue, SessionStatus, SessionViewModel, TranscriptMessage } from './types/session';

/**
 * A prompt the operator submitted that the session has not shown yet. The view
 * draws it at once and drops it when the agent echoes it back.
 */
export type PendingPrompt = {
	id: string;
	sessionId: string;
	text: string;
	/** The queue chosen during a run. Pi shows a queued prompt in its queue before the transcript. */
	queue?: PromptQueue;
	/**
	 * User messages that cannot confirm this prompt: those in the transcript
	 * when it was sent and those that confirmed earlier prompts.
	 */
	seen: string[];
	/** `sent` once the backend accepted it, `failed` when the backend refused it. */
	state: 'sending' | 'sent' | 'failed';
};

/**
 * Statuses in which an accepted prompt can no longer produce an echo. An
 * extension command can consume a prompt without starting a run, so an
 * accepted prompt clears once the session settles.
 */
const settledStatuses = new Set<SessionStatus>(['idle', 'stopped', 'failed']);

/** Lists the IDs of a session's user messages. */
export function userMessageIds(session: SessionViewModel): string[] {
	return userMessages(session).map((message) => message.id);
}

function userMessages(session: SessionViewModel): TranscriptMessage[] {
	return session.transcript.flatMap((entry) => (entry.kind === 'message' && entry.role === 'user' ? [entry] : []));
}

/**
 * Drops pending prompts that their session now shows. Prompts claim new user
 * messages in submission order, so two identical prompts each wait for their
 * own echo, and an expanded prompt template still matches. Other queued
 * messages can arrive during a run, so a queued prompt only matches its own
 * text, in the transcript or in Pi's queue. Failed prompts stay until the
 * operator sends again. Returns the same array when nothing changed.
 */
export function settlePendingPrompts(pending: PendingPrompt[], sessions: SessionViewModel[]): PendingPrompt[] {
	if (pending.length === 0) return pending;
	const byId = new Map(sessions.map((session) => [session.id, session]));
	/** User messages claimed in this pass, per session. */
	const claimed = new Map<string, string[]>();
	/** Queue entries claimed in this pass, per session. */
	const queueClaims = new Map<string, string[]>();
	let changed = false;
	const next: PendingPrompt[] = [];
	for (const prompt of pending) {
		const session = byId.get(prompt.sessionId);
		if (!session) {
			changed = true;
			continue;
		}
		if (prompt.state === 'failed') {
			next.push(prompt);
			continue;
		}
		const taken = claimed.get(session.id) ?? [];
		const seen = taken.some((id) => !prompt.seen.includes(id)) ? [...new Set([...prompt.seen, ...taken])] : prompt.seen;
		const echo = userMessages(session).find(
			(message) => !seen.includes(message.id) && (!prompt.queue || message.body === prompt.text)
		);
		if (echo) {
			claimed.set(session.id, [...taken, echo.id]);
			changed = true;
			continue;
		}
		if (prompt.queue && takeQueued(session, prompt.text, queueClaims)) {
			changed = true;
			continue;
		}
		if (prompt.state === 'sent' && settledStatuses.has(session.status)) {
			changed = true;
			continue;
		}
		next.push(seen === prompt.seen ? prompt : { ...prompt, seen });
		changed ||= seen !== prompt.seen;
	}
	return changed ? next : pending;
}

/** Claims one queue entry with the prompt's text, if an unclaimed one exists. */
function takeQueued(session: SessionViewModel, text: string, claims: Map<string, string[]>): boolean {
	const queued = [...(session.messageQueue?.steering ?? []), ...(session.messageQueue?.followUp ?? [])];
	const taken = claims.get(session.id) ?? [];
	const available = queued.filter((message) => message === text).length;
	const used = taken.filter((message) => message === text).length;
	if (available <= used) return false;
	claims.set(session.id, [...taken, text]);
	return true;
}
