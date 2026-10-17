import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionToolContext,
	RegisteredCommand,
	ToolDefinition
} from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildClaudeArguments, createClaudePiExtension } from '../src/pi-extension.js';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const fakeClaude = join(packageRoot, 'test/fixtures/fake-claude.mjs');
const temporaryDirectories: string[] = [];
const shutdownHandlers: Array<() => Promise<void> | void> = [];

afterEach(async () => {
	await Promise.all(shutdownHandlers.splice(0).map((handler) => handler()));
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('Claude Pi extension', () => {
	it('builds native and safe arguments for every execution profile', () => {
		const native = buildClaudeArguments('work', { configurationMode: 'native', maxTurns: 12, maxBudgetUsd: 1.5 });
		expect(native).toContain('acceptEdits');
		expect(native).not.toContain('--setting-sources');
		expect(native.slice(-4)).toEqual(['--max-turns', '12', '--max-budget-usd', '1.5']);

		const safeReview = buildClaudeArguments('review', { configurationMode: 'safe', maxTurns: 4 });
		expect(safeReview).toEqual(
			expect.arrayContaining([
				'--safe-mode',
				'plan',
				'--permission-prompts',
				'none',
				'Read,Grep,Glob,WebFetch,WebSearch'
			])
		);

		const checks = buildClaudeArguments('review-with-checks', {
			configurationMode: 'native',
			maxTurns: 8,
			checkCommands: ['pnpm check', 'git diff']
		});
		expect(checks).toEqual(
			expect.arrayContaining([
				'dontAsk',
				'Read,Grep,Glob,WebFetch,WebSearch,Bash',
				'Bash(pnpm check:*),Bash(git diff:*)'
			])
		);
	});

	it('exercises every command and both delegation states against fake Claude', async () => {
		const cwd = await temporaryDirectory();
		const harness = createHarness(cwd, { FAKE_CLAUDE_MODE: 'stream' });

		await harness.startSession();
		expect(harness.activeTools).not.toContain('claude_delegate');

		await harness.command('claude-discover');
		await harness.command('claude-start', 'work');
		await harness.command('claude-status');
		await harness.command('claude-stop');
		await harness.command('claude-new', 'review');
		await harness.command('claude-stop');
		await harness.command('claude-resume', 'session-explicit work');
		await harness.command('claude-work', 'Implement the fixture');
		await harness.command('claude-review', 'Review the fixture');
		await harness.command('claude-review-checks', 'Check the fixture');

		await harness.command('claude-delegation', 'enable');
		expect(harness.activeTools).toContain('claude_delegate');
		const enabledResult = await harness.executeTool({ task: 'Summarize the fixture', profile: 'review' });
		expect(enabledResult.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Done') });
		expect(enabledResult.details).toMatchObject({
			profile: 'review',
			completion: { status: 'completed', sessionId: 'session-explicit' },
			truncated: false
		});

		await harness.command('claude-delegation', 'disable');
		expect(harness.activeTools).not.toContain('claude_delegate');
		await expect(harness.executeTool({ task: 'Must not run' })).rejects.toThrow('operator must enable it');

		await harness.command('claude-stop');
		expect(harness.appendedEntries.at(-1)).toEqual({
			customType: 'pau-claude-session',
			data: { nativeSessionId: 'session-explicit' }
		});
		expect(harness.notifications.some((message) => message.includes('budget'))).toBe(true);
	});

	it('interrupts an active command and accepts a follow-up', async () => {
		const cwd = await temporaryDirectory();
		const harness = createHarness(cwd, { FAKE_CLAUDE_MODE: 'interrupt', FAKE_CLAUDE_INTERRUPT_STAGE: 'during-tool' });
		await harness.startSession();

		const active = harness.command('claude-work', 'Long task');
		await vi.waitFor(() => {
			expect(harness.notifications).toContain('Claude started Read');
		});
		await harness.command('claude-interrupt');
		await active;
		await harness.command('claude-work', 'Follow-up task');

		expect(harness.messages.at(-1)?.content).toContain('Done');
	});

	it('denies permission prompts that the direct transport cannot forward', async () => {
		const cwd = await temporaryDirectory();
		const harness = createHarness(cwd, { FAKE_CLAUDE_MODE: 'permission' });
		await harness.startSession();

		await harness.command('claude-work', 'Request an interactive permission');

		expect(harness.messages.at(-1)).toMatchObject({
			content: 'Permission request denied without operator input',
			details: { completion: { status: 'failed' } }
		});
	});

	it('bounds the result returned to the Pi model', async () => {
		const cwd = await temporaryDirectory();
		const harness = createHarness(cwd, { FAKE_CLAUDE_MODE: 'stream', FAKE_CLAUDE_RESULT: 'x'.repeat(9_000) });
		await harness.startSession();
		await harness.command('claude-delegation', 'enable');

		const result = await harness.executeTool({ task: 'Return a long result' });

		expect(result.content[0]).toMatchObject({
			type: 'text',
			text: expect.stringContaining('truncated at 8000 characters')
		});
		expect(result.details).toMatchObject({ truncated: true });
	});

	it('restores only the native ID and requires explicit resume after restart', async () => {
		const cwd = await temporaryDirectory();
		const harness = createHarness(cwd, { FAKE_CLAUDE_MODE: 'stream' }, [
			{ type: 'custom', customType: 'pau-claude-session', data: { nativeSessionId: 'session-recorded' } }
		]);
		await harness.startSession();

		await harness.command('claude-status');
		expect(harness.notifications.at(-1)).toContain('Claude stopped; recorded session session-recorded');
		await harness.command('claude-resume');
		await harness.command('claude-work', 'Continue explicitly');
		expect(harness.messages.at(-1)?.details).toMatchObject({ completion: { sessionId: 'session-recorded' } });
	});

	it('stops its child on reload and session shutdown', async () => {
		const cwd = await temporaryDirectory();
		const pidFile = join(cwd, 'claude.pid');
		const harness = createHarness(cwd, { FAKE_CLAUDE_MODE: 'stream', FAKE_CLAUDE_PID_FILE: pidFile });
		await harness.startSession();
		await harness.command('claude-start');
		let pid = 0;
		await vi.waitFor(async () => {
			pid = Number(await readFile(pidFile, 'utf8'));
			expect(pid).toBeGreaterThan(0);
		});

		await harness.shutdown('reload');
		expect(isProcessAlive(pid)).toBe(false);
		await harness.shutdown('quit');
	});

	it('loads from an isolated Pi agent directory', async () => {
		const agentDirectory = await temporaryDirectory();
		const commandNames = await loadWithPi(agentDirectory);

		expect(commandNames).toEqual(
			expect.arrayContaining([
				'claude-discover',
				'claude-start',
				'claude-new',
				'claude-resume',
				'claude-work',
				'claude-review',
				'claude-review-checks',
				'claude-status',
				'claude-interrupt',
				'claude-stop',
				'claude-delegation'
			])
		);
	}, 15_000);
});

type SessionEntryFixture = { type: string; customType?: string; data?: unknown };

function createHarness(cwd: string, environment: NodeJS.ProcessEnv, branch: SessionEntryFixture[] = []) {
	const commands = new Map<string, Omit<RegisteredCommand, 'name' | 'sourceInfo'>>();
	const eventHandlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
	const tools = new Map<string, ToolDefinition>();
	const notifications: string[] = [];
	const messages: Array<{ content: string; details?: unknown }> = [];
	const appendedEntries: Array<{ customType: string; data: unknown }> = [];
	let activeTools = ['read', 'bash'];

	const pi = {
		registerCommand(name: string, command: Omit<RegisteredCommand, 'name' | 'sourceInfo'>) {
			commands.set(name, command);
		},
		registerTool(tool: ToolDefinition) {
			tools.set(tool.name, tool);
		},
		on(event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) {
			const handlers = eventHandlers.get(event) ?? [];
			handlers.push(handler);
			eventHandlers.set(event, handlers);
			if (event === 'session_shutdown') {
				shutdownHandlers.push(() => handler({ type: event, reason: 'quit' }, context) as Promise<void>);
			}
			return () => {};
		},
		appendEntry(customType: string, data: unknown) {
			appendedEntries.push({ customType, data });
		},
		sendMessage(message: { content: string; details?: unknown }) {
			messages.push(message);
		},
		getActiveTools() {
			return [...activeTools];
		},
		setActiveTools(names: string[]) {
			activeTools = [...names];
		}
	} as unknown as ExtensionAPI;

	const context = {
		cwd,
		mode: 'tui',
		hasUI: true,
		ui: {
			notify(message: string) {
				notifications.push(message);
			}
		},
		sessionManager: {
			getBranch() {
				return branch;
			}
		}
	} as unknown as ExtensionCommandContext & ExtensionToolContext;

	createClaudePiExtension({
		executablePath: fakeClaude,
		maxTurns: 7,
		maxBudgetUsd: 0.5,
		env: { ...process.env, ...environment }
	})(pi);

	return {
		notifications,
		messages,
		appendedEntries,
		get activeTools() {
			return activeTools;
		},
		async command(name: string, args = '') {
			const registered = commands.get(name);
			if (!registered) throw new Error(`Missing command: ${name}`);
			await registered.handler(args, context);
		},
		async executeTool(parameters: { task: string; profile?: 'work' | 'review' | 'review-with-checks' }) {
			const tool = tools.get('claude_delegate');
			if (!tool) throw new Error('Missing Claude delegation tool');
			return tool.execute('call-1', parameters, new AbortController().signal, undefined, context);
		},
		async startSession() {
			for (const handler of eventHandlers.get('session_start') ?? []) {
				await handler({ type: 'session_start', reason: 'startup' }, context);
			}
		},
		async shutdown(reason: 'reload' | 'quit') {
			for (const handler of eventHandlers.get('session_shutdown') ?? []) {
				await handler({ type: 'session_shutdown', reason }, context);
			}
		}
	};
}

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'pau-claude-pi-'));
	temporaryDirectories.push(directory);
	return directory;
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function loadWithPi(agentDirectory: string): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const child = spawn('pi', ['--mode', 'rpc', '--no-session', '--extension', packageRoot], {
			cwd: packageRoot,
			env: { ...process.env, PI_CODING_AGENT_DIR: agentDirectory, PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1' },
			stdio: ['pipe', 'pipe', 'pipe']
		});
		let stdout = '';
		let stderr = '';
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			reject(new Error(`Pi load timed out: ${stderr}`));
		}, 10_000);

		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString('utf8');
		});
		child.stdout.on('data', (chunk: Buffer) => {
			stdout += chunk.toString('utf8');
			const lines = stdout.split('\n');
			stdout = lines.pop() ?? '';
			for (const line of lines) {
				const record = JSON.parse(line) as {
					id?: string;
					success?: boolean;
					data?: { commands?: Array<{ name: string }> };
					error?: string;
				};
				if (record.id !== 'commands') continue;
				clearTimeout(timer);
				child.stdin.end();
				if (!record.success) {
					reject(new Error(record.error ?? `Pi failed to load extension: ${stderr}`));
					return;
				}
				resolve(record.data?.commands?.map((command) => command.name) ?? []);
			}
		});
		child.once('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.stdin.write('{"id":"commands","type":"get_commands"}\n');
	});
}
