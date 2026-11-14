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
		{ id: 'compactionSummary-0:0', kind: 'compaction', summary: 'Fixed the gutter.', tokensBefore: 9000 },
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

/** The header of a PNG `size` pixels square, as base64. A test pads it to the length it needs. */
const pngHeader = (size: 1 | 5000 | 10_000) =>
	({
		1: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
		5000: 'iVBORw0KGgoAAAANSUhEUgAAE4gAABOI',
		10_000: 'iVBORw0KGgoAAAANSUhEUgAAJxAAACcQ'
	})[size];

const image = (data: string, mimeType = 'image/png') => ({ type: 'image', mimeType, data });

const entry = (content: unknown[]) => piTranscriptFromMessages([{ role: 'user', content, timestamp: 1 }]).entries[0];

const pixel = image(pngHeader(1));

/** An image at the 5 MiB limit: 6,990,508 characters of base64. */
const largestImage = image(pngHeader(1).padEnd(6_990_508, 'A'));

test('shows the images sent with a user prompt and counts damaged or unsupported ones', () => {
	const content = [
		{ type: 'text', text: 'Describe this.' },
		pixel,
		image(pngHeader(1), 'image/svg+xml'),
		image(pngHeader(1), 'image/jpg'),
		image('https://example.com/a.png'),
		image(`${pngHeader(1)}\nAAAA`),
		image('AAAAA'),
		image('AAAAAAAA')
	];
	const expected = [
		{
			id: 'user-1:0',
			kind: 'message',
			role: 'user',
			body: 'Describe this.',
			images: [{ mimeType: 'image/png', data: pngHeader(1) }],
			hiddenImages: { unreadable: 6 }
		}
	];

	expect(piTranscriptFromMessages([{ role: 'user', content, timestamp: 1 }]).entries).toEqual(expected);
	expect(reduce([{ type: 'message_start', message: { role: 'user', content, timestamp: 1 } }]).entries).toEqual(
		expected
	);
	expect(entry([pixel])).toEqual({ ...expected[0], body: '', hiddenImages: undefined });
});

test('keeps the turn of a prompt that holds only a damaged image', () => {
	const prompt = { role: 'user', content: [image(`${pngHeader(1)}\n`)], timestamp: 1 };
	const reply = { role: 'assistant', content: [{ type: 'text', text: 'I cannot read it.' }], timestamp: 2 };

	expect(piTranscriptFromMessages([prompt, reply]).entries).toMatchObject([
		{ role: 'user', body: '', hiddenImages: { unreadable: 1 } },
		{ role: 'assistant', body: 'I cannot read it.' }
	]);
});

test('counts an image past the size, message or pixel limit as too large', () => {
	const limit = largestImage.data;

	expect(entry([image(limit)])).toMatchObject({ images: [{ data: limit }] });
	expect(entry([image(`${limit}A`)])).toEqual({
		id: 'user-1:0',
		kind: 'message',
		role: 'user',
		body: '',
		hiddenImages: { tooLarge: 1 }
	});
	// Two images at the limit fill a 10 MiB request; a third does not fit.
	const full = entry([image(limit), image(limit), pixel]);
	expect(full).toMatchObject({ hiddenImages: { tooLarge: 1 } });
	expect(full.kind === 'message' && full.images?.length).toBe(2);
	// 5000 pixels square is at the 25-megapixel cap; 10,000 is past it.
	const atCap = image(pngHeader(5000));
	const pastCap = image(pngHeader(10_000));
	expect(entry([atCap, pastCap])).toMatchObject({ images: [{ data: pngHeader(5000) }], hiddenImages: { tooLarge: 1 } });
});

const fullRequest = (timestamp: number) => ({ role: 'user', content: [largestImage, largestImage], timestamp });

/** Shown and older image counts of each user message: the slots its thumbnail row holds. */
const imageSlots = (state: PiTranscript) =>
	state.entries.map((entry) =>
		entry.kind === 'message' ? [entry.images?.length ?? 0, entry.hiddenImages?.older ?? 0] : []
	);

test('keeps the newest images within the transcript budget and counts older ones apart from too large ones', () => {
	// Each message carries a full 10 MiB request; the transcript keeps four.
	const messages = Array.from({ length: 6 }, (_, index) => fullRequest(index + 1));
	const transcript = piTranscriptFromMessages(messages);

	expect(imageSlots(transcript)).toEqual([
		[0, 2],
		[0, 2],
		[2, 0],
		[2, 0],
		[2, 0],
		[2, 0]
	]);
	expect(transcript.entries[0]).toMatchObject({ hiddenImages: { older: 2 } });
	expect(transcript.entries[0]).not.toMatchObject({ hiddenImages: { tooLarge: expect.anything() } });
});

