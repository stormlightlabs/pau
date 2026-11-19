import type { AgentSession, NotificationPolicy, ServerEvent, SessionStatus } from '@stormlightlabs/pau-protocol';
import { describe, expect, test, vi } from 'vitest';

import { FakeEventSocket } from './fake-event-socket';
import { SessionAttention, inView, statusAttention, type AttentionNotifier } from './session-attention';

const counter = { sequence: 0 };

function changed(
	status: SessionStatus,
	name: string | null = 'Fix the login bug',
	id = 'session-1',
	agent = 'pi'
): ServerEvent {
	counter.sequence += 1;
	const session = { id, agent, workspace_id: 'pau', status, name } as unknown as AgentSession;
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

/** The server's notice that the operator interrupted the run. */
function interrupted(id = 'session-1'): ServerEvent {
	return { ...question('stop', id), payload: JSON.stringify({ type: 'session_interrupted' }) };
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
function setup(snapshot: ServerEvent[] = [changed('idle')], policy?: () => NotificationPolicy) {
	const notifier = {
		notify: vi.fn<AttentionNotifier['notify']>().mockResolvedValue(undefined),
		setBadgeCount: vi.fn<AttentionNotifier['setBadgeCount']>().mockResolvedValue(undefined)
	};
	const sockets: FakeEventSocket[] = [];
	const attention = new SessionAttention({
		browserOrigin: 'http://localhost:5173',
		notifier,
		policy,
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
		['running', 'not_responding', 'not_responding'],
		['idle', 'not_responding', 'not_responding'],
		['not_responding', 'idle', undefined],
		['stopping', 'stopped', undefined],
		['running', 'idle', 'finished'],
		['idle', 'running', undefined],
		['waiting', 'waiting', undefined],
		['failed', 'failed', undefined],
		[undefined, 'waiting', undefined],
		[undefined, 'failed', undefined]
	])('%s to %s', (previous, next, reason) => {
		expect(statusAttention(previous, next)).toBe(reason);
	});

	test('an interrupted run that goes idle has not finished its turn', () => {
		expect(statusAttention('running', 'idle', true)).toBeUndefined();
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
});

test('notifies when a session out of view waits, asks, or fails', () => {
	const { attention, notifier, send } = setup([changed('idle'), changed('idle', null, 'session-2')]);
	attention.view('session-3');

	send(changed('waiting'));
	send(question('ask-1', 'session-2'));

	expect(notifier.notify.mock.calls).toEqual([
		[{ title: 'Fix the login bug', body: 'Pi is waiting for your input.' }],
		[{ title: 'Pi session', body: 'Pi needs your answer to continue.' }]
	]);

	send(changed('failed'));
	expect(notifier.notify).toHaveBeenLastCalledWith({ title: 'Fix the login bug', body: 'Pi exited unexpectedly.' });
});

test('notifies when a session out of view stops responding', () => {
	const { attention, notifier, send } = setup([changed('running')]);
	attention.view('session-3');

	send(changed('not_responding'));

	expect(notifier.notify).toHaveBeenCalledWith({ title: 'Fix the login bug', body: 'Pi stopped responding.' });
});

describe('notification policy', () => {
	test('notifies a finished turn only when the policy is all', () => {
		let policy: NotificationPolicy = 'attention';
		const { notifier, send } = setup([changed('idle')], () => policy);

		send(changed('running'), changed('idle'));
		expect(notifier.notify).not.toHaveBeenCalled();

		policy = 'all';
		send(changed('running'), changed('idle'));
		expect(notifier.notify).toHaveBeenCalledWith({ title: 'Fix the login bug', body: 'Pi finished its turn.' });
	});

	test('does not report an interrupted run as a finished turn', () => {
		const { notifier, send } = setup([changed('idle')], () => 'all');
		send(changed('running'), interrupted(), changed('idle'));
		expect(notifier.notify).not.toHaveBeenCalled();

		send(changed('running'), changed('idle'));
		expect(notifier.notify).toHaveBeenCalledWith({ title: 'Fix the login bug', body: 'Pi finished its turn.' });
	});

	test('notifies nothing and shows no badge while the policy is off', () => {
		let policy: NotificationPolicy = 'off';
		const { attention, notifier, send } = setup([changed('running')], () => policy);

		send(changed('waiting'), question('ask-1'), changed('failed'));
		attention.needs(1);
		expect(notifier.notify).not.toHaveBeenCalled();

		policy = 'attention';
		attention.needs(1);
		policy = 'off';
		attention.needs(1);
		expect(notifier.setBadgeCount.mock.calls).toEqual([[1], [undefined]]);
	});
});

/** A Claude Code session's status change. */
function claude(status: SessionStatus, name: string | null = null): ServerEvent {
	return changed(status, name, 'session-1', 'claude');
}

describe('a Claude Code session', () => {
	test('names Claude Code when it waits or finishes', () => {
		const { notifier, send } = setup([workspace(), claude('idle')], () => 'all');

		send(claude('waiting'));
		send(claude('running', 'Fix the login bug'), claude('idle', 'Fix the login bug'));

		expect(notifier.notify.mock.calls).toEqual([
			[{ title: 'Claude Code session in pau', body: 'Claude Code is waiting for your input.' }],
			[{ title: 'Fix the login bug', body: 'Claude Code finished its turn.' }]
		]);
	});
});

test('notifies a session shown in an unfocused window', () => {
	const { attention, notifier, send } = setup();
	attention.view('session-1');
	attention.focus(false);

	send(changed('waiting'));

	expect(notifier.notify).toHaveBeenCalledOnce();
});

test('does not notify for the session the operator is looking at', () => {
	const { attention, notifier, send } = setup();
	attention.view('session-1');

	send(changed('waiting'), question('ask-1'), changed('failed'));

	expect(notifier.notify).not.toHaveBeenCalled();
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

test('badges the icon with the sessions in Needs you, whether or not they are in view', () => {
	const { attention, notifier } = setup();
	attention.view('session-1');

	attention.needs(1);
	attention.needs(1);
	attention.focus(false);
	attention.needs(2);
	attention.view(undefined);
	attention.needs(0);

	expect(notifier.setBadgeCount.mock.calls).toEqual([[1], [2], [undefined]]);
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
