import type { AgentSession, ServerEvent, SessionStatus } from '@stormlightlabs/pau-protocol';
import { describe, expect, test, vi } from 'vitest';

import { FakeEventSocket } from './fake-event-socket';
import { SessionAttention, inView, statusAttention, type AttentionNotifier } from './session-attention';

const counter = { sequence: 0 };

function changed(status: SessionStatus, name: string | null = 'Fix the login bug', id = 'session-1'): ServerEvent {
	counter.sequence += 1;
	const session = { id, workspace_id: 'pau', status, name } as unknown as AgentSession;
	return {
		sequence: counter.sequence,
		timestamp: '2026-10-21T12:00:00Z',
		workspace_id: 'pau',
		session_id: id,
		kind: 'session_changed',
		payload: JSON.stringify(session)
	};
}

function question(requestId: string, id = 'session-1'): ServerEvent {
	counter.sequence += 1;
	return {
		sequence: counter.sequence,
		timestamp: '2026-10-21T12:00:00Z',
		workspace_id: 'pau',
		session_id: id,
		kind: 'session_output',
		payload: JSON.stringify({ type: 'extension_ui_request', id: requestId, method: 'confirm', title: 'Delete it?' })
	};
}

function workspace(): ServerEvent {
	counter.sequence += 1;
	return {
		sequence: counter.sequence,
		timestamp: '2026-10-21T12:00:00Z',
		workspace_id: 'pau',
		session_id: null,
		kind: 'workspace_changed',
		payload: JSON.stringify({ id: 'pau', path: '/Users/operator/pau', name: null })
	} as ServerEvent;
}

/** An attention store on a fake socket that already sent its snapshot. */
function setup(snapshot: ServerEvent[] = [changed('idle')]) {
	const notifier = {
		notify: vi.fn<AttentionNotifier['notify']>().mockResolvedValue(undefined),
		setBadgeCount: vi.fn<AttentionNotifier['setBadgeCount']>().mockResolvedValue(undefined)
	};
	const sockets: FakeEventSocket[] = [];
	const attention = new SessionAttention({
		browserOrigin: 'http://localhost:5173',
		notifier,
		socketFactory: (url) => {
			const socket = new FakeEventSocket(url);
			sockets.push(socket);
			return socket;
		}
	});
	attention.connect();
	const socket = sockets[0]!;
	socket.open();
	socket.receive({ type: 'snapshot', snapshot: { sequence: counter.sequence, events: snapshot } });
	const send = (...events: ServerEvent[]) => {
		for (const event of events) socket.receive({ type: 'event', event });
	};
	return { attention, notifier, socket, send };
}

describe('which status changes ask for attention', () => {
	test.each<[SessionStatus | undefined, SessionStatus, string | undefined]>([
		['running', 'waiting', 'waiting'],
		['idle', 'waiting', 'waiting'],
		['running', 'failed', 'failed'],
		['idle', 'failed', 'failed'],
		['starting', 'failed', 'failed'],
		['stopping', 'failed', undefined],
		['stopping', 'stopped', undefined],
		['running', 'idle', undefined],
		['idle', 'running', undefined],
		['waiting', 'waiting', undefined],
		['failed', 'failed', undefined],
		[undefined, 'waiting', undefined],
		[undefined, 'failed', undefined]
	])('%s to %s', (previous, next, reason) => {
		expect(statusAttention(previous, next)).toBe(reason);
	});

	test('a session is in view only while the window has focus and shows it', () => {
		expect(inView('session-1', { windowFocused: true, viewedSessionId: 'session-1' })).toBe(true);
		expect(inView('session-1', { windowFocused: false, viewedSessionId: 'session-1' })).toBe(false);
		expect(inView('session-1', { windowFocused: true, viewedSessionId: 'session-2' })).toBe(false);
		expect(inView('session-1', { windowFocused: true, viewedSessionId: undefined })).toBe(false);
	});
});

test('starts from a snapshot so earlier transitions do not notify', () => {
	const { notifier, socket } = setup([changed('failed')]);

	expect(socket.url).toBe('ws://localhost:5173/api/events');
	expect(notifier.notify).not.toHaveBeenCalled();
	expect(notifier.setBadgeCount).not.toHaveBeenCalled();
});

