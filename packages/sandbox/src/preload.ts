import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** One failed operation observed by the Linux preload library. */
export type PreloadDenial = {
	operation: 'read' | 'write' | 'create' | 'rename' | 'connect';
	kind: 'file' | 'unix' | 'tcp';
	target: string;
};

const OPERATIONS = new Set<PreloadDenial['operation']>(['read', 'write', 'create', 'rename', 'connect']);
const KINDS = new Set<PreloadDenial['kind']>(['file', 'unix', 'tcp']);
const SIMPLE_ESCAPES: Record<string, number> = { t: 0x09, n: 0x0a, r: 0x0d, '\\': 0x5c };

function unescapeTarget(value: string): string | undefined {
	const bytes: number[] = [];
	for (let index = 0; index < value.length; index++) {
		const character = value[index];
		if (character !== '\\') {
			bytes.push(value.codePointAt(index) ?? 0);
			continue;
		}
		const escaped = value[++index];
		if (escaped === 'x') {
			const hex = value.slice(index + 1, index + 3);
			if (!/^[\da-f]{2}$/i.test(hex)) return undefined;
			bytes.push(Number.parseInt(hex, 16));
			index += 2;
			continue;
		}
		const byte = escaped === undefined ? undefined : SIMPLE_ESCAPES[escaped];
		if (byte === undefined) return undefined;
		bytes.push(byte);
	}
	return Buffer.from(bytes).toString('utf8');
}

/** Parse complete, versioned records and ignore malformed or partial lines. */
export function parsePreloadDenials(records: string): PreloadDenial[] {
	const denials: PreloadDenial[] = [];
	for (const line of records.split('\n')) {
		if (!line) continue;
		const [version, operation, kind, target, ...extra] = line.split('\t');
		if (
			version !== 'PAU1' ||
			target === undefined ||
			extra.length > 0 ||
			!OPERATIONS.has(operation as PreloadDenial['operation']) ||
			!KINDS.has(kind as PreloadDenial['kind'])
		) {
			continue;
		}
		const decoded = unescapeTarget(target);
		if (decoded !== undefined) {
			denials.push({
				operation: operation as PreloadDenial['operation'],
				kind: kind as PreloadDenial['kind'],
				target: decoded
			});
		}
	}
	return denials;
}

function defaultLibrary(): string {
	const profile = process.env.PAU_SANDBOX_PRELOAD_PROFILE === 'release' ? 'release' : 'debug';
	return fileURLToPath(new URL(`../../../target/${profile}/libpau_sandbox_denial_preload.so`, import.meta.url));
}

/** Resolve the built Linux library, with an explicit path for packaged builds. */
export function resolvePreloadLibrary(): string {
	const library = process.env.PAU_SANDBOX_DENIAL_PRELOAD ?? defaultLibrary();
	if (!path.isAbsolute(library) || !existsSync(library)) {
		throw new Error(
			`Linux sandbox denial preload library not found at ${library}. Build pau-sandbox-denial-preload or set PAU_SANDBOX_DENIAL_PRELOAD.`
		);
	}
	return library;
}

/**
 * Append the preload settings to the tool host's complete environment.
 *
 * The report file is advisory and contains no file contents or credentials.
 * It lives in the per-session temporary directory and is removed with it.
 */
export function configurePreloadEnvironment(env: Record<string, string>, tempDir: string): string | undefined {
	if (process.platform !== 'linux') return undefined;
	const report = path.join(tempDir, 'linux-denials.log');
	writeFileSync(report, '', { mode: 0o600 });
	env.LD_PRELOAD = resolvePreloadLibrary();
	env.PAU_SANDBOX_DENIAL_REPORT = report;
	return report;
}

/** Reads records appended after a request started without deleting shared data. */
export class PreloadDenialLog {
	readonly #file: string | undefined;

	constructor(file = process.env.PAU_SANDBOX_DENIAL_REPORT) {
		this.#file = file;
	}

	checkpoint(): number {
		if (!this.#file) return 0;
		try {
			return statSync(this.#file).size;
		} catch {
			return 0;
		}
	}

	readAfter(offset: number): PreloadDenial[] {
		return this.drainAfter(offset).denials;
	}

	/** Read a stable snapshot and return the offset for the next drain. */
	drainAfter(offset: number): { denials: PreloadDenial[]; nextOffset: number } {
		if (!this.#file) return { denials: [], nextOffset: 0 };
		try {
			const contents = readFileSync(this.#file);
			if (offset >= contents.length) return { denials: [], nextOffset: contents.length };
			return { denials: parsePreloadDenials(contents.subarray(offset).toString('utf8')), nextOffset: contents.length };
		} catch {
			return { denials: [], nextOffset: offset };
		}
	}
}
