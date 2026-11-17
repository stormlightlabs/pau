import { describe, expect, test } from 'vitest';

import { bayFixtures } from '../fixtures/bay';
import {
	attentionKind,
	baySection,
	bayStateLine,
	displayStatus,
	matchesBayFilter,
	needsOperator,
	nextAttentionSession
} from '../lib/session-bay';
import type { SessionStatus } from '../lib/types/session';

const sessions = bayFixtures.busy.flatMap((workspace) => workspace.sessions);
const byId = (id: string) => sessions.find((session) => session.id === id)!;

describe('baySection', () => {
	test.each<[SessionStatus, string]>([
		['waiting', 'needs'],
		['failed', 'needs'],
		['not_responding', 'needs'],
		['starting', 'running'],
		['running', 'running'],
		['stopping', 'running'],
		['idle', 'settled'],
		['stopped', 'settled']
	])('racks a %s session in %s', (status, section) => {
		expect(baySection({ status })).toBe(section);
	});

	// The store keeps the agent's status while a dialog waits and sets only `attention`.
	test.each<SessionStatus>(['starting', 'running', 'idle'])(
		'racks a %s session with a pending dialog in needs',
		(status) => {
			expect(baySection({ status, attention: 'An extension is waiting for your answer.' })).toBe('needs');
			expect(displayStatus({ status, attention: 'An extension is waiting for your answer.' })).toBe('waiting');
		}
	);

	test('racks a failed session the operator restarted in settled, still shown as failed', () => {
		const restarted = { status: 'failed' as const, restarted: true };
		expect(baySection(restarted)).toBe('settled');
		expect(needsOperator(restarted)).toBe(false);
		expect(displayStatus(restarted)).toBe('failed');
	});

	test('keeps a failure as the shown state over a pending dialog', () => {
		expect(displayStatus({ status: 'failed', attention: 'An extension is waiting for your answer.' })).toBe('failed');
	});
});

describe('bayStateLine', () => {
	test('shows what a waiting session asks, in the waiting tone', () => {
		expect(bayStateLine(byId('sandbox-pi'))).toEqual({
			text: 'Allow write to crates/server/src/sessions.rs?',
			tone: 'waiting',
			mono: false
		});
	});

	test('shows the permission question of a running session', () => {
		const session = { ...byId('sandbox-pi'), status: 'running' as const, attention: 'An extension is waiting.' };
		expect(bayStateLine(session)).toEqual({
			text: 'Allow write to crates/server/src/sessions.rs?',
			tone: 'waiting',
			mono: false
		});
	});

	test('shows a failure with its reason in the danger tone', () => {
		expect(bayStateLine(byId('pau-pty'))).toEqual({
			text: 'Failed: srt exited with status 1',
			tone: 'danger',
			mono: false
		});
	});

	test('names the agent that stopped responding', () => {
		expect(bayStateLine(byId('pau-rpc'))).toMatchObject({ text: 'Pi is not responding', tone: 'warning' });
	});

	test('shows the command a running session runs, in the code face', () => {
		expect(bayStateLine(byId('audit-drain'))).toEqual({ text: 'cargo test -p pau-core audit', mono: true });
	});

	test('reads settled sessions plainly', () => {
		expect(bayStateLine(byId('pau-themes')).text).toBe('Idle');
		expect(bayStateLine(byId('pau-zellij')).text).toBe('Stopped');
		expect(bayStateLine(byId('pau-models')).text).toBe('Starting Claude Code');
	});
});

describe('matchesBayFilter', () => {
	test('matches every word in any field, ignoring case', () => {
		expect(matchesBayFilter('AUDIT drain', ['Audit log shutdown drain', 'Claude Code', 'pau-audit'])).toBe(true);
		expect(matchesBayFilter('claude audit', ['Audit log shutdown drain', 'Claude Code', 'pau-audit'])).toBe(true);
		expect(matchesBayFilter('pi audit', ['Audit log shutdown drain', 'Claude Code', 'pau-audit'])).toBe(false);
	});

	test('matches everything while the filter is blank', () => {
		expect(matchesBayFilter(' '.repeat(3), ['anything'])).toBe(true);
	});
});

describe('attentionKind', () => {
	test.each<[Parameters<typeof attentionKind>[0], ReturnType<typeof attentionKind>]>([
		[{ status: 'waiting' }, 'waiting'],
		[{ status: 'not_responding' }, 'waiting'],
		[{ status: 'running', attention: 'An extension is waiting for your answer.' }, 'waiting'],
		[{ status: 'failed' }, 'failed'],
		[{ status: 'failed', attention: 'An extension is waiting for your answer.' }, 'failed'],
		[{ status: 'idle', unseen: true }, 'unread'],
		[{ status: 'failed', restarted: true, unseen: true }, 'unread'],
		[{ status: 'idle' }, undefined],
		[{ status: 'running' }, undefined],
		[{ status: 'failed', restarted: true }, undefined]
	])('marks %o as %s', (session, kind) => {
		expect(attentionKind(session)).toBe(kind);
	});
});

describe('nextAttentionSession', () => {
	const rack = [
		{ id: 'unread', status: 'idle', unseen: true },
		{ id: 'quiet', status: 'running' },
		{ id: 'failed', status: 'failed' },
		{ id: 'asking', status: 'running', attention: 'An extension is waiting for your answer.' },
		{ id: 'waiting', status: 'waiting' }
	] as const;

	test('visits waiting sessions first, then failed, then unread, in bay order', () => {
		const visited: (string | undefined)[] = [];
		let active: string | undefined = 'quiet';
		for (let step = 0; step < 4; step += 1) {
			active = nextAttentionSession(rack, active);
			visited.push(active);
		}
		expect(visited).toEqual(['asking', 'waiting', 'failed', 'unread']);
	});

	test('wraps past the last marked session to the first', () => {
		expect(nextAttentionSession(rack, 'unread')).toBe('asking');
	});

	test('opens the first marked session when no session is open', () => {
		expect(nextAttentionSession(rack, undefined)).toBe('asking');
	});

	test('finds nothing when no other session is marked', () => {
		expect(nextAttentionSession([{ id: 'quiet', status: 'idle' }], 'quiet')).toBeUndefined();
		expect(nextAttentionSession([], undefined)).toBeUndefined();
		expect(nextAttentionSession([{ id: 'waiting', status: 'waiting' }], 'waiting')).toBeUndefined();
	});
});
