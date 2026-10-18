import type { SessionViewModel } from './types/session';

/** The parts of a session that can produce an announcement. */
export type AnnouncementSnapshot = {
	sessionId: string;
	agent: string;
	status: SessionViewModel['status'];
	/** Id and title of the extension dialog waiting for an answer. */
	dialogId?: string;
	dialogTitle?: string;
	/** Ids and names of tool calls that have failed, in matching order. */
	failedToolIds: string[];
	failedToolNames: string[];
	/** Text of the latest assistant message, which may still be streaming. */
	lastAssistantText?: string;
	compactions: number;
};

/** Longest summary read aloud after a response finishes. */
const maxSummaryLength = 120;

/** Takes the fields that announcements depend on from a session. */
export function announcementSnapshot(session: SessionViewModel): AnnouncementSnapshot {
	const failed = session.transcript.flatMap((entry) =>
		entry.kind === 'tool' && entry.status === 'failed' ? [entry] : []
	);
	const lastAssistant = session.transcript.findLast((entry) => entry.kind === 'message' && entry.role === 'assistant');
	const dialog = session.extensionUi?.dialog;
	return {
		sessionId: session.id,
		agent: session.agent,
		status: session.status,
		dialogId: dialog?.id,
		dialogTitle: dialog && 'title' in dialog ? dialog.title : undefined,
		failedToolIds: failed.map((entry) => entry.id),
		failedToolNames: failed.map((entry) => entry.name),
		lastAssistantText: lastAssistant?.kind === 'message' ? lastAssistant.body : undefined,
		compactions: session.transcript.filter((entry) => entry.kind === 'compaction').length
	};
}

/** First sentence of a response, shortened for speech. Empty when the text has none. */
export function responseSummary(text: string | undefined): string {
	const flat = (text ?? '')
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/[#*_`>]+/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	const sentence = /^.*?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat;
	return sentence.length > maxSummaryLength ? `${sentence.slice(0, maxSummaryLength - 1).trimEnd()}…` : sentence;
}

/**
 * Describes what changed between two snapshots of the same session, one
 * message per event. Streamed text never produces a message, so a long
 * response announces its start and its end. Returns nothing when the snapshots
 * belong to different sessions, because switching sessions is not an event.
 * Session failures and the `waiting` status are left to the alerts that
 * already show them.
 */
export function describeChanges(previous: AnnouncementSnapshot | undefined, next: AnnouncementSnapshot): string[] {
	if (!previous || previous.sessionId !== next.sessionId) return [];
	const messages: string[] = [];

	if (next.status === 'running' && previous.status !== 'running') {
		messages.push(`${next.agent} is responding`);
	} else if (previous.status === 'running' && (next.status === 'idle' || next.status === 'stopped')) {
		const summary = responseSummary(next.lastAssistantText);
		const verb = next.status === 'stopped' ? 'stopped' : 'finished';
		messages.push(summary ? `${next.agent} ${verb}: ${summary}` : `${next.agent} ${verb}. Response ready`);
	}

	const newFailures = next.failedToolIds.flatMap((id, index) =>
		previous.failedToolIds.includes(id) ? [] : [next.failedToolNames[index]!]
	);
	if (newFailures.length === 1) messages.push(`Tool call failed: ${newFailures[0]}`);
	else if (newFailures.length > 1) messages.push(`${newFailures.length} tool calls failed`);

	if (next.dialogId && next.dialogId !== previous.dialogId) {
		messages.push(next.dialogTitle ? `Waiting for your input: ${next.dialogTitle}` : 'Waiting for your input');
	}
	if (next.compactions > previous.compactions) messages.push('Compaction finished');
	return messages;
}
