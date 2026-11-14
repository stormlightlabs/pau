import type {
	AgentSession,
	NotificationPolicy,
	ServerEvent,
	SessionStatus,
	Workspace
} from '@stormlightlabs/pau-protocol';

import { EventStreamClient, type EventSocketFactory, type EventStreamState } from './event-stream';
import { isExtensionEvent, opensDialog } from './extension-ui';
import { agentLabel } from './live-sessions.svelte';

/**
 * Why a session notifies the operator. `finished` is a turn that ended
 * without asking for anything, which notifies only under the `all` policy.
 */
export type AttentionReason = 'waiting' | 'question' | 'failed' | 'finished';

/** Text for one native notification. */
export type AttentionNotification = { title: string; body: string };

/** Native services that {@link SessionAttention} reports through. Tests replace both. */
export type AttentionNotifier = {
	notify(notification: AttentionNotification): Promise<void>;
	/** Shows `count` on the app icon, or removes the badge when it is `undefined`. */
	setBadgeCount(count: number | undefined): Promise<void>;
};

/** What the operator can see: whether the window has focus, and which session it shows. */
export type AttentionView = { windowFocused: boolean; viewedSessionId: string | undefined };

/**
 * Returns why a status change asks for attention, or `undefined` when it does
 * not.
 *
 * The first status seen for a session is never a change: it comes from a
 * snapshot or a session that just started. A repeated status is the same
 * transition delivered again. A session that fails while stopping was
 * stopped by the operator, who needs no notice of it. A running session that
 * goes idle has finished its turn, unless the operator interrupted it.
 */
export function statusAttention(
	previous: SessionStatus | undefined,
	next: SessionStatus,
	interrupted = false
): AttentionReason | undefined {
	if (previous === undefined || previous === next) return undefined;
	if (next === 'waiting') return 'waiting';
	if (next === 'failed' && previous !== 'stopping') return 'failed';
	if (next === 'idle' && previous === 'running' && !interrupted) return 'finished';
	return undefined;
}

/** Whether the operator is looking at the session, so it needs no notification. */
export function inView(sessionId: string, view: AttentionView): boolean {
	return view.windowFocused && view.viewedSessionId === sessionId;
}

const BODIES: Record<AttentionReason, (agent: string) => string> = {
	waiting: (agent) => `${agent} is waiting for your input.`,
	question: (agent) => `${agent} needs your answer to continue.`,
	failed: (agent) => `${agent} exited unexpectedly.`,
	finished: (agent) => `${agent} finished its turn.`
};

/** Whether the notification policy lets `reason` notify. */
export function policyAllows(policy: NotificationPolicy, reason: AttentionReason): boolean {
	if (policy === 'off') return false;
	return reason !== 'finished' || policy === 'all';
}

/**
 * Builds the notification for a session, titled with its name. `agent` is the
 * agent's label, such as `Claude Code`, which the body names.
 */
export function attentionNotification(title: string, agent: string, reason: AttentionReason): AttentionNotification {
	return { title, body: BODIES[reason](agent) };
}

/** Whether a `session_output` payload is the server's notice that the operator interrupted the run. */
function isInterrupt(payload: unknown): boolean {
	return typeof payload === 'object' && payload !== null && 'type' in payload && payload.type === 'session_interrupted';
}

function workspaceName(workspace: Workspace): string {
	return workspace.name ?? workspace.path.split(/[\\/]/).findLast(Boolean) ?? workspace.path;
}

/** Context key under which the app layout shares its {@link SessionAttention}. */
export const sessionAttentionContext = Symbol('pau.desktop.session-attention');

/** Transport and native hooks for {@link SessionAttention}. */
export type SessionAttentionOptions = {
	browserOrigin: string;
	notifier: AttentionNotifier;
	/** Reads the operator's notification policy each time a session would notify. Defaults to `attention`. */
	policy?: () => NotificationPolicy;
	socketFactory?: EventSocketFactory;
};

/**
 * Sends a native notification and badges the app icon when a session out of
 * the operator's view starts waiting, asks a question, or fails. Under the
 * `all` policy a finished turn notifies too, and under `off` nothing notifies
 * or adds to the badge.
 *
 * The app layout owns one instance for the life of the window, so sessions
 * notify while any view is open. It follows its own event stream from a
 * snapshot, which keeps transitions that happened before the window opened
 * from notifying. Each status transition and each extension question notifies
 * once, however often the stream delivers it. The badge counts sessions that
 * notified and that the operator has not looked at since.
 */
export class SessionAttention {
	readonly #notifier: AttentionNotifier;
	readonly #policy: () => NotificationPolicy;
	readonly #stream: EventStreamClient;
	readonly #sessions = new Map<string, AgentSession>();
	readonly #workspaces = new Map<string, string>();
	/** Extension questions already notified, keyed by session and request ID. */
	readonly #asked = new Set<string>();
	/**
	 * Sessions the operator interrupted, from the server's
	 * `session_interrupted` event until their next status change, which the
	 * interrupt caused.
	 */
	readonly #interrupted = new Set<string>();
	/** Sessions that notified and have not been viewed since. */
	readonly #pending = new Set<string>();
	#badge = 0;
	#view: AttentionView = { windowFocused: true, viewedSessionId: undefined };
	#titleOf: ((sessionId: string) => string | undefined) | undefined;

