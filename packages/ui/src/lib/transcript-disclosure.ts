import type { SessionStatus, TranscriptEntry, TranscriptTool } from './types/session';

/** A run of finished tool calls the transcript shows behind one summary row. */
export type TranscriptToolGroup = {
	/** Derived from the first call, so the operator's open or closed choice survives new calls joining the run. */
	id: string;
	kind: 'tool-group';
	tools: TranscriptTool[];
};

/** Fewest consecutive finished calls that collapse into a group. Three or fewer read fine as separate rows. */
const groupMinimum = 4;

/**
 * Replaces each run of more than three consecutive completed tool calls with
 * a {@link TranscriptToolGroup} and keeps every other entry in place. Running and
 * failed calls end a run and stay as their own rows, so a group never hides
 * work in progress or a failure.
 */
export function groupToolCalls(transcript: readonly TranscriptEntry[]): (TranscriptEntry | TranscriptToolGroup)[] {
	const rows: (TranscriptEntry | TranscriptToolGroup)[] = [];
	let run: TranscriptTool[] = [];
	const flush = () => {
		if (run.length >= groupMinimum) rows.push({ id: `tools-${run[0]!.id}`, kind: 'tool-group', tools: run });
		else rows.push(...run);
		run = [];
	};
	for (const entry of transcript) {
		if (entry.kind === 'tool' && entry.status === 'complete') {
			run.push(entry);
			continue;
		}
		flush();
		rows.push(entry);
	}
	flush();
	return rows;
}

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
