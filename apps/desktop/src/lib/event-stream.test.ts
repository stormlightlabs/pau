import type { ServerEvent, ServerStreamMessage } from '@stormlightlabs/pau-protocol';
import { describe, expect, test, vi } from 'vitest';

import { EventStreamClient, reduceServerMessage, type EventStreamState } from './event-stream';

function event(sequence: number, payload = `state-${sequence}`): ServerEvent {
	return {
		sequence,
		timestamp: '2026-04-01T12:00:00Z',
		workspace_id: 'workspace-1',
		session_id: 'session-1',
		kind: 'session_changed',
		payload
	};
}

function message(value: ServerStreamMessage): MessageEvent<string> {
	return { data: JSON.stringify(value) } as MessageEvent<string>;
}

describe('event stream reducer', () => {
	test('replaces state at a snapshot boundary and applies the racing next event', () => {
		const snapshot: ServerStreamMessage = { type: 'snapshot', snapshot: { sequence: 4, events: [event(2), event(4)] } };
		const raced: ServerStreamMessage = { type: 'event', event: event(5, 'raced') };

		const restored = reduceServerMessage({ sequence: 0, events: [] }, snapshot);
		const state = reduceServerMessage(restored, raced);

		expect(state.sequence).toBe(5);
		expect(state.events).toEqual([event(5, 'raced')]);
	});

	test('ignores duplicate delivery at or before the applied sequence', () => {
		const state: EventStreamState = { sequence: 7, events: [event(7)] };

		expect(reduceServerMessage(state, { type: 'event', event: event(7, 'duplicate') })).toBe(state);
		expect(reduceServerMessage(state, { type: 'event', event: event(6, 'old') })).toBe(state);
	});
});

class FakeSocket {
	#messageListener: ((event: MessageEvent<string>) => void) | undefined;
	#closeListener: (() => void) | undefined;
	close = vi.fn();

	addEventListener(type: 'message' | 'close', listener: ((event: MessageEvent<string>) => void) | (() => void)): void {
		if (type === 'message') this.#messageListener = listener as (event: MessageEvent<string>) => void;
		else this.#closeListener = listener as () => void;
	}

	receive(value: ServerStreamMessage): void {
		this.#messageListener?.(message(value));
	}

	disconnect(): void {
		this.#closeListener?.();
	}
}

test('reconnects from the last applied sequence after streamed output disconnects', () => {
	const sockets: FakeSocket[] = [];
	const urls: string[] = [];
	const retries: Array<() => void> = [];
	const states: EventStreamState[] = [];
	const client = new EventStreamClient(
		'',
		'http://localhost:5173',
		(state) => {
			states.push(state);
		},
		(url) => {
			urls.push(url);
			const socket = new FakeSocket();
			sockets.push(socket);
			return socket;
		},
		(retry) => {
			retries.push(retry);
		}
	);

	client.connect();
	sockets[0]?.receive({ type: 'snapshot', snapshot: { sequence: 1, events: [event(1, 'A')] } });
	sockets[0]?.receive({ type: 'event', event: event(2, 'AB') });
	sockets[0]?.disconnect();
	retries[0]?.();

	expect(urls).toEqual(['ws://localhost:5173/api/events', 'ws://localhost:5173/api/events?after=2']);

	sockets[1]?.receive({ type: 'event', event: event(2, 'duplicate') });
	sockets[1]?.receive({ type: 'event', event: event(3, 'ABC') });
	expect(states).toHaveLength(3);
	expect(states.at(-1)).toEqual({ sequence: 3, events: [event(3, 'ABC')] });

	client.stop();
});
