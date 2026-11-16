import type { SessionStatus, SessionViewModel } from './types/session';

/**
 * The three racks of the bay, in attention order. Needs you holds sessions
 * waiting on the operator, failed or not responding. Running holds sessions
 * at work, and Settled holds idle and stopped sessions with the saved ones.
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

/** The rack a session belongs in. */
export function baySection(status: SessionStatus): BaySection {
	return SECTION_BY_STATUS[status];
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
 * Describes a session in one line. A waiting session shows its question, a
 * failed one its error, and a running one the tool it runs now, so the bay
 * answers what each session needs without opening it.
 */
export function bayStateLine(session: SessionViewModel): BayStateLine {
	const agent = session.agent;
	switch (session.status) {
		case 'waiting': {
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
