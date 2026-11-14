import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PermissionController, type PermissionUi, type Verdict } from '../src/controller.ts';
import type { DecisionRecord, RequestEnvelope } from '../src/messages.ts';
import { loadPolicy, POLICY_FILE_ENV } from '../src/policy.ts';
import { createFixture, type Fixture, writePolicy } from './fixture.ts';

const fixture: Fixture = createFixture();
afterAll(() => rmSync(fixture.root, { recursive: true, force: true }));

type Dialog = { request: RequestEnvelope; options: string[]; signal?: AbortSignal; timeout?: number };

/**
 * A fake Pi UI. `answer` decides each dialog; returning a promise lets a test
 * hold a dialog open. Records arrive in `records`.
 */
function fakeUi(answer: (dialog: Dialog) => Promise<string | undefined> | string | undefined = () => {}) {
	const dialogs: Dialog[] = [];
	const records: DecisionRecord[] = [];
	const ui: PermissionUi = {
		async select(title, options, opts) {
			const dialog = { request: JSON.parse(title) as RequestEnvelope, options, ...opts };
			dialogs.push(dialog);
			// Pi resolves an aborted dialog as undefined.
			const aborted = new Promise<undefined>((resolve) =>
				opts.signal?.addEventListener('abort', () => resolve(undefined), { once: true })
			);
			return Promise.race([answer(dialog), aborted]);
		},
		setStatus(key, text) {
			expect(key).toBe('pau.permission');
			records.push(JSON.parse(text ?? '{}') as DecisionRecord);
		}
	};
	return { ui, dialogs, records };
}

function controller(options: Parameters<typeof writePolicy>[1] = {}): PermissionController {
	const file = writePolicy(fixture, options);
	return new PermissionController(
		() => loadPolicy({ [POLICY_FILE_ENV]: file }),
		() => {}
	);
}

const call = (toolName: string, input: Record<string, unknown>) => ({ toolName, toolCallId: randomUUID(), input });
const touch = (file = 'a.txt') => call('bash', { command: `touch ${file}` });

/** Opens a dialog that Pi expires after its timeout, and lets that time pass. */
async function expire(): Promise<{ verdict: Verdict; records: DecisionRecord[] }> {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	const { ui, dialogs, records } = fakeUi(
		({ timeout }) => new Promise((resolve) => setTimeout(() => resolve(undefined), timeout))
	);
	const pending = controller({ dialogTimeoutMs: 1000 }).handle(touch(), ui, undefined);
	await vi.waitUntil(() => dialogs.length === 1);
	await vi.advanceTimersByTimeAsync(1000);
	return { verdict: await pending, records };
}

