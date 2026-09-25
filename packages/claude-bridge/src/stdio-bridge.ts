#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

import { discoverClaude } from './discovery.js';
import { ClaudeProcessRegistry } from './lifecycle.js';
import {
	BRIDGE_PROTOCOL_VERSION,
	FrameDecoder,
	commandFrameSchema,
	encodeDiagnosticFrame,
	encodeProtocolFrame,
	type CommandFrame,
	type JsonValue,
	type ResponseFrame
} from './protocol.js';

/** Options accepted by the bridge's versioned stdio host. */
export type ClaudeStdioBridgeOptions = {
	readonly claudePath: string;
	readonly cwd: string;
	readonly nativeSessionId?: string;
};

/**
 * Run one Claude process behind the package's public command, event, and
 * diagnostic frames. The host is the only owner of Claude's native protocol.
 */
export async function runClaudeStdioBridge(options: ClaudeStdioBridgeOptions): Promise<void> {
	const registry = new ClaudeProcessRegistry();
	const discovery = await discoverClaude({ executablePath: options.claudePath });
	const process = options.nativeSessionId
		? await registry.resume({ discovery, cwd: options.cwd, nativeSessionId: options.nativeSessionId })
		: await registry.start({ discovery, cwd: options.cwd });
	const decoder = new FrameDecoder(commandFrameSchema);
	let promptActive = false;
	let stopping = false;

	const diagnostic = (level: 'debug' | 'info' | 'warn' | 'error', message: string): void => {
		globalThis.process.stderr.write(
			encodeDiagnosticFrame({ version: BRIDGE_PROTOCOL_VERSION, type: 'diagnostic', level, message })
		);
	};
	const respond = (frame: ResponseFrame): boolean => globalThis.process.stdout.write(encodeProtocolFrame(frame));
	const success = (id: string, result?: JsonValue): boolean => {
		return respond({
			version: BRIDGE_PROTOCOL_VERSION,
			type: 'response',
			id,
			ok: true,
			...(result === undefined ? {} : { result })
		});
	};
	const failure = (id: string, error: unknown): void => {
		const value = error as { code?: unknown; message?: unknown; recoverable?: unknown };
		respond({
			version: BRIDGE_PROTOCOL_VERSION,
			type: 'response',
			id,
			ok: false,
			error: {
				code: typeof value.code === 'string' ? value.code : 'bridge_error',
				message: typeof value.message === 'string' ? value.message : String(error),
				recoverable: value.recoverable === true
			}
		});
	};

	const handle = async (frame: CommandFrame): Promise<void> => {
		try {
			switch (frame.command) {
				case 'status':
					success(frame.id, {
						capabilities: { prompt: true, interrupt: true, stop: true },
						nativeSessionId: process.nativeSessionId ?? null
					});
					return;
				case 'prompt': {
					const text = readPrompt(frame.payload);
					if (promptActive) throw bridgeError('busy', 'A Claude turn is already running', true);
					promptActive = true;
					success(frame.id, { accepted: true });
					void process
						.prompt(text, {
							onEvent: (event) => globalThis.process.stdout.write(encodeProtocolFrame(event)),
							onDiagnostic: (event) => globalThis.process.stderr.write(encodeDiagnosticFrame(event))
						})
						.catch((error: unknown) => diagnostic('error', error instanceof Error ? error.message : String(error)))
						.finally(() => {
							promptActive = false;
						});
					return;
				}
				case 'interrupt':
					success(frame.id, completionValue(await process.interrupt()));
					return;
				case 'stop':
					stopping = true;
					await process.stop();
					if (success(frame.id, { stopped: true })) setImmediate(() => globalThis.process.exit(0));
					else globalThis.process.stdout.once('drain', () => globalThis.process.exit(0));
					return;
				default:
					throw bridgeError('unsupported_command', `Unsupported bridge command: ${frame.command}`, false);
			}
		} catch (error) {
			failure(frame.id, error);
		}
	};

	const lines = createInterface({ input: globalThis.process.stdin, crlfDelay: Infinity });
	lines.on('line', (line) => {
		for (const result of decoder.push(`${line}\n`)) {
			if (result.ok) void handle(result.frame);
			else diagnostic('error', result.error.message);
		}
	});
	await new Promise<void>((resolve) => lines.once('close', resolve));
	if (!stopping) await registry.stopAll();
}

function readPrompt(payload: JsonValue | undefined): string {
	if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
		throw bridgeError('invalid_payload', 'The prompt payload must contain text', true);
	}
	const text = payload.text;
	if (typeof text !== 'string' || text.trim() === '') {
		throw bridgeError('invalid_payload', 'The prompt payload must contain non-empty text', true);
	}
	return text;
}

function completionValue(value: object): JsonValue {
	return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function bridgeError(code: string, message: string, recoverable: boolean): Error {
	return Object.assign(new Error(message), { code, recoverable });
}

function parseOptions(arguments_: readonly string[]): ClaudeStdioBridgeOptions {
	const values = new Map<string, string>();
	for (let index = 0; index < arguments_.length; index += 2) {
		const name = arguments_[index];
		const value = arguments_[index + 1];
		if (!name?.startsWith('--') || value === undefined)
			throw new Error(`Invalid bridge argument: ${name ?? '<missing>'}`);
		values.set(name, value);
	}
	const claudePath = values.get('--claude');
	const cwd = values.get('--cwd');
	if (!claudePath || !cwd) throw new Error('Usage: pau-claude-bridge --claude <path> --cwd <path> [--resume <id>]');
	return { claudePath, cwd, ...(values.has('--resume') ? { nativeSessionId: values.get('--resume') } : {}) };
}

if (import.meta.url === pathToFileURL(globalThis.process.argv[1] ?? '').href) {
	runClaudeStdioBridge(parseOptions(globalThis.process.argv.slice(2))).catch((error: unknown) => {
		globalThis.process.stderr.write(
			encodeDiagnosticFrame({
				version: BRIDGE_PROTOCOL_VERSION,
				type: 'diagnostic',
				level: 'error',
				message: error instanceof Error ? error.message : String(error)
			})
		);
		globalThis.process.exitCode = 1;
	});
}
