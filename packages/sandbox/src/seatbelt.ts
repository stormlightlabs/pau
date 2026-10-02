import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import type { PreloadDenial } from './preload.ts';

/** A macOS Seatbelt refusal with the process that caused it. */
export type SeatbeltDenial = PreloadDenial & { process: { name: string; pid: number } };

const VIOLATION = /Sandbox:\s+(.+)\((\d+)\)\s+deny\(\d+\)\s+(\S+)(?:\s+(.*))?$/;

/** Parse the file and outbound-network operations Pau can explain to a caller. */
export function parseSeatbeltDenial(line: string): SeatbeltDenial | undefined {
	const match = line.match(VIOLATION);
	if (!match) return undefined;
	const name = match[1]!;
	const pid = Number(match[2]);
	const action = match[3]!;
	if (!Number.isSafeInteger(pid) || pid < 1) return undefined;
	const target = (match[4] ?? 'unknown destination').trim();
	const process = { name: name.trim(), pid };

	if (action.startsWith('file-read')) return { operation: 'read', kind: 'file', target, process };
	if (action === 'file-write-create') return { operation: 'create', kind: 'file', target, process };
	if (action.startsWith('file-write')) return { operation: 'write', kind: 'file', target, process };
	if (action === 'network-outbound') {
		return { operation: 'connect', kind: target.startsWith('/') ? 'unix' : 'tcp', target, process };
	}
	return undefined;
}

/**
 * Stream Seatbelt denials for one sandbox-runtime attribution key.
 *
 * sandbox-runtime writes the attribution key into every Seatbelt deny rule, so
 * descendants inherit the same key while the denial line still names the
 * process and PID that made the system call. `/usr/bin/log` applies the exact
 * key predicate before Pau parses a line; denials from another sandboxed
 * session cannot enter this buffer.
 */
export class SeatbeltDenialLog {
	readonly #process: ChildProcess | undefined;
	readonly #lines: Interface | undefined;
	readonly #denials: SeatbeltDenial[] = [];
	readonly #waiters = new Set<() => void>();

	constructor(commandId: string, platform = process.platform) {
		if (platform !== 'darwin') return;
		const key = `CMD64_${Buffer.from(commandId).toString('base64')}_END_`;
		const child = spawn(
			'/usr/bin/log',
			['stream', '--predicate', `eventMessage CONTAINS ${JSON.stringify(key)}`, '--style', 'compact'],
			{ stdio: ['ignore', 'pipe', 'pipe'] }
		);
		this.#process = child;
		child.stderr?.resume();
		child.on('error', () => {
			for (const resolve of this.#waiters) resolve();
			this.#waiters.clear();
		});
		this.#lines = createInterface({ input: child.stdout! });
		this.#lines.on('line', (line) => {
			const denial = parseSeatbeltDenial(line);
			if (!denial) return;
			this.#denials.push(denial);
			if (this.#denials.length > 256) this.#denials.splice(0, this.#denials.length - 256);
			for (const resolve of this.#waiters) resolve();
			this.#waiters.clear();
		});
	}

	/** Return and clear reports, briefly waiting for unified logging on a failed call. */
	async take(waitMilliseconds = 0): Promise<SeatbeltDenial[]> {
		if (this.#process && this.#denials.length === 0 && waitMilliseconds > 0) {
			await new Promise<void>((resolve) => {
				const timer = setTimeout(done, waitMilliseconds);
				const self = this;
				function done(): void {
					clearTimeout(timer);
					self.#waiters.delete(done);
					resolve();
				}
				this.#waiters.add(done);
			});
		}
		return this.#denials.splice(0);
	}

	/** Stop reading the unified log without affecting the sandboxed process. */
	stop(): void {
		this.#lines?.close();
		this.#process?.kill('SIGTERM');
		for (const resolve of this.#waiters) resolve();
		this.#waiters.clear();
	}
}