describe('PermissionController', () => {
	it('allows silently and records the rule as the source', async () => {
		const { ui, dialogs, records } = fakeUi();
		const request = call('read', { path: 'README.md' });
		expect(await controller().handle(request, ui, undefined)).toBeUndefined();
		expect(dialogs).toHaveLength(0);
		expect(records).toEqual([
			{ version: 1, requestId: expect.any(String), toolCallId: request.toolCallId, outcome: 'allowed', source: 'rule' }
		]);
	});

	it('denies a protected read without a dialog', async () => {
		const { ui, dialogs, records } = fakeUi();
		const verdict = await controller().handle(call('read', { path: '.env' }), ui, undefined);
		expect(verdict).toEqual({ block: true, reason: 'Blocked by the Pau permission policy (protected).' });
		expect(dialogs).toHaveLength(0);
		expect(records[0]).toMatchObject({ outcome: 'denied', source: 'rule' });
	});

	it('sends a versioned envelope with the three decisions and the policy timeout', async () => {
		const { ui, dialogs, records } = fakeUi(() => JSON.stringify({ decision: 'allow_once' }));
		const request = call('read', { path: path.join(fixture.outside, 'notes.txt') });
		await controller({ dialogTimeoutMs: 120_000 }).handle(request, ui, undefined);
		const [dialog] = dialogs;
		expect(dialog?.options).toEqual(['allow_once', 'allow_session', 'deny']);
		expect(dialog?.timeout).toBe(120_000);
		expect(dialog?.request).toEqual({
			pau: 'permission',
			version: 1,
			requestId: records[0]?.requestId,
			toolCallId: request.toolCallId,
			tool: 'read',
			operation: 'read',
			paths: [{ path: path.join(fixture.outside, 'notes.txt'), access: 'read', outsideWorkspace: true }],
			matchedRule: { source: 'profile', pattern: '*', action: 'ask' },
			reason: 'outside_workspace',
			sessionScope: [{ surface: 'read', pattern: `${fixture.outside}/*` }]
		});
		expect(records[0]).toMatchObject({ outcome: 'allowed', source: 'operator' });
		expect(JSON.stringify(records)).not.toContain('notes.txt');
	});

	it('names the codemode call that made a nested call', async () => {
		const { ui, dialogs } = fakeUi(() => 'deny');
		const request = { ...call('mcp__docs__search', {}), parentToolCallId: 'codemode-1' };
		await controller().handle(request, ui, undefined);
		expect(dialogs[0]?.request).toMatchObject({ toolCallId: request.toolCallId, parentToolCallId: 'codemode-1' });
	});

	it('asks again after allow_once', async () => {
		const { ui, dialogs } = fakeUi(() => 'allow_once');
		const gate = controller();
		expect(await gate.handle(touch(), ui, undefined)).toBeUndefined();
		expect(await gate.handle(touch(), ui, undefined)).toBeUndefined();
		expect(dialogs).toHaveLength(2);
	});

	it('remembers allow_session for later matching calls only', async () => {
		const { ui, dialogs, records } = fakeUi(() => JSON.stringify({ decision: 'allow_session' }));
		const gate = controller();
		await gate.handle(touch('a.txt'), ui, undefined);
		await gate.handle(touch('b.txt'), ui, undefined);
		expect(dialogs).toHaveLength(1);
		expect(records.map((record) => record.source)).toEqual(['operator', 'session']);
		await gate.handle(call('bash', { command: 'rm a.txt' }), ui, undefined);
		expect(dialogs).toHaveLength(2);
	});

	it('forgets session approvals when the session starts again', async () => {
		const { ui, dialogs } = fakeUi(() => 'allow_session');
		const gate = controller();
		await gate.handle(touch(), ui, undefined);
		gate.reset();
		await gate.handle(touch(), ui, undefined);
		expect(dialogs).toHaveLength(2);
	});

	it('passes the operator reason to the agent on deny', async () => {
		const { ui, records } = fakeUi(() => JSON.stringify({ decision: 'deny', reason: 'Use the build script' }));
		const verdict = await controller().handle(touch(), ui, undefined);
		expect(verdict).toEqual({ block: true, reason: 'Denied by the operator: Use the build script' });
		expect(records[0]).toMatchObject({ outcome: 'denied', source: 'operator' });
	});

	it.each([
		['a cancelled dialog', undefined],
		['an unknown option', 'yes'],
		['an invalid JSON answer', JSON.stringify({ decision: 'allow_forever' })],
		['an answer with extra fields', JSON.stringify({ decision: 'allow_once', scope: 'all' })]
	])('denies %s', async (_label, value) => {
		const { ui, records } = fakeUi(() => value);
		expect(await controller().handle(touch(), ui, undefined)).toMatchObject({ block: true });
		expect(records[0]).toMatchObject({ outcome: 'denied', source: 'operator' });
	});

	it('drops a pending dialog on abort and records the abort', async () => {
		const abort = new AbortController();
		const { ui, dialogs, records } = fakeUi(() => {
			abort.abort();
			return new Promise(() => {});
		});
		const verdict = await controller().handle(touch(), ui, abort.signal);
		expect(dialogs[0]?.signal).toBe(abort.signal);
		expect(verdict).toEqual({ block: true, reason: expect.stringContaining('aborted') });
		expect(records[0]).toMatchObject({ outcome: 'denied', source: 'abort' });
	});

	it('denies a call queued behind an aborted run without a dialog', async () => {
		const abort = new AbortController();
		abort.abort();
		const { ui, dialogs, records } = fakeUi();
		await controller().handle(touch(), ui, abort.signal);
		expect(dialogs).toHaveLength(0);
		expect(records[0]).toMatchObject({ source: 'abort' });
	});

	describe('timeout', () => {
		afterEach(() => {
			vi.useRealTimers();
			vi.restoreAllMocks();
		});

		it('denies on timeout and records it', async () => {
			const { verdict, records } = await expire();
			expect(verdict).toEqual({ block: true, reason: expect.stringContaining('timed out') });
			expect(records[0]).toMatchObject({ outcome: 'denied', source: 'timeout' });
		});

		it('reports a timeout when the timer fires a millisecond early by the clock', async () => {
			let reads = 0;
			vi.spyOn(performance, 'now').mockImplementation(() => (reads++ === 0 ? 0 : 999));
			const { verdict, records } = await expire();
			expect(verdict).toEqual({ block: true, reason: expect.stringContaining('timed out') });
			expect(records[0]).toMatchObject({ outcome: 'denied', source: 'timeout' });
		});
	});

	it('shows one dialog at a time, in order', async () => {
		const answers: ((value: string) => void)[] = [];
		const { ui, dialogs } = fakeUi(
			() =>
				new Promise((resolve) => {
					answers.push(resolve);
				})
		);
		const gate = controller();
		const first = gate.handle(touch('first.txt'), ui, undefined);
		const second = gate.handle(touch('second.txt'), ui, undefined);
		await expect.poll(() => dialogs.length).toBe(1);
		expect(dialogs[0]?.request.command).toBe('touch first.txt');
		answers[0]?.('allow_once');
		await first;
		await expect.poll(() => dialogs.length).toBe(2);
		expect(dialogs[1]?.request.command).toBe('touch second.txt');
		answers[1]?.('deny');
		expect(await second).toMatchObject({ block: true });
	});

	it.each([
		['a missing policy file', () => loadPolicy({ [POLICY_FILE_ENV]: path.join(fixture.root, 'missing.json') })],
		['an unset variable', () => loadPolicy({})]
	])('blocks every call with %s', async (_label, load) => {
		const { ui, dialogs, records } = fakeUi(() => 'allow_once');
		const gate = new PermissionController(load, () => {});
		for (const request of [call('read', { path: 'README.md' }), touch()]) {
			const verdict = await gate.handle(request, ui, undefined);
			expect(verdict).toEqual({ block: true, reason: expect.stringContaining('policy unavailable') });
		}
		expect(dialogs).toHaveLength(0);
		expect(records.map((record) => record.source)).toEqual(['policy_error', 'policy_error']);
	});
});