test('a new image prompt keeps the thumbnail slots of earlier messages', () => {
	const before = piTranscriptFromMessages([1, 2, 3, 4].map((timestamp) => fullRequest(timestamp)));
	const after = reducePiEvent(before, { type: 'message_end', message: fullRequest(5) });

	// The oldest message trades its images for placeholders of the same count.
	expect(imageSlots(before)).toEqual([
		[2, 0],
		[2, 0],
		[2, 0],
		[2, 0]
	]);
	expect(imageSlots(after)).toEqual([
		[0, 2],
		[2, 0],
		[2, 0],
		[2, 0],
		[2, 0]
	]);
	expect(after.entries.slice(1, 4)).toEqual(before.entries.slice(1));
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

test('streams a shell command from its start, output, and end events', () => {
	const start = { type: 'shell_command_start', id: '7', command: 'ls src', exclude_from_context: true };
	const running = reduce([
		start,
		{ type: 'bash_execution_update', id: '7', delta: 'lib\n' },
		{ type: 'bash_execution_update', id: '7', delta: 'routes\n' }
	]);

	expect(running.entries).toEqual([
		{
			id: 'shell:7',
			kind: 'tool',
			name: 'shell',
			detail: 'ls src',
			result: 'lib\nroutes\n',
			status: 'running',
			call: { tool: 'bash', command: 'ls src' },
			shell: { excludedFromContext: true }
		}
	]);

	const result = {
		id: '7',
		output: 'lib\nroutes\n',
		exit_code: 0,
		cancelled: false,
		truncated: true,
		full_output_path: '/tmp/pi-bash.log'
	};
	expect(reduce([{ type: 'shell_command_end', id: '7', result, error: null }], running).entries).toEqual([
		{
			id: 'shell:7',
			kind: 'tool',
			name: 'shell',
			detail: 'ls src',
			result: 'lib\nroutes\n',
			status: 'complete',
			call: { tool: 'bash', command: 'ls src', exitCode: 0, fullOutputPath: '/tmp/pi-bash.log' },
			shell: { excludedFromContext: true, truncated: true }
		}
	]);
});

test('fails a shell command that exits non-zero or cannot run, and completes a stopped one', () => {
	const ended = reduce([
		{ type: 'shell_command_start', id: '1', command: 'false', exclude_from_context: false },
		{
			type: 'shell_command_end',
			id: '1',
			result: { id: '1', output: '', exit_code: 1, cancelled: false, truncated: false, full_output_path: null },
			error: null
		},
		{ type: 'shell_command_start', id: '2', command: 'ls', exclude_from_context: false },
		{ type: 'shell_command_end', id: '2', result: null, error: 'Pi rejected the request: busy' },
		{ type: 'shell_command_start', id: '3', command: 'sleep 9', exclude_from_context: false },
		{
			type: 'shell_command_end',
			id: '3',
			result: { id: '3', output: '', exit_code: null, cancelled: true, truncated: false, full_output_path: null },
			error: null
		}
	]);

	expect(ended.entries).toMatchObject([
		{ id: 'shell:1', status: 'failed', call: { exitCode: 1 } },
		{ id: 'shell:2', status: 'failed', result: 'Pi rejected the request: busy', call: { command: 'ls' } },
		{ id: 'shell:3', status: 'complete', shell: { cancelled: true } }
	]);
});

test('shows a shell command whose start came before the history read', () => {
	const entries = reduce([
		{ type: 'bash_execution_update', id: '4', delta: 'tick\n' },
		{
			type: 'shell_command_end',
			id: '4',
			result: { id: '4', output: 'tick\n', exit_code: 0, cancelled: false, truncated: false, full_output_path: null },
			error: null
		}
	]).entries;

	expect(entries).toMatchObject([{ id: 'shell:4', status: 'complete', result: 'tick\n' }]);
});

test('rebuilds shell commands from saved bash executions', () => {
	const saved = { role: 'bashExecution', cancelled: false, truncated: false };
	const entries = piTranscriptFromMessages([
		user,
		{ ...saved, command: 'cat .env.local', output: 'TOKEN=x\n', exitCode: 0, timestamp: 5, excludeFromContext: true },
		{ ...saved, command: 'pnpm test', output: 'FAIL\n', exitCode: 1, timestamp: 6 }
	]).entries;

	expect(entries.slice(1)).toEqual([
		{
			id: 'bashExecution-5:0',
			kind: 'tool',
			name: 'shell',
			detail: 'cat .env.local',
			result: 'TOKEN=x\n',
			status: 'complete',
			call: { tool: 'bash', command: 'cat .env.local', exitCode: 0 },
			shell: { excludedFromContext: true }
		},
		{
			id: 'bashExecution-6:0',
			kind: 'tool',
			name: 'shell',
			detail: 'pnpm test',
			result: 'FAIL\n',
			status: 'failed',
			call: { tool: 'bash', command: 'pnpm test', exitCode: 1 },
			shell: { excludedFromContext: false }
		}
	]);
});