test('notifies when a session out of view waits, asks, or fails, and badges the icon', () => {
	const { attention, notifier, send } = setup([changed('idle'), changed('idle', null, 'session-2')]);
	attention.view('session-3');

	send(changed('waiting'));
	send(question('ask-1', 'session-2'));

	expect(notifier.notify.mock.calls).toEqual([
		[{ title: 'Fix the login bug', body: 'Pi is waiting for your input.' }],
		[{ title: 'Pi session', body: 'Pi needs your answer to continue.' }]
	]);
	expect(notifier.setBadgeCount.mock.calls).toEqual([[1], [2]]);

	send(changed('failed'));
	expect(notifier.notify).toHaveBeenLastCalledWith({ title: 'Fix the login bug', body: 'Pi exited unexpectedly.' });
	expect(notifier.setBadgeCount).toHaveBeenCalledTimes(2);
});

test('notifies a session shown in an unfocused window', () => {
	const { attention, notifier, send } = setup();
	attention.view('session-1');
	attention.focus(false);

	send(changed('waiting'));

	expect(notifier.notify).toHaveBeenCalledOnce();
	expect(notifier.setBadgeCount).toHaveBeenCalledWith(1);
});

test('does not notify for the session the operator is looking at', () => {
	const { attention, notifier, send } = setup();
	attention.view('session-1');

	send(changed('waiting'), question('ask-1'), changed('failed'));

	expect(notifier.notify).not.toHaveBeenCalled();
	expect(notifier.setBadgeCount).not.toHaveBeenCalled();
});

test('does not notify when the operator stops a session', () => {
	const { notifier, send } = setup([changed('running')]);

	send(changed('stopping'), changed('failed'));

	expect(notifier.notify).not.toHaveBeenCalled();
});

test('notifies once per transition, not once per event', () => {
	const { notifier, send, socket } = setup();

	send(changed('waiting'), changed('waiting'), question('ask-1'), question('ask-1'));
	socket.receive({ type: 'event', event: question('ask-1') });

	expect(notifier.notify).toHaveBeenCalledTimes(2);
	expect(notifier.setBadgeCount.mock.calls).toEqual([[1]]);

	send(changed('running'), changed('waiting'));
	expect(notifier.notify).toHaveBeenCalledTimes(3);
});

test('ignores session output other than extension questions', () => {
	const { notifier, send } = setup();
	const notice = question('notice-1');
	notice.payload = JSON.stringify({ type: 'extension_ui_request', id: 'notice-1', method: 'notify', message: 'Hi' });

	send(notice, { ...question('x'), payload: JSON.stringify({ type: 'agent_start' }) });

	expect(notifier.notify).not.toHaveBeenCalled();
});

test('clears the badge when the operator views the session in a focused window', () => {
	const { attention, notifier, send } = setup([changed('idle'), changed('idle', null, 'session-2')]);
	attention.focus(false);
	send(changed('waiting'), changed('failed', null, 'session-2'));
	expect(notifier.setBadgeCount).toHaveBeenLastCalledWith(2);

	attention.view('session-1');
	expect(notifier.setBadgeCount).toHaveBeenCalledTimes(2);

	attention.focus(true);
	expect(notifier.setBadgeCount).toHaveBeenLastCalledWith(1);

	attention.leave('session-1');
	attention.view('session-2');
	expect(notifier.setBadgeCount).toHaveBeenLastCalledWith(undefined);
	expect(notifier.setBadgeCount).toHaveBeenCalledTimes(4);
});

test('a session that leaves the view notifies again', () => {
	const { attention, notifier, send } = setup();
	attention.view('session-1');
	attention.leave('session-1');

	send(changed('waiting'));

	expect(notifier.notify).toHaveBeenCalledOnce();
});

test('titles a session from the rail, then its name, then its workspace', () => {
	const { attention, notifier, send } = setup([workspace(), changed('idle', null)]);
	attention.view(undefined);

	send(changed('waiting', null));
	expect(notifier.notify).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Pi session in pau' }));

	const stop = attention.useTitles(() => 'Refactor the parser');
	send(changed('running', null), changed('waiting', null));
	expect(notifier.notify).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Refactor the parser' }));

	stop();
	send(changed('running', 'Named in Pi'), changed('waiting', 'Named in Pi'));
	expect(notifier.notify).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Named in Pi' }));
});
