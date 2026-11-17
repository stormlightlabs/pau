import type { ContextMenuItem } from './context-menu';
import { permissionQuestion, permissionRequest } from './permission-request';
import type { SessionStatus, SessionViewModel } from './types/session';

/**
 * The three racks of the bay, in attention order. Needs you holds every
 * session that needs the operator: one with a pending dialog or permission
 * request, a failed one and one that stopped responding. Running holds
 * sessions at work, and Settled holds idle and stopped sessions, failed
 * sessions the operator started again, and the saved ones.
 */
export type BaySection = 'needs' | 'running' | 'settled';

const SECTION_BY_STATUS: Record<SessionStatus, BaySection> = {
	waiting: 'needs',
	failed: 'needs',
	not_responding: 'needs',
	starting: 'running',
	running: 'running',
	stopping: 'running',
	idle: 'settled',
	stopped: 'settled'
};

type RackedSession = Pick<SessionViewModel, 'status' | 'attention' | 'restarted'>;

/**
 * Whether a session needs the operator. A pending dialog sets `attention`
 * while the agent's status stays `running` or `idle`, so the status alone
 * misses a permission request. A session the operator started again needs
 * nothing more: its restart carries on the work.
 */
export function needsOperator(session: RackedSession): boolean {
	if (session.restarted) return false;
	return Boolean(session.attention) || SECTION_BY_STATUS[session.status] === 'needs';
}

/** The rack a session belongs in. A restarted session stays as history in Settled. */
export function baySection(session: RackedSession): BaySection {
	if (needsOperator(session)) return 'needs';
	return session.restarted ? 'settled' : SECTION_BY_STATUS[session.status];
}

/**
 * Why a session is marked for the operator, in the order the attention jump
 * visits them: `waiting` for a session in Needs you that asks for something
 * or stopped responding, `failed` for a failed one, and `unread` for any
 * other session that finished a turn out of view and has not been opened
 * since.
 */
export type AttentionKind = 'waiting' | 'failed' | 'unread';

type MarkedSession = Pick<SessionViewModel, 'status' | 'attention' | 'restarted' | 'unseen'>;

/**
 * The marker a strip shows while its session is unseen. A failed session
 * the operator started again keeps `failed`, since the marker says how the
 * session ended, even though the session left Needs you.
 */
export function markerKind(session: MarkedSession): AttentionKind {
	if (displayStatus(session) === 'failed') return 'failed';
	return needsOperator(session) ? 'waiting' : 'unread';
}

/**
 * Why the attention jump stops on a session, or `undefined` when it skips
 * it. It skips a restarted session: that strip is history in Settled, and
 * the new session the restart opened carries on the work.
 */
export function attentionKind(session: MarkedSession): AttentionKind | undefined {
	if (session.restarted || !(needsOperator(session) || session.unseen)) return undefined;
	return markerKind(session);
}

const ATTENTION_ORDER: readonly AttentionKind[] = ['waiting', 'failed', 'unread'];

/**
 * The session the attention jump opens next: waiting sessions first, then
 * failed, then unread, each group in the order the bay lists it. From a
 * marked session it moves to the one after it, wrapping past the last. From
 * any other session it opens the first. Returns `undefined` when no session
 * is marked, or when the open session is the only one.
 */
export function nextAttentionSession(
	sessions: readonly Pick<SessionViewModel, 'id' | 'status' | 'attention' | 'restarted' | 'unseen'>[],
	activeSessionId: string | undefined
): string | undefined {
	const marked = ATTENTION_ORDER.flatMap((kind) =>
		sessions.filter((session) => attentionKind(session) === kind).map((session) => session.id)
	);
	if (marked.length === 0) return undefined;
	const current = activeSessionId === undefined ? -1 : marked.indexOf(activeSessionId);
	const next = marked[(current + 1) % marked.length];
	return next === activeSessionId ? undefined : next;
}

/**
 * The state a session shows in its mark and header: `waiting` while a
 * dialog waits on the operator, whatever the agent reports, unless the
 * session failed or stopped responding, which say more.
 */
export function displayStatus(session: Pick<SessionViewModel, 'status' | 'attention'>): SessionStatus {
	return session.attention && SECTION_BY_STATUS[session.status] !== 'needs' ? 'waiting' : session.status;
}

/** How a session's state reads in its strip mark, the page header and tooltips. */
export function sessionStatusLabel(status: SessionStatus): string {
	return {
		starting: 'Starting',
		idle: 'Ready',
		running: 'Running',
		waiting: 'Needs you',
		not_responding: 'Not responding',
		stopping: 'Stopping',
		stopped: 'Stopped',
		failed: 'Failed'
	}[status];
}

