import type { ServerEvent, ServerSnapshot, ServerStreamMessage } from '@stormlightlabs/pau-protocol';

import { resolveEventSocket } from './api';

/** Latest server state reconstructed at a known event sequence. */
export type EventStreamState = { sequence: number; events: ServerEvent[] };

const EMPTY_STATE: EventStreamState = { sequence: 0, events: [] };

function sameProjection(left: ServerEvent, right: ServerEvent): boolean {
	return left.kind === right.kind && left.workspace_id === right.workspace_id && left.session_id === right.session_id;
}

/** Applies snapshots and events while ignoring duplicate event delivery. */
export function reduceServerMessage(state: EventStreamState, message: ServerStreamMessage): EventStreamState {
	if (message.type === 'snapshot') return applySnapshot(message.snapshot);
	if (message.event.sequence <= state.sequence) return state;

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

type EventSocket = {
	addEventListener(type: 'message' | 'close', listener: ((event: MessageEvent<string>) => void) | (() => void)): void;
	close(): void;
};

type EventSocketFactory = (url: string, protocols: string[]) => EventSocket;
type RetryScheduler = (retry: () => void) => void;

/** Maintains the event WebSocket and resumes from the last applied sequence. */
export class EventStreamClient {
	#state: EventStreamState = EMPTY_STATE;
	#socket: EventSocket | undefined;
	#stopped = false;

	constructor(
		private readonly search: string,
		private readonly browserOrigin: string,
		private readonly onState: (state: EventStreamState) => void,
		private readonly socketFactory: EventSocketFactory = (url, protocols) =>
			new WebSocket(url, protocols) as EventSocket,
		private readonly scheduleRetry: RetryScheduler = (retry) => {
			setTimeout(retry, 1000);
		}
	) {}

	/** Opens the stream or resumes it after a disconnect. */
	connect(): void {
		this.#stopped = false;
		const configuration = resolveEventSocket(this.search, this.browserOrigin, this.#state.sequence || undefined);
		const socket = this.socketFactory(configuration.url, configuration.protocols);
		this.#socket = socket;
		socket.addEventListener('message', (message) => {
			const next = reduceServerMessage(this.#state, JSON.parse(message.data) as ServerStreamMessage);
			if (next === this.#state) return;
			this.#state = next;
			this.onState(next);
		});
		socket.addEventListener('close', () => {
			if (this.#socket !== socket || this.#stopped) return;
			this.#socket = undefined;
			this.scheduleRetry(() => {
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
