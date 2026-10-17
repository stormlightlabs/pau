import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import {
	emptyPiTranscript,
	piTranscriptFromMessages,
	queueFromEvent,
	reducePiEvent,
	type PiTranscript
} from './pi-transcript';

/** Native Pi events shared with the Rust projection tests. */
const fixture = readFileSync(
	new URL('../../../../crates/pi/tests/fixtures/event-projection.jsonl', import.meta.url),
	'utf8'
)
	.split('\n')
	.filter(Boolean)
	.map((line) => JSON.parse(line) as unknown);

function reduce(events: unknown[], state: PiTranscript = emptyPiTranscript): PiTranscript {
	let result = state;
	for (const event of events) result = reducePiEvent(result, event);
	return result;
}

const user = { role: 'user', content: 'Read the README', timestamp: 1 };
const reply = {
	role: 'assistant',
	content: [
		{ type: 'text', text: 'Reading it.' },
		{ type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'README.md' } }
	],
	stopReason: 'toolUse',
	timestamp: 2
};
const result = {
	role: 'toolResult',
	toolCallId: 'call-1',
	toolName: 'read',
	content: [{ type: 'text', text: '# Pau' }],
	isError: false,
	timestamp: 3
};

test('builds a transcript from history, with tool outcomes and a compaction summary', () => {
	const summary = { role: 'compactionSummary', summary: 'Fixed the gutter.', tokensBefore: 9000, timestamp: 0 };

	expect(piTranscriptFromMessages([summary, user, reply, result, { role: 'custom' }]).entries).toEqual([
		{
			id: 'compactionSummary-0:0',
			kind: 'message',
			role: 'assistant',
			label: 'Earlier conversation, summarized',
			body: 'Fixed the gutter.'
		},
		{ id: 'user-1:0', kind: 'message', role: 'user', body: 'Read the README' },
		{ id: 'assistant-2:0', kind: 'message', role: 'assistant', body: 'Reading it.' },
		{ id: 'tool:call-1', kind: 'tool', name: 'read', detail: 'README.md', result: '# Pau', status: 'complete' }
	]);
});

test('applies a replayed message from history once, without partial text', () => {
	const history = piTranscriptFromMessages([user, reply]);
	const replayed = reduce(
		[
			{ type: 'message_start', message: { ...reply, content: [] } },
			{ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Read' } }
		],
		history
	);
	expect(replayed.entries).toEqual(history.entries.map((entry) => ({ ...entry })));

	const finished = reduce(
		[
			{ type: 'message_end', message: reply },
			{ type: 'message_start', message: result },
			{ type: 'message_end', message: result }
		],
		replayed
	);
	expect(finished.entries.map((entry) => entry.id)).toEqual(['user-1:0', 'assistant-2:0', 'tool:call-1']);
	expect(finished.entries.at(-1)).toMatchObject({ status: 'complete', result: '# Pau' });
});

test('shows streamed text before the message completes', () => {
	const streaming = reduce(fixture.slice(0, 7));

	expect(streaming.entries).toEqual([
		{ id: 'assistant-1773651600000:0', kind: 'message', role: 'assistant', body: 'streamed text' },
		{ id: 'assistant-1773651600000:1', kind: 'thinking', body: 'check', complete: false }
	]);
});

test('replaces streamed blocks with the authoritative message and tracks tool output', () => {
	expect(reduce(fixture).entries).toEqual([
		{ id: 'assistant-1773651600000:0', kind: 'message', role: 'assistant', body: 'authoritative text' },
		{ id: 'assistant-1773651600000:1', kind: 'thinking', body: 'authoritative thought', complete: true },
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
		{
			id: 'm1:error',
			kind: 'message',
			role: 'assistant',
			label: 'Pi · error',
			body: 'Rate limit reached.',
			failed: true
		}
	]);
});

test('tracks a scheduled automatic retry until it ends', () => {
	const before = Date.now();
	const scheduled = reduce([
		{ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: '529 overloaded' }
	]);

	expect(scheduled.autoRetry).toMatchObject({ attempt: 1, maxAttempts: 3, errorMessage: '529 overloaded' });
	expect(scheduled.autoRetry!.retryAt).toBeGreaterThanOrEqual(before + 2000);
	expect(reduce([{ type: 'auto_retry_end', success: true, attempt: 2 }], scheduled).autoRetry).toBeUndefined();
	expect(reduce([{ type: 'auto_retry_start', attempt: 1 }]).autoRetry).toBeUndefined();
});

test('reads the whole queue from a queue update and ignores other events', () => {
	expect(queueFromEvent({ type: 'queue_update', steering: ['a', 2], followUp: ['b'] })).toEqual({
		steering: ['a'],
		followUp: ['b']
	});
	expect(queueFromEvent({ type: 'queue_update' })).toEqual({ steering: [], followUp: [] });
	expect(queueFromEvent({ type: 'agent_end' })).toBeUndefined();
});

test('shows a running compaction and replaces it with a marker when it ends', () => {
	const running = reduce([{ type: 'compaction_start', reason: 'threshold' }]);
	expect(running.compaction).toEqual({ status: 'running', reason: 'threshold' });

	const done = reduce(
		[
			{
				type: 'compaction_end',
				reason: 'threshold',
				result: { summary: 'Short summary.', firstKeptEntryId: 'e7', tokensBefore: 90_000 },
				aborted: false,
				willRetry: true
			}
		],
		running
	);
	expect(done.compaction).toBeUndefined();
	expect(done.entries).toEqual([
		{
			id: 'compaction:0',
			kind: 'compaction',
			reason: 'threshold',
			summary: 'Short summary.',
			firstKeptEntryId: 'e7',
			tokensBefore: 90_000,
			willRetry: true
		}
	]);
});

test('keeps a failed or aborted compaction until the next run or compaction', () => {
	const failed = reduce([{ type: 'compaction_end', reason: 'manual', aborted: false, errorMessage: 'Too small.' }]);
	expect(failed.compaction).toEqual({ status: 'failed', reason: 'manual', message: 'Too small.' });
	expect(failed.entries).toEqual([]);

	const aborted = reduce([{ type: 'compaction_end', reason: 'overflow', aborted: true }]);
	expect(aborted.compaction).toEqual({ status: 'aborted', reason: 'overflow' });
	expect(reduce([{ type: 'agent_start' }], aborted).compaction).toBeUndefined();
	expect(reduce([{ type: 'compaction_start', reason: 'manual' }], failed).compaction?.status).toBe('running');
});
