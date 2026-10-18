import type { SessionStatus, TranscriptEntry } from './types/session';

/**
 * Returns the ids of tool and thinking entries that show their body when the
 * operator has not opened or closed them.
 *
 * A running or failed tool and unfinished thinking stay open. While a turn
 * runs, or waits on the operator, every tool and thinking entry after the
 * latest user prompt stays open too, so finished blocks collapse together when
 * the turn ends instead of one at a time under the reader. Blocks from earlier
 * turns stay closed when a new turn starts.
 */
export function openByDefault(transcript: readonly TranscriptEntry[], status: SessionStatus | undefined): Set<string> {
	const turnActive = status === 'running' || status === 'waiting';
	const turnStart = transcript.findLastIndex((entry) => entry.kind === 'message' && entry.role === 'user') + 1;
	const open = new Set<string>();
	for (const [index, entry] of transcript.entries()) {
		const unfinished =
			(entry.kind === 'tool' && entry.status !== 'complete') || (entry.kind === 'thinking' && !entry.complete);
		const inRunningTurn = turnActive && index >= turnStart && (entry.kind === 'tool' || entry.kind === 'thinking');
		if (unfinished || inRunningTurn) open.add(entry.id);
	}
	return open;
}
