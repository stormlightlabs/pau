import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
	BRIDGE_PROTOCOL_VERSION,
	createDiagnosticDecoder,
	createProtocolDecoder,
	encodeDiagnosticFrame,
	encodeProtocolFrame,
	type DiagnosticFrame,
	type FrameDecodeResult,
	type ProtocolFrame
} from '../src/index.js';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));

const protocolFrames: ProtocolFrame[] = [
	{
		version: BRIDGE_PROTOCOL_VERSION,
		type: 'command',
		id: 'command-1',
		command: 'prompt',
		payload: { text: 'Review café ☕' }
	},
	{ version: BRIDGE_PROTOCOL_VERSION, type: 'response', id: 'command-1', ok: true, result: { accepted: true } },
	{
		version: BRIDGE_PROTOCOL_VERSION,
		type: 'response',
		id: 'command-2',
		ok: false,
		error: { code: 'busy', message: 'A turn is already running', recoverable: true }
	},
	{ version: BRIDGE_PROTOCOL_VERSION, type: 'event', sequence: 7, event: 'text.delta', payload: { text: 'hello' } }
];

const diagnosticFrame: DiagnosticFrame = {
	version: BRIDGE_PROTOCOL_VERSION,
	type: 'diagnostic',
	level: 'warn',
	message: 'fixture warning',
	context: { attempt: 2 }
};

describe('bridge framing', () => {
	it.each(protocolFrames)('round-trips a $type frame', (frame) => {
		const decoder = createProtocolDecoder();
		const encoded = Buffer.from(encodeProtocolFrame(frame));
		const splitAt = Math.max(1, encoded.indexOf(Buffer.from('é')) + 1);

		const results = [
			...decoder.push(encoded.subarray(0, splitAt)),
			...decoder.push(encoded.subarray(splitAt)),
			...decoder.end()
		];

		expect(results).toEqual([{ ok: true, frame }]);
	});

	it('round-trips a diagnostic frame on its own stream', () => {
		const decoder = createDiagnosticDecoder();

		expect(decoder.push(encodeDiagnosticFrame(diagnosticFrame))).toEqual([{ ok: true, frame: diagnosticFrame }]);
	});

	it('loads the representative protocol and diagnostic fixtures', async () => {
		const protocol = createProtocolDecoder();
		const diagnostics = createDiagnosticDecoder();
		const [protocolFixture, diagnosticFixture] = await Promise.all([
			readFile(`${fixtures}/protocol.jsonl`, 'utf8'),
			readFile(`${fixtures}/diagnostics.jsonl`, 'utf8')
		]);

		const protocolResults = protocol.push(protocolFixture);
		const diagnosticResults = diagnostics.push(diagnosticFixture);

		expect(protocolResults).toHaveLength(6);
		expect(protocolResults.every((result) => result.ok)).toBe(true);
		expect(protocolResults.at(-1)).toEqual({
			ok: true,
			frame: {
				version: 1,
				type: 'event',
				sequence: 2,
				event: 'session.model',
				payload: { model: 'claude-sonnet-4-5-20250929' }
			}
		});
		expect(protocol.end()).toEqual([]);
		expect(diagnosticResults).toHaveLength(2);
		expect(diagnosticResults.every((result) => result.ok)).toBe(true);
		expect(diagnostics.end()).toEqual([]);
	});

	it('reports bad lines and resumes at the next newline', async () => {
		const decoder = createProtocolDecoder();
		const fixture = await readFile(`${fixtures}/recovery.jsonl`, 'utf8');
		const results = decoder.push(fixture);

		expect(results.map((result) => (result.ok ? 'ok' : result.error.code))).toEqual([
			'unsupported_version',
			'malformed_frame',
			'malformed_frame',
			'ok'
		]);
		expect(results.at(-1)).toEqual({
			ok: true,
			frame: { version: 1, type: 'event', sequence: 2, event: 'turn.completed', payload: { status: 'completed' } }
		});
	});

	it("keeps diagnostics off the fake executable's protocol stream", async () => {
		const child = spawn(`${fixtures}/fake-claude.mjs`, [], { stdio: ['pipe', 'pipe', 'pipe'] });
		const protocol = createProtocolDecoder();
		const diagnostics = createDiagnosticDecoder();
		const protocolResults: FrameDecodeResult<ProtocolFrame>[] = [];
		const diagnosticResults: FrameDecodeResult<DiagnosticFrame>[] = [];

		child.stdout.on('data', (chunk: Buffer) => {
			protocolResults.push(...protocol.push(chunk));
		});
		child.stderr.on('data', (chunk: Buffer) => {
			diagnosticResults.push(...diagnostics.push(chunk));
		});

		child.stdin.end(encodeProtocolFrame(protocolFrames[0]!));
		const exitCode = await new Promise<number | null>((resolve, reject) => {
			child.once('error', reject);
			child.once('close', resolve);
		});
		protocolResults.push(...protocol.end());
		diagnosticResults.push(...diagnostics.end());

		expect(exitCode).toBe(0);
		expect(protocolResults.every((result) => result.ok)).toBe(true);
		expect(protocolResults.filter((result) => result.ok).map((result) => result.frame.type)).toEqual([
			'event',
			'response'
		]);
		expect(diagnosticResults).toEqual([
			{ ok: true, frame: { version: 1, type: 'diagnostic', level: 'info', message: 'fake Claude started' } }
		]);
	});
});
