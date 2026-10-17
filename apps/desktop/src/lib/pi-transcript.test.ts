import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { emptyPiTranscript, reducePiEvent, type PiTranscript } from './pi-transcript';

/** Native Pi events shared with the Rust projection tests. */
const fixture = readFileSync(
	new URL('../../../../crates/pi/tests/fixtures/event-projection.jsonl', import.meta.url),
	'utf8'
)
	.split('\n')
	.filter(Boolean)
	.map((line) => JSON.parse(line) as unknown);

function reduce(events: unknown[], state: PiTranscript = emptyPiTranscript): PiTranscript {
	return events.reduce<PiTranscript>(reducePiEvent, state);
}

test('shows streamed text before the message completes', () => {
	const streaming = reduce(fixture.slice(0, 7));

	expect(streaming.entries).toEqual([
		{ id: 'm0:0', kind: 'message', role: 'assistant', body: 'streamed text' },
		{ id: 'm0:1', kind: 'thinking', body: 'check', complete: false }
	]);
});

test('replaces streamed blocks with the authoritative message and tracks tool output', () => {
	expect(reduce(fixture).entries).toEqual([
		{ id: 'm0:0', kind: 'message', role: 'assistant', body: 'authoritative text' },
		{ id: 'm0:1', kind: 'thinking', body: 'authoritative thought', complete: true },
		{
			id: 'tool:call-1',
			kind: 'tool',
			name: 'read',
			detail: 'README.md',
			result: 'complete output',
			status: 'complete'
		}
	]);
});

test('shows user prompts, failed tools, and provider errors', () => {
	const transcript = reduce([
		{ type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: 'Fix the build' }] } },
		{ type: 'message_end', message: { role: 'user', content: 'Fix the build' } },
		{ type: 'tool_execution_start', toolCallId: 'call-2', toolName: 'bash', args: { command: 'pnpm build' } },
		{
			type: 'tool_execution_end',
			toolCallId: 'call-2',
			toolName: 'bash',
			result: { content: [{ type: 'text', text: 'exit 1' }] },
			isError: true
		},
		{ type: 'message_start', message: { role: 'assistant', content: [] } },
		{
			type: 'message_end',
			message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'Rate limit reached.' }
		},
		{ type: 'future_event', detail: true }
	]);

	expect(transcript.entries).toEqual([
		{ id: 'm0:0', kind: 'message', role: 'user', body: 'Fix the build' },
		{ id: 'tool:call-2', kind: 'tool', name: 'bash', detail: 'pnpm build', result: 'exit 1', status: 'failed' },
		{ id: 'm1:error', kind: 'message', role: 'assistant', label: 'Pi · error', body: 'Rate limit reached.' }
	]);
});
