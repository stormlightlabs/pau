import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, constants, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import type { TestProject } from 'vitest/node';

const repository = fileURLToPath(new URL('../../..', import.meta.url));
const binary = path.join(process.env.CARGO_TARGET_DIR ?? path.join(repository, 'target'), 'debug', 'pau-server');

/** Terminal editors that the full-screen program tests drive when they are installed. */
const EDITORS = ['vim', 'nvim', 'hx'] as const;

/** Finds an executable on the `PATH` the server's terminals inherit, as a shell would. */
async function findExecutable(name: string): Promise<string | null> {
	const directories = (process.env.PATH ?? '').split(path.delimiter);
	for (const directory of directories) {
		if (!directory) continue;
		const candidate = path.join(directory, name);
		try {
			await access(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Not in this directory.
		}
	}
	return null;
}

/**
 * Resolves with the address from the server's `server.started` log event,
 * which it writes after binding its listener. Rejects when the server exits
 * first or the deadline passes. The reader keeps draining standard output
 * afterwards so the server never blocks on a full pipe.
 */
function startedAddress(server: ChildProcessWithoutNullStreams, deadline: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error('pau-server did not start within 15 seconds.')),
			deadline - Date.now()
		);
		server.once('exit', (code, signal) => {
			clearTimeout(timer);
			const status = code === null ? `signal ${signal}` : `code ${code}`;
			reject(new Error(`pau-server exited with ${status} before it started.`));
		});
		createInterface({ input: server.stdout }).on('line', (line) => {
			let record: { fields?: { event?: unknown; address?: unknown } };
			try {
				record = JSON.parse(line);
			} catch {
				return;
			}
			if (record.fields?.event !== 'server.started' || typeof record.fields.address !== 'string') return;
			clearTimeout(timer);
			resolve(record.fields.address);
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
	const token = randomBytes(24).toString('base64url');
	// A token in the server's environment is readable by other processes, so
	// it arrives on standard input.
	const environment = { ...process.env };
	delete environment.PAU_API_TOKEN;
	const server = spawn(binary, ['--token-stdin'], {
		env: {
			...environment,
			// The server binds a port of its own choosing and reports it in its
			// `server.started` log event. A port picked here and passed on would
			// sit unbound until the server starts, free for another process.
			PAU_SERVER_ADDR: '127.0.0.1:0',
			RUST_LOG: 'pau_server=info',
			PAU_DATABASE_PATH: path.join(root, 'pau.db'),
			SHELL: '/bin/sh',
			ENV: '',
			BASH_SILENCE_DEPRECATION_WARNING: '1',
			PS1: 'pau$ '
		},
		stdio: ['pipe', 'pipe', 'inherit']
	});
	server.stdin.end(`${token}\n`);
	const stop = async () => {
		server.kill('SIGINT');
		await rm(root, { recursive: true, force: true });
	};

	// Any failure after the spawn stops the server, so a failed run leaves no
	// orphaned server or temporary database behind.
	let origin: string;
	let workspace: { id: string };
	try {
		origin = `http://${await startedAddress(server, Date.now() + 15_000)}`;
		const response = await fetch(`${origin}/api/workspaces`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ path: root, name: 'integration' })
		});
		if (!response.ok) {
			throw new Error(`Opening the integration workspace failed with HTTP ${response.status}.`);
		}
		workspace = (await response.json()) as { id: string };
	} catch (error) {
		await stop();
		throw error;
	}
	const editors = Object.fromEntries(
		await Promise.all(EDITORS.map(async (name) => [name, await findExecutable(name)] as const))
	) as Record<(typeof EDITORS)[number], string | null>;
	project.provide('pauApi', {
		connection: { apiOrigin: origin, token },
		workspaceId: workspace.id,
		workspacePath: root,
		editors
	});
	return stop;
}
