import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { ClaudeProcessRegistry, discoverClaude, type ClaudeProcess, type EventFrame } from '../src/index.js';

const fakeClaude = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const temporaryDirectories: string[] = [];
const registries: ClaudeProcessRegistry[] = [];

afterEach(async () => {
	await Promise.all(registries.splice(0).map((registry) => registry.stopAll()));
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('Claude turn interruption', () => {
	it.each([
		['before output', 'before-output', undefined],
		['during output', 'during-output', 'text.delta'],
		['during a tool event', 'during-tool', 'tool.started']
	] as const)('interrupts %s and accepts a follow-up prompt', async (_label, stage, waitForEvent) => {
		const process = await startFake({ FAKE_CLAUDE_INTERRUPT_STAGE: stage });
		const events: EventFrame[] = [];
		let resolveEvent: (() => void) | undefined;
		const eventSeen = new Promise<void>((resolve) => {
			resolveEvent = resolve;
		});
		const turn = process.prompt('Long task', {
			onEvent: (event) => {
				events.push(event);
				if (event.event === waitForEvent) resolveEvent?.();
			}
		});

		if (waitForEvent) await eventSeen;
		const interrupted = await process.interrupt();

		await expect(turn).resolves.toEqual(interrupted);
		expect(interrupted).toMatchObject({ status: 'interrupted', sessionId: 'session-interrupt' });
		expect(events.at(-1)).toMatchObject({ event: 'turn.completed', payload: { status: 'interrupted' } });
		expect(events.map((event) => event.event)).toEqual([...(waitForEvent ? [waitForEvent] : []), 'turn.completed']);
		await expect(process.prompt('Follow up')).resolves.toMatchObject({ status: 'completed', result: 'Done' });
		expect(process.state).toBe('running');
	});

	it('times out an ignored interrupt without misreporting process failure', async () => {
		const process = await startFake({ FAKE_CLAUDE_INTERRUPT_BEHAVIOR: 'ignore' }, 40);
		const turn = process.prompt('Keep running');

		await expect(process.interrupt()).rejects.toMatchObject({
			name: 'ClaudeInterruptError',
			code: 'interrupt_timeout'
		});
		await expect(turn).resolves.toMatchObject({ status: 'completed', result: 'Turn completed without interruption' });
		expect(process.state).toBe('running');
	});

	it('reports a process crash separately from interruption', async () => {
		const process = await startFake({ FAKE_CLAUDE_INTERRUPT_BEHAVIOR: 'crash' });
		const turn = process.prompt('Crash during this turn');
		const turnFailure = expect(turn).rejects.toMatchObject({ name: 'ClaudePromptError', code: 'process_exited' });

		await expect(process.interrupt()).rejects.toMatchObject({ name: 'ClaudePromptError', code: 'process_exited' });
		await turnFailure;
		await expect(process.exit).resolves.toMatchObject({ code: 24, expected: false });
		expect(process.state).toBe('failed');
	});

	it('rejects interruption when no turn is active', async () => {
		const process = await startFake();

		await expect(process.interrupt()).rejects.toMatchObject({ name: 'ClaudeInterruptError', code: 'no_active_turn' });
	});
});

async function startFake(environment: NodeJS.ProcessEnv = {}, interruptTimeoutMs = 500): Promise<ClaudeProcess> {
	const cwd = await mkdtemp(join(tmpdir(), 'pau-claude-interrupt-'));
	temporaryDirectories.push(cwd);
	const registry = new ClaudeProcessRegistry();
	registries.push(registry);
	return registry.start({
		discovery: await discoverClaude({ executablePath: fakeClaude }),
		cwd,
		env: { ...globalThis.process.env, FAKE_CLAUDE_MODE: 'interrupt', ...environment },
		interruptTimeoutMs
	});
}
