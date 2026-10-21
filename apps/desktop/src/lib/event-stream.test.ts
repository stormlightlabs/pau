import type { ServerEvent, ServerStreamMessage } from '@stormlightlabs/pau-protocol';
import { describe, expect, test } from 'vitest';

import { EventStreamClient, reduceServerMessage, type EventStreamState } from './event-stream';
import { FakeEventSocket } from './fake-event-socket';

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

	test('advances past session output without keeping it as state', () => {
		const state: EventStreamState = { sequence: 7, events: [event(7)] };
		const output = { ...event(8, '{"type":"agent_start"}'), kind: 'session_output' as const };

		expect(reduceServerMessage(state, { type: 'event', event: output })).toEqual({ sequence: 8, events: [event(7)] });
	});

	test('advances past workspace file changes without keeping them as state', () => {
		const state: EventStreamState = { sequence: 7, events: [event(7)] };
		const changed = {
			...event(8, '{"paths":[],"git":true,"truncated":false}'),
			kind: 'workspace_files_changed' as const
		};

		expect(reduceServerMessage(state, { type: 'event', event: changed })).toEqual({ sequence: 8, events: [event(7)] });
	});
});

test('reconnects from the last applied sequence after streamed output disconnects', () => {
	const sockets: FakeEventSocket[] = [];
	const retries: Array<() => void> = [];
	const states: EventStreamState[] = [];
	const applied: Array<ServerEvent | undefined> = [];
	const connection: boolean[] = [];
	const client = new EventStreamClient({
		browserOrigin: 'http://localhost:5173',
		onState: (state, applyingEvent) => {
			states.push(state);
			applied.push(applyingEvent);
		},
		onConnectionChange: (connected) => {
			connection.push(connected);
		},
		socketFactory: (url) => {
			const socket = new FakeEventSocket(url);
			sockets.push(socket);
			return socket;
		},
		scheduleRetry: (retry) => {
			retries.push(retry);
		}
	});

	client.connect();
	sockets[0]?.open();
	sockets[0]?.receive({ type: 'snapshot', snapshot: { sequence: 1, events: [event(1, 'A')] } });
	sockets[0]?.receive({ type: 'event', event: event(2, 'AB') });
	sockets[0]?.disconnect();
	retries[0]?.();
	sockets[1]?.open();

	expect(sockets.map((socket) => socket.url)).toEqual([
		'ws://localhost:5173/api/events?after=0',
		'ws://localhost:5173/api/events?after=2'
	]);
	expect(connection).toEqual([true, false, true]);

	sockets[1]?.receive({ type: 'event', event: event(2, 'duplicate') });
	sockets[1]?.receive({ type: 'event', event: event(3, 'ABC') });
	expect(states).toHaveLength(3);
	expect(states.at(-1)).toEqual({ sequence: 3, events: [event(3, 'ABC')] });
	expect(applied).toEqual([undefined, event(2, 'AB'), event(3, 'ABC')]);

	client.stop();
	expect(sockets[1]?.closed).toBe(true);
});

test('asks the server to watch a workspace and starts each connection from a snapshot', () => {
	const sockets: FakeEventSocket[] = [];
	const retries: Array<() => void> = [];
	const applied: Array<ServerEvent | undefined> = [];
	const client = new EventStreamClient({
		browserOrigin: 'http://localhost:5173',
		watch: 'workspace-1',
		onState: (_state, applyingEvent) => {
			applied.push(applyingEvent);
		},
		socketFactory: (url) => {
			const socket = new FakeEventSocket(url);
			sockets.push(socket);
			return socket;
		},
		scheduleRetry: (retry) => {
			retries.push(retry);
		}
	});
	const changed = {
		...event(2, '{"paths":["src/main.ts"],"git":false,"truncated":false}'),
		kind: 'workspace_files_changed' as const
	};

	client.connect();
	sockets[0]?.receive({ type: 'snapshot', snapshot: { sequence: 1, events: [event(1)] } });
	sockets[0]?.receive({ type: 'event', event: changed });
	sockets[0]?.disconnect();
	retries[0]?.();

	expect(sockets.map((socket) => socket.url)).toEqual([
		'ws://localhost:5173/api/events?watch=workspace-1',
		'ws://localhost:5173/api/events?watch=workspace-1'
	]);
	expect(applied).toEqual([undefined, changed]);
	client.stop();
});
