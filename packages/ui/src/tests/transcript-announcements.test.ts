import { expect, test } from 'vitest';

import { describeChanges, responseSummary, type AnnouncementSnapshot } from '../lib/transcript-announcements';

const idle: AnnouncementSnapshot = {
	sessionId: 's1',
	agent: 'Pi',
	status: 'idle',
	failedToolIds: [],
	failedToolNames: [],
	compactions: 0
};

test('announces the start and the end of a response, not its text', () => {
	const running = { ...idle, status: 'running' as const };
	expect(describeChanges(idle, running)).toEqual(['Pi is responding']);
	expect(describeChanges(running, { ...running, lastAssistantText: 'Partial' })).toEqual([]);
	expect(describeChanges(running, { ...idle, lastAssistantText: 'Fixed the bug. Tests pass.' })).toEqual([
		'Pi finished: Fixed the bug.'
	]);
	expect(describeChanges(running, idle)).toEqual(['Pi finished. Response ready']);
});

test('announces each new failed tool once', () => {
	const one = { ...idle, failedToolIds: ['t1'], failedToolNames: ['bash'] };
	expect(describeChanges(idle, one)).toEqual(['Tool call failed: bash']);
	expect(describeChanges(one, one)).toEqual([]);
	const three = { ...idle, failedToolIds: ['t1', 't2', 't3'], failedToolNames: ['bash', 'read', 'edit'] };
	expect(describeChanges(one, three)).toEqual(['2 tool calls failed']);
});

test('announces extension dialogs and finished compactions', () => {
	expect(describeChanges(idle, { ...idle, dialogId: 'd1', dialogTitle: 'Allow deploy?' })).toEqual([
		'Waiting for your input: Allow deploy?'
	]);
	expect(describeChanges(idle, { ...idle, dialogId: 'd1' })).toEqual(['Waiting for your input']);
	expect(describeChanges(idle, { ...idle, compactions: 1 })).toEqual(['Compaction finished']);
});

test('ignores the first snapshot and session switches', () => {
	expect(describeChanges(undefined, { ...idle, status: 'running' })).toEqual([]);
	expect(describeChanges(idle, { ...idle, sessionId: 's2', status: 'running' })).toEqual([]);
});

test('summarizes the first sentence without markdown or code', () => {
	expect(responseSummary('```ts\nconst a = 1;\n```\n**Done** with `x`. More.')).toBe('Done with x.');
	expect(responseSummary('a'.repeat(300))).toHaveLength(120);
	expect(responseSummary(undefined)).toBe('');
});
