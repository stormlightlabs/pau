#!/usr/bin/env node
/**
 * Fixture process for the boundary matrix. Each invocation attempts one
 * operation, prints one JSON line, and exits 0 when the operation succeeded or
 * 1 when the operating system refused it.
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';

const [operation = '', first = '', second = ''] = process.argv.slice(2);

function finish(ok: boolean, detail: string): never {
	process.stdout.write(`${JSON.stringify({ operation, ok, detail })}\n`);
	process.exit(ok ? 0 : 1);
}

function errorCode(error: unknown): string {
	return String(error instanceof Error && 'code' in error ? error.code : error);
}

function connect(options: net.NetConnectOpts): void {
	const socket = net.connect(options);
	socket.setTimeout(2000);
	socket.once('connect', () => {
		socket.destroy();
		finish(true, 'connected');
	});
	socket.once('timeout', () => finish(false, 'timeout'));
	socket.once('error', (error) => finish(false, errorCode(error)));
}

switch (operation) {
	case 'read': {
		try {
			finish(true, readFileSync(first, 'utf8').slice(0, 64));
		} catch (error) {
			finish(false, errorCode(error));
		}
		break;
	}
	case 'write': {
		try {
			writeFileSync(first, 'probe\n');
			finish(true, 'written');
		} catch (error) {
			finish(false, errorCode(error));
		}
		break;
	}
	case 'symlink-write': {
		try {
			symlinkSync(second, first);
			writeFileSync(first, 'probe\n');
			finish(true, 'written through link');
		} catch (error) {
			finish(false, errorCode(error));
		}
		break;
	}
	case 'env': {
		const value = process.env[first];
		finish(value !== undefined, value === undefined ? 'unset' : 'set');
		break;
	}
	case 'tcp': {
		connect({ host: first, port: Number(second) });
		break;
	}
	case 'unix': {
		connect({ path: first });
		break;
	}
	case 'child-write': {
		const child = spawnSync('sh', ['-c', `echo child > "${first}"`], { encoding: 'utf8' });
		finish(child.status === 0, child.stderr.trim() || 'written by child');
		break;
	}
	case 'heartbeat': {
		// A detached grandchild keeps writing after this process exits. The harness
		// checks whether the sandbox tears it down with the command.
		const script = `setInterval(() => require('node:fs').appendFileSync(${JSON.stringify(first)}, '.'), 100)`;
		const child = spawn(process.execPath, ['-e', script], { detached: true, stdio: 'ignore' });
		child.unref();
		appendFileSync(first, 'start');
		setTimeout(() => finish(true, 'spawned'), 300);
		break;
	}
	default: {
		process.stderr.write(`unknown probe operation: ${operation}\n`);
		process.exit(2);
	}
}
