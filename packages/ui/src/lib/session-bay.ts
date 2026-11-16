import type { ContextMenuItem } from './context-menu';
import { permissionQuestion, permissionRequest } from './permission-request';
import type { SessionStatus, SessionViewModel } from './types/session';

/**
 * The three racks of the bay, in attention order. Needs you holds every
 * session that needs the operator: one with a pending dialog or permission
 * request, a failed one and one that stopped responding. Running holds
 * sessions at work, and Settled holds idle and stopped sessions with the
 * saved ones.
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

/**
 * Whether a session needs the operator. A pending dialog sets `attention`
 * while the agent's status stays `running` or `idle`, so the status alone
 * misses a permission request.
 */
export function needsOperator(session: Pick<SessionViewModel, 'status' | 'attention'>): boolean {
	return Boolean(session.attention) || SECTION_BY_STATUS[session.status] === 'needs';
}

/** The rack a session belongs in. */
export function baySection(session: Pick<SessionViewModel, 'status' | 'attention'>): BaySection {
	return needsOperator(session) ? 'needs' : SECTION_BY_STATUS[session.status];
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
