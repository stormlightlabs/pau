import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import {
	emptyPiTranscript,
	findTranscriptEntry,
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

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
		{
			id: 'tool:call-1',
			kind: 'tool',
			name: 'read',
			detail: 'README.md',
			result: '# Pau',
			status: 'complete',
			call: { tool: 'read', path: 'README.md' }
		}
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
	expect(reduce(fixture).entries.slice(0, 3)).toEqual([
		{ id: 'assistant-1773651600000:0', kind: 'message', role: 'assistant', body: 'authoritative text' },
		{ id: 'assistant-1773651600000:1', kind: 'thinking', body: 'authoritative thought', complete: true },
		{
			id: 'tool:call-1',
			kind: 'tool',
			name: 'read',
			detail: 'README.md',
			result: 'complete output',
			status: 'complete',
			call: { tool: 'read', path: 'README.md' }
		}
	]);
});

const bashOutput = 'test 3 ok\n\n[Showing lines 2-3 of 3. Full output: /tmp/pi-bash-1.log]';
const edit = {
	tool: 'edit',
	path: 'README.md',
	edits: [{ oldText: 'Old intro', newText: 'New intro' }],
	diff: ' 1 # Pau\n-2 Old intro\n+2 New intro',
	patch: '--- README.md\n+++ README.md\n@@ -1,2 +1,2 @@\n # Pau\n-Old intro\n+New intro\n',
	firstChangedLine: 2
};

test('reports structured data for built-in tools and text for other tools', () => {
	const entries = reduce(fixture).entries.slice(3);

	expect(entries).toEqual([
		{
			id: 'tool:call-2',
			kind: 'tool',
			name: 'bash',
			detail: 'pnpm test',
			result: bashOutput,
			status: 'complete',
			call: {
				tool: 'bash',
				command: 'pnpm test',
				timeout: 120,
				exitCode: 0,
				durationMs: 1400,
				truncation: { truncatedBy: 'lines', totalLines: 3, outputLines: 2 },
				fullOutputPath: '/tmp/pi-bash-1.log'
			}
		},
		{
			id: 'tool:call-3',
			kind: 'tool',
			name: 'edit',
			detail: 'README.md',
			result: 'Successfully replaced 1 block(s) in README.md.',
			status: 'complete',
			call: edit
		},
		{
			id: 'tool:call-4',
			kind: 'tool',
			name: 'write',
			detail: 'NOTES.md',
			result: 'Successfully wrote 19 bytes to NOTES.md',
			status: 'complete',
			call: { tool: 'write', path: 'NOTES.md', content: '# Notes\nFirst line\n' }
		},
		{
			id: 'tool:call-5',
			kind: 'tool',
			name: 'todo',
			detail: '{"action":"add","item":"Ship it"}',
			result: 'Added: Ship it',
			status: 'complete'
		},
		{
			id: 'tool:call-6',
			kind: 'tool',
			name: 'bash',
			detail: 'pnpm build',
			result: 'error: missing script\n\nCommand exited with code 1',
			status: 'failed',
			call: { tool: 'bash', command: 'pnpm build', exitCode: 1, durationMs: 300 }
		}
	]);
});

test('shows running bash output with the command', () => {
	const bashUpdate = fixture.findLastIndex((event) => isRecord(event) && event.type === 'tool_execution_update');
	const running = reduce(fixture.slice(0, bashUpdate + 1));

	expect(running.entries.find((entry) => entry.id === 'tool:call-2')).toEqual({
		id: 'tool:call-2',
		kind: 'tool',
		name: 'bash',
		detail: 'pnpm test',
		result: 'running 3 tests',
		status: 'running',
		call: { tool: 'bash', command: 'pnpm test', timeout: 120 }
	});
});

test('rebuilds built-in tool data from history, without live-only fields', () => {
	const messages = fixture.flatMap((event) => (isRecord(event) && event.type === 'message_end' ? [event.message] : []));
	const entries = piTranscriptFromMessages(messages).entries;

	expect(entries.find((entry) => entry.id === 'tool:call-2')).toMatchObject({
		status: 'complete',
		call: {
			tool: 'bash',
			command: 'pnpm test',
			truncation: { truncatedBy: 'lines', totalLines: 3, outputLines: 2 },
			fullOutputPath: '/tmp/pi-bash-1.log'
		}
	});
	const bash = entries.find((entry) => entry.id === 'tool:call-2');
	expect(bash?.kind === 'tool' && bash.call?.tool === 'bash' && bash.call.exitCode).toBe(undefined);
	expect(entries.find((entry) => entry.id === 'tool:call-3')).toMatchObject({ call: edit });
	expect(entries.find((entry) => entry.id === 'tool:call-6')).toMatchObject({
		status: 'failed',
		call: { tool: 'bash', command: 'pnpm build' }
	});
});

test('reads a legacy single-replacement edit', () => {
	const transcript = piTranscriptFromMessages([
		{
			role: 'assistant',
			content: [{ type: 'toolCall', id: 'old', name: 'edit', arguments: { path: 'a.md', oldText: 'x', newText: 'y' } }],
			timestamp: 1
		}
	]);

	expect(transcript.entries[0]).toMatchObject({
		call: { tool: 'edit', path: 'a.md', edits: [{ oldText: 'x', newText: 'y' }] }
	});
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
		{
			id: 'tool:call-2',
			kind: 'tool',
			name: 'bash',
			detail: 'pnpm build',
			result: 'exit 1',
			status: 'failed',
			call: { tool: 'bash', command: 'pnpm build' }
		},
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

const at = (ms: number) => new Date(ms).toISOString();

test('finds the transcript entry for a saved entry by role and time', () => {
	const entries = piTranscriptFromMessages([
		{ role: 'user', content: 'Read it', timestamp: 1_000_000 },
		{ role: 'assistant', content: [{ type: 'text', text: 'Done' }], timestamp: 1_002_000 }
	]).entries;

	expect(findTranscriptEntry(entries, 'user', at(1_000_300))).toBe('user-1000000:0');
	expect(findTranscriptEntry(entries, 'assistant', at(1_002_100))).toBe('assistant-1002000:0');
	expect(findTranscriptEntry(entries, 'assistant', at(1_100_000))).toBeUndefined();
	expect(findTranscriptEntry(entries, 'toolResult', at(1_000_000))).toBeUndefined();
	expect(findTranscriptEntry(entries, 'user', undefined)).toBeUndefined();
});
