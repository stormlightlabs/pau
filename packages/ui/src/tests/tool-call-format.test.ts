import { expect, test } from 'vitest';

import { diffLineKind, formatDuration, outputLines, outputWindow, readRange } from '../lib/tool-call-format';

test('keeps the head or tail of long output', () => {
	const lines = ['a', 'b', 'c', 'd'];

	expect(outputWindow(lines, 2, 'head')).toEqual({ lines: ['a', 'b'], hidden: 2 });
	expect(outputWindow(lines, 2, 'tail')).toEqual({ lines: ['c', 'd'], hidden: 2 });
	expect(outputWindow(lines, 5, 'tail')).toEqual({ lines, hidden: 0 });
});

test('drops one trailing newline when splitting output', () => {
	expect(outputLines('')).toEqual([]);
	expect(outputLines('a\nb\n')).toEqual(['a', 'b']);
	expect(outputLines('a\n\n')).toEqual(['a', '']);
});

test('classifies diff lines by marker', () => {
	expect(['+2 new', '-2 old', ' 1 same', '   ...'].map((line) => diffLineKind(line))).toEqual([
		'added',
		'removed',
		'context',
		'context'
	]);
});

test('formats durations and read ranges', () => {
	expect([84, 12_400, 125_000].map((ms) => formatDuration(ms))).toEqual(['84 ms', '12.4 s', '2 min 5 s']);
	expect(readRange({ tool: 'read', path: 'a', offset: 10, limit: 5 })).toBe('lines 10–14');
	expect(readRange({ tool: 'read', path: 'a', offset: 10 })).toBe('from line 10');
	expect(readRange({ tool: 'read', path: 'a' })).toBeUndefined();
});
