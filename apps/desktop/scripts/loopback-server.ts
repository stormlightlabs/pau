import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TestProject } from 'vitest/node';

const repository = fileURLToPath(new URL('../../..', import.meta.url));
const binary = path.join(process.env.CARGO_TARGET_DIR ?? path.join(repository, 'target'), 'debug', 'pau-server');

async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
		});
	});
}

/**
 * Starts the real loopback API for desktop integration tests with a temporary
 * database and workspace. Terminals run `/bin/sh` with a fixed prompt so shell
 * output is predictable. Run `cargo build -p pau-server` first.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
	const root = await mkdtemp(path.join(tmpdir(), 'pau-integration-'));
	const port = await freePort();
	const token = randomBytes(24).toString('base64url');
	const origin = `http://127.0.0.1:${port}`;
	const server = spawn(binary, [], {
		env: {
			...process.env,
			PAU_SERVER_ADDR: `127.0.0.1:${port}`,
			PAU_API_TOKEN: token,
			PAU_DATABASE_PATH: path.join(root, 'pau.db'),
			SHELL: '/bin/sh',
			ENV: '',
			BASH_SILENCE_DEPRECATION_WARNING: '1',
			PS1: 'pau$ '
		},
		stdio: ['ignore', 'ignore', 'inherit']
	});
	const stop = async () => {
		server.kill('SIGINT');
		await rm(root, { recursive: true, force: true });
	};

	const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
	const deadline = Date.now() + 15_000;
	for (;;) {
		if (server.exitCode !== null) throw new Error(`pau-server exited with code ${server.exitCode}.`);
		try {
			const health = await fetch(`${origin}/api/health`, { headers });
			if (health.ok) break;
		} catch {
			// The server is still binding its port.
		}
		if (Date.now() > deadline) {
			await stop();
			throw new Error('pau-server did not become healthy within 15 seconds.');
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	const response = await fetch(`${origin}/api/workspaces`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ path: root, name: 'integration' })
	});
	if (!response.ok) {
		await stop();
		throw new Error(`Opening the integration workspace failed with HTTP ${response.status}.`);
	}
	const workspace = (await response.json()) as { id: string };
	project.provide('pauApi', { connection: { apiOrigin: origin, token }, workspaceId: workspace.id });
	return stop;
}
