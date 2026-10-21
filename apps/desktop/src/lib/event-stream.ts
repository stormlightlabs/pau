import type { ServerEvent, ServerSnapshot, ServerStreamMessage } from '@stormlightlabs/pau-protocol';

import { resolveEventSocket } from './api';

/** Latest server state reconstructed at a known event sequence. */
export type EventStreamState = { sequence: number; events: ServerEvent[] };

const EMPTY_STATE: EventStreamState = { sequence: 0, events: [] };

function sameProjection(left: ServerEvent, right: ServerEvent): boolean {
	return left.kind === right.kind && left.workspace_id === right.workspace_id && left.session_id === right.session_id;
}

/**
 * Applies snapshots and events while ignoring duplicate event delivery.
 *
 * `session_output` and `workspace_files_changed` events advance the sequence
 * but stay out of `events`: they form a stream rather than state, and the
 * server leaves them out of snapshots.
 */
export function reduceServerMessage(state: EventStreamState, message: ServerStreamMessage): EventStreamState {
	if (message.type === 'snapshot') return applySnapshot(message.snapshot);
	if (message.event.sequence <= state.sequence) return state;
	if (message.event.kind === 'session_output' || message.event.kind === 'workspace_files_changed') {
		return { sequence: message.event.sequence, events: state.events };
	}

	return {
		sequence: message.event.sequence,
		events: [...state.events.filter((event) => !sameProjection(event, message.event)), message.event].sort(
			(left, right) => left.sequence - right.sequence
		)
	};
}

function applySnapshot(snapshot: ServerSnapshot): EventStreamState {
	return {
		sequence: snapshot.sequence,
		events: [...snapshot.events].sort((left, right) => left.sequence - right.sequence)
	};
}

/** The part of the browser WebSocket API the client uses. */
export type EventSocket = {
	addEventListener(
		type: 'open' | 'message' | 'close',
		listener: ((event: MessageEvent<string>) => void) | (() => void)
	): void;
	close(): void;
};

/** Opens a WebSocket-compatible connection. Tests replace it with a fake. */
export type EventSocketFactory = (url: string, protocols: string[]) => EventSocket;
type RetryScheduler = (retry: () => void) => void;

/** Callbacks and transport hooks for {@link EventStreamClient}. */
export type EventStreamOptions = {
	browserOrigin: string;
	/**
	 * Receives each new state. `event` is the event just applied, or absent
	 * when a snapshot replaced the state.
	 */
	onState: (state: EventStreamState, event?: ServerEvent) => void;
	/** Reports whether the socket is open. */
	onConnectionChange?: (connected: boolean) => void;
	socketFactory?: EventSocketFactory;
	scheduleRetry?: RetryScheduler;
	/**
	 * Workspace whose files this stream follows. The server watches it while
	 * the stream is connected. Such a stream starts every connection from a
	 * snapshot instead of replay, because a files view reloads what it shows
	 * whenever it connects.
	 */
	watch?: string;
};

/**
 * Maintains the event WebSocket and resumes from the last applied sequence.
 *
 * The first connection asks for replay after sequence zero. While the server
 * still holds every event, that delivers the session output a fresh page needs
 * to rebuild transcripts. Otherwise the server answers with a snapshot.
 */
export class EventStreamClient {
	#state: EventStreamState = EMPTY_STATE;
	#socket: EventSocket | undefined;
	#stopped = false;
	readonly #options: EventStreamOptions;
	readonly #socketFactory: EventSocketFactory;
	readonly #scheduleRetry: RetryScheduler;

	constructor(options: EventStreamOptions) {
		this.#options = options;
		this.#socketFactory = options.socketFactory ?? ((url, protocols) => new WebSocket(url, protocols) as EventSocket);
		this.#scheduleRetry =
			options.scheduleRetry ??
			((retry) => {
				setTimeout(retry, 1000);
			});
	}

	/** Opens the stream or resumes it after a disconnect. */
	connect(): void {
		this.#stopped = false;
		const { browserOrigin, watch } = this.#options;
		const configuration = resolveEventSocket(browserOrigin, watch ? undefined : this.#state.sequence, watch);
		const socket = this.#socketFactory(configuration.url, configuration.protocols);
		this.#socket = socket;
		socket.addEventListener('open', () => {
			if (this.#socket === socket) this.#options.onConnectionChange?.(true);
		});
		socket.addEventListener('message', (message: MessageEvent<string>) => {
			const parsed = JSON.parse(message.data) as ServerStreamMessage;
			const next = reduceServerMessage(this.#state, parsed);
			if (next === this.#state) return;
			this.#state = next;
			this.#options.onState(next, parsed.type === 'event' ? parsed.event : undefined);
		});
		socket.addEventListener('close', () => {
			if (this.#socket !== socket || this.#stopped) return;
			this.#socket = undefined;
			this.#options.onConnectionChange?.(false);
			this.#scheduleRetry(() => {
				if (!this.#stopped) this.connect();
			});
		});
	}

	/** Closes the stream without scheduling another connection. */
	stop(): void {
		this.#stopped = true;
		this.#socket?.close();
		this.#socket = undefined;
	}
}