	constructor(options: SessionAttentionOptions) {
		this.#notifier = options.notifier;
		this.#policy = options.policy ?? (() => 'attention');
		this.#stream = new EventStreamClient({
			browserOrigin: options.browserOrigin,
			socketFactory: options.socketFactory,
			replay: false,
			onState: (state, event) => this.#apply(state, event)
		});
	}

	#apply(state: EventStreamState, event: ServerEvent | undefined): void {
		if (!event) {
			for (const known of state.events) this.#remember(known);
			return;
		}
		if (event.kind === 'session_output' && event.session_id) {
			const payload: unknown = JSON.parse(event.payload);
			if (isInterrupt(payload)) this.#interrupted.add(event.session_id);
			else this.#question(event.session_id, payload);
			return;
		}
		if (event.kind !== 'session_changed') {
			this.#remember(event);
			return;
		}
		const session = JSON.parse(event.payload) as AgentSession;
		const previous = this.#sessions.get(session.id)?.status;
		const interrupted = previous !== session.status && this.#interrupted.delete(session.id);
		const reason = statusAttention(previous, session.status, interrupted);
		this.#remember(event);
		if (reason) this.#raise(session.id, reason);
	}

	#remember(event: ServerEvent): void {
		if (event.kind === 'workspace_changed') {
			const workspace = JSON.parse(event.payload) as Workspace;
			this.#workspaces.set(workspace.id, workspaceName(workspace));
		} else if (event.kind === 'session_changed') {
			const session = JSON.parse(event.payload) as AgentSession;
			this.#sessions.set(session.id, session);
		}
	}

	#question(sessionId: string, payload: unknown): void {
		if (!isExtensionEvent(payload) || !opensDialog(payload)) return;
		const key = `${sessionId}:${String(payload.id)}`;
		if (this.#asked.has(key)) return;
		this.#asked.add(key);
		this.#raise(sessionId, 'question');
	}

	#raise(sessionId: string, reason: AttentionReason): void {
		if (inView(sessionId, this.#view) || !policyAllows(this.#policy(), reason)) return;
		this.#pending.add(sessionId);
		const agent = agentLabel(this.#sessions.get(sessionId)?.agent ?? 'pi');
		void this.#notifier.notify(attentionNotification(this.#title(sessionId, agent), agent, reason)).catch(() => {
			// Notifications are best effort. The badge and rail marker still show.
		});
		this.#publishBadge();
	}

	#title(sessionId: string, agent: string): string {
		const session = this.#sessions.get(sessionId);
		const title = this.#titleOf?.(sessionId) ?? session?.name ?? undefined;
		if (title) return title;
		const workspace = session && this.#workspaces.get(session.workspace_id);
		return workspace ? `${agent} session in ${workspace}` : `${agent} session`;
	}

	#clearViewed(): void {
		const { viewedSessionId } = this.#view;
		if (viewedSessionId === undefined || !inView(viewedSessionId, this.#view)) return;
		if (this.#pending.delete(viewedSessionId)) this.#publishBadge();
	}

	#publishBadge(): void {
		const count = this.#pending.size;
		if (count === this.#badge) return;
		this.#badge = count;
		void this.#notifier.setBadgeCount(count === 0 ? undefined : count).catch(() => {
			// The platform may not support badges.
		});
	}

	/** Opens the event stream. The first message is a snapshot that notifies nothing. */
	connect(): void {
		this.#stream.connect();
	}

	/** Closes the event stream. The badge keeps its count. */
	close(): void {
		this.#stream.stop();
	}

	/** Records the session on screen, or `undefined` when another view shows. */
	view(sessionId: string | undefined): void {
		this.#view = { ...this.#view, viewedSessionId: sessionId };
		this.#clearViewed();
	}

	/**
	 * Records that the session view no longer shows `sessionId`. A view that
	 * replaced it already reported its own session, which stays recorded.
	 */
	leave(sessionId: string | undefined): void {
		if (this.#view.viewedSessionId === sessionId) this.#view = { ...this.#view, viewedSessionId: undefined };
	}

	/** Records whether the window has focus. */
	focus(windowFocused: boolean): void {
		this.#view = { ...this.#view, windowFocused };
		this.#clearViewed();
	}

	/**
	 * Names sessions the way the session rail does. Pi often reports no name,
	 * and the rail then titles the session from its first prompt. Returns a
	 * function that removes the lookup.
	 */
	useTitles(titleOf: (sessionId: string) => string | undefined): () => void {
		this.#titleOf = titleOf;
		return () => {
			if (this.#titleOf === titleOf) this.#titleOf = undefined;
		};
	}
}
