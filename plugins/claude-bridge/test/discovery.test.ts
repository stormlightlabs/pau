import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
	CLAUDE_CAPABILITIES,
	LATEST_VERIFIED_CLAUDE_VERSION,
	MIN_SUPPORTED_CLAUDE_VERSION,
	ClaudeDiscoveryError,
	discoverClaude
} from '../src/index.js';

const fakeClaude = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const fixtures = fileURLToPath(new URL('./fixtures', import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('Claude discovery', () => {
	it('uses a configured executable path and reports capabilities', async () => {
		const result = await discoverClaude({ executablePath: fakeClaude });

		expect(result).toEqual({
			executablePath: fakeClaude,
			version: { raw: '2.1.281', major: 2, minor: 1, patch: 281 },
			capabilities: CLAUDE_CAPABILITIES,
			compatibility: 'verified'
		});
	});

	it('finds the claude executable on PATH', async () => {
		const directory = await makeTemporaryDirectory();
		const executablePath = join(directory, 'claude');
		await symlink(fakeClaude, executablePath);

		const result = await discoverClaude({
			env: { ...process.env, PATH: `${directory}${delimiter}${process.env.PATH ?? ''}` }
		});

		expect(result.executablePath).toBe(executablePath);
		expect(result.version.raw).toBe('2.1.281');
	});

	it('reports a missing configured executable', async () => {
		const executablePath = join(await makeTemporaryDirectory(), 'missing-claude');

		await expectDiscoveryError(discoverClaude({ executablePath }), 'not_found', executablePath);
	});

	it('reports a missing PATH executable', async () => {
		await expectDiscoveryError(discoverClaude({ env: { ...process.env, PATH: '' } }), 'not_found');
	});

	it('rejects a non-executable file on PATH', async () => {
		const directory = await makeTemporaryDirectory();
		const executablePath = join(directory, 'claude');
		await writeFile(executablePath, "#!/bin/sh\necho '2.1.281 (Claude Code)'\n");
		await chmod(executablePath, 0o644);

		await expectDiscoveryError(
			discoverClaude({ env: { ...process.env, PATH: directory } }),
			'not_executable',
			executablePath
		);
	});

	it('accepts the floor and latest release fixtures', async () => {
		for (const [file, expectedVersion] of [
			['claude-2.1.259.json', MIN_SUPPORTED_CLAUDE_VERSION],
			['claude-2.1.281.json', LATEST_VERIFIED_CLAUDE_VERSION]
		] as const) {
			const fixture = JSON.parse(await readFile(join(fixtures, file), 'utf8')) as { versionOutput: string };
			const result = await discoverClaude({
				executablePath: fakeClaude,
				env: { ...process.env, FAKE_CLAUDE_VERSION: fixture.versionOutput }
			});

			expect(result.version.raw).toBe(expectedVersion);
			expect(result.compatibility).toBe('verified');
			expect(result.warning).toBeUndefined();
		}
	});

	it('rejects a release below the compatibility floor', async () => {
		const error = await expectDiscoveryError(
			discoverClaude({
				executablePath: fakeClaude,
				env: { ...process.env, FAKE_CLAUDE_VERSION: '2.1.258 (Claude Code)' }
			}),
			'unsupported_version',
			fakeClaude
		);
		expect(error.version?.raw).toBe('2.1.258');
	});

	it('allows a newer release with a warning after its capability handshake', async () => {
		const result = await discoverClaude({
			executablePath: fakeClaude,
			env: { ...process.env, FAKE_CLAUDE_VERSION: '3.0.0 (Claude Code)' }
		});

		expect(result.compatibility).toBe('newer-unverified');
		expect(result.warning).toContain(LATEST_VERIFIED_CLAUDE_VERSION);
	});

	it('rejects a newer release when its capability handshake is incomplete', async () => {
		const error = await expectDiscoveryError(
			discoverClaude({
				executablePath: fakeClaude,
				env: {
					...process.env,
					FAKE_CLAUDE_VERSION: '3.0.0 (Claude Code)',
					FAKE_CLAUDE_HELP: '--print\n--input-format\n--output-format'
				}
			}),
			'unsupported_version',
			fakeClaude
		);
		expect(error.message).toContain('--resume');
	});
});

async function makeTemporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'pau-claude-discovery-'));
	temporaryDirectories.push(directory);
	return directory;
}

async function expectDiscoveryError(
	promise: Promise<unknown>,
	code: ClaudeDiscoveryError['code'],
	executablePath?: string
): Promise<ClaudeDiscoveryError> {
	try {
		await promise;
		throw new Error('Expected Claude discovery to fail');
	} catch (error) {
		expect(error).toBeInstanceOf(ClaudeDiscoveryError);
		const discoveryError = error as ClaudeDiscoveryError;
		expect(discoveryError.code).toBe(code);
		expect(discoveryError.executablePath).toBe(executablePath);
		return discoveryError;
	}
}