/** A strip's second line: what the session does or needs, in a state tone when it needs the operator. */
export type BayStateLine = {
	text: string;
	/** The `pau-tone-*` suffix that colors the line, for sessions in Needs you. */
	tone?: 'waiting' | 'danger' | 'warning';
	/** Whether the line is a command or path, set in the code face. */
	mono: boolean;
};

/**
 * Describes a session in one line. A session that waits on the operator
 * shows its question, a failed one its error, and a running one the tool it
 * runs now, so the bay answers what each session needs without opening it.
 */
export function bayStateLine(session: SessionViewModel): BayStateLine {
	const agent = session.agent;
	switch (displayStatus(session)) {
		case 'waiting': {
			const request = permissionRequest(session.extensionUi?.dialog);
			if (request) {
				const { before, target = '', after } = permissionQuestion(request);
				return { text: `${before}${target}${after}`, tone: 'waiting', mono: false };
			}
			return { text: session.attention ?? 'Waiting for you', tone: 'waiting', mono: false };
		}
		case 'failed': {
			return { text: session.error ? `Failed: ${session.error}` : 'Failed', tone: 'danger', mono: false };
		}
		case 'not_responding': {
			return { text: `${agent} is not responding`, tone: 'warning', mono: false };
		}
		case 'starting': {
			return { text: `Starting ${agent}`, mono: false };
		}
		case 'stopping': {
			return { text: 'Stopping', mono: false };
		}
		case 'running': {
			const tool = session.transcript.findLast((entry) => entry.kind === 'tool' && entry.status === 'running');
			if (tool?.kind === 'tool') {
				const command = tool.call?.tool === 'bash' ? tool.call.command : tool.detail;
				return command ? { text: command, mono: true } : { text: `Running ${tool.name}`, mono: false };
			}
			return { text: 'Working', mono: false };
		}
		case 'idle': {
			return { text: 'Idle', mono: false };
		}
		case 'stopped': {
			return { text: 'Stopped', mono: false };
		}
	}
}

/** Whether every word of `query` appears in one of the texts, ignoring case. */
export function matchesBayFilter(query: string, texts: (string | undefined)[]): boolean {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return true;
	const haystack = texts.filter(Boolean).join(' ').toLowerCase();
	return words.every((word) => haystack.includes(word));
}

/** Which session actions the app supports, and whether it can reach the backend. */
export type SessionMenuOptions = {
	disconnected: boolean;
	/** Whether the app can rename sessions. The session also needs the `rename` capability. */
	rename: boolean;
	/** Whether the app can clone sessions. The session also needs the `cloneSession` capability. */
	clone: boolean;
	/** Whether the app can stop sessions. The session also needs the `stop` capability. */
	stop: boolean;
};

/**
 * The actions of a session's context menu, each disabled with its reason
 * when the session cannot take it now. The built-in commands `/name`,
 * `/clone` and `/stop` check the same items, so both refuse alike.
 */
export function sessionMenuItems(session: SessionViewModel, options: SessionMenuOptions): ContextMenuItem[] {
	const live = ['starting', 'idle', 'running', 'waiting'].includes(session.status);
	const offline = 'Pau is reconnecting to the backend.';
	const ended = 'This session has ended.';
	const items: ContextMenuItem[] = [{ id: 'open', label: 'Open' }];
	if (options.rename && session.capabilities.rename) {
		const reason = options.disconnected ? offline : live ? undefined : ended;
		items.push({ id: 'rename', label: 'Rename…', disabled: reason !== undefined, reason });
	}
	if (options.clone && session.capabilities.cloneSession) {
		const reason = options.disconnected
			? offline
			: !live
				? ended
				: session.status === 'idle'
					? undefined
					: `Wait for ${session.agent} to finish before cloning.`;
		items.push({ id: 'clone', label: 'Clone', disabled: reason !== undefined, reason });
	}
	items.push({ id: 'copy-id', label: 'Copy session ID', separatorBefore: true });
	const stoppable = options.stop && session.capabilities.stop;
	if (stoppable) {
		const running = live || session.status === 'not_responding';
		const reason = options.disconnected ? offline : running ? undefined : ended;
		items.push({ id: 'stop', label: 'Stop', separatorBefore: true, disabled: reason !== undefined, reason });
	}
	items.push({ id: 'archive', label: 'Archive', separatorBefore: !stoppable, disabled: true, reason: 'Coming soon' });
	return items;
}
