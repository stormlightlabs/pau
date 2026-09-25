import { chmod, copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClaudeProcessRegistry, discoverClaude, type ClaudeShutdownTimeouts } from '../src/index.js';

const fakeClaude = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const temporaryDirectories: string[] = [];
const registries: ClaudeProcessRegistry[] = [];
const shortTimeouts: ClaudeShutdownTimeouts = { protocolMs: 300, interruptMs: 100, terminateMs: 100, killMs: 500 };

afterEach(async () => {
	await Promise.all(registries.splice(0).map((registry) => registry.stopAll()));
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('Claude process lifecycle', () => {
	it('starts and gracefully stops the fake executable in paths containing spaces', async () => {
		const root = await makeTemporaryDirectory('pau claude lifecycle ');
		const executablePath = join(root, 'fake Claude executable.mjs');
		const cwd = join(root, 'selected working directory');
		const cwdReport = join(root, 'child-cwd.txt');
		await copyFile(fakeClaude, executablePath);
		await chmod(executablePath, 0o755);
		await mkdir(cwd);

		const discovery = await discoverClaude({ executablePath });
		const registry = makeRegistry();
		const process = await registry.start({ discovery, cwd, env: { ...processEnv(), FAKE_CLAUDE_CWD_FILE: cwdReport } });

		expect(process.cwd).toBe(cwd);
		expect(process.state).toBe('running');
		expect(process.pid).toBeTypeOf('number');
		expect(registry.get(process.id)).toBe(process);

		const exit = await process.stop();

		expect(exit).toEqual({ code: 0, signal: null, expected: true, shutdownStage: 'protocol' });
		expect(process.state).toBe('stopped');
		expect(process.exitInfo).toEqual(exit);
		expect(await readFile(cwdReport, 'utf8')).toBe(cwd);
		expect(registry.size).toBe(0);
	});

	it('escalates timed-out shutdown stages through SIGKILL', async () => {
		const root = await makeTemporaryDirectory('pau-claude-lifecycle-');
		const signalLog = join(root, 'signals.log');
		const readyFile = join(root, 'ready');
		const registry = makeRegistry();
		const process = await registry.start({
			discovery: await discoverClaude({ executablePath: fakeClaude }),
			cwd: root,
			env: {
				...processEnv(),
				FAKE_CLAUDE_MODE: 'ignore-shutdown',
				FAKE_CLAUDE_SIGNAL_LOG: signalLog,
				FAKE_CLAUDE_READY_FILE: readyFile
			},
			shutdownTimeouts: shortTimeouts
		});
		await waitForReadyFile(readyFile);

		const exit = await process.stop();

		expect(exit).toMatchObject({ code: null, signal: 'SIGKILL', expected: true, shutdownStage: 'kill' });
		expect(await readFile(signalLog, 'utf8')).toBe('SIGINT\nSIGTERM\n');
		expect(registry.size).toBe(0);
	});

	it('reports an unexpected exit and removes it from the live registry', async () => {
		const root = await makeTemporaryDirectory('pau-claude-lifecycle-');
		const registry = makeRegistry();
		const process = await registry.start({
			discovery: await discoverClaude({ executablePath: fakeClaude }),
			cwd: root,
			env: { ...processEnv(), FAKE_CLAUDE_MODE: 'unexpected-exit' }
		});

		const exit = await process.exit;

		expect(exit).toEqual({ code: 23, signal: null, expected: false, shutdownStage: null });
		expect(process.state).toBe('failed');
		expect(registry.get(process.id)).toBeUndefined();
		expect(registry.list()).toEqual([]);
	});

	it('escalates from structured-input shutdown to an interrupt', async () => {
		const root = await makeTemporaryDirectory('pau-claude-lifecycle-');
		const readyFile = join(root, 'ready');
		const registry = makeRegistry();
		const process = await registry.start({
			discovery: await discoverClaude({ executablePath: fakeClaude }),
			cwd: root,
			env: { ...processEnv(), FAKE_CLAUDE_MODE: 'interrupt-exit', FAKE_CLAUDE_READY_FILE: readyFile },
			shutdownTimeouts: shortTimeouts
		});
		await waitForReadyFile(readyFile);

		await expect(process.stop()).resolves.toMatchObject({ code: 0, expected: true, shutdownStage: 'interrupt' });
		expect(registry.size).toBe(0);
	});
});

function makeRegistry(): ClaudeProcessRegistry {
	const registry = new ClaudeProcessRegistry();
	registries.push(registry);
	return registry;
}

async function makeTemporaryDirectory(prefix: string): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

async function waitForReadyFile(path: string): Promise<void> {
	await vi.waitFor(async () => expect(await readFile(path, 'utf8')).toBe('ready'));
}

function processEnv(): NodeJS.ProcessEnv {
	return { ...process.env };
}
