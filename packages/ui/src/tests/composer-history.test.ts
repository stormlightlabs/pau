import { expect, test } from 'vitest';

import { historyLimit, idleHistoryCursor, navigateHistory, recordPrompt } from '../lib/composer-history';

const entries = ['newest', 'older'];

test('Up recalls from an empty draft and Down restores it', () => {
	const first = navigateHistory(entries, idleHistoryCursor, '', 0, 'previous')!;
	expect(first.draft).toBe('newest');
	const second = navigateHistory(entries, first.cursor, first.draft, 6, 'previous')!;
	expect(second.draft).toBe('older');
	expect(navigateHistory(entries, second.cursor, second.draft, 5, 'previous')).toBeUndefined();
	const back = navigateHistory(entries, second.cursor, second.draft, 5, 'next')!;
	expect(back.draft).toBe('newest');
	const restored = navigateHistory(entries, back.cursor, back.draft, 6, 'next')!;
	expect(restored).toEqual({ cursor: idleHistoryCursor, draft: '' });
});

test('Up leaves a written draft alone and Down needs browsing', () => {
	expect(navigateHistory(entries, idleHistoryCursor, 'typed', 0, 'previous')).toBeUndefined();
	expect(navigateHistory(entries, idleHistoryCursor, 'typed', 5, 'next')).toBeUndefined();
});

test('editing a recalled prompt ends browsing', () => {
	const step = navigateHistory(entries, idleHistoryCursor, '', 0, 'previous')!;
	expect(navigateHistory(entries, step.cursor, 'newest!', 7, 'previous')).toBeUndefined();
});

test('an empty history is a no-op', () => {
	expect(navigateHistory([], idleHistoryCursor, '', 0, 'previous')).toBeUndefined();
});

test('multi-line recalled prompts only navigate from the first or last line', () => {
	const multi = ['a\nb'];
	const step = navigateHistory(multi, idleHistoryCursor, '', 0, 'previous')!;
	expect(navigateHistory(multi, step.cursor, step.draft, 3, 'previous')).toBeUndefined();
	expect(navigateHistory(multi, step.cursor, step.draft, 0, 'next')).toBeUndefined();
	expect(navigateHistory(multi, step.cursor, step.draft, 3, 'next')?.draft).toBe('');
});

test('recordPrompt prepends, skips repeats, and caps the list', () => {
	expect(recordPrompt(['a'], 'b')).toEqual(['b', 'a']);
	expect(recordPrompt(['a'], 'a')).toEqual(['a']);
	expect(recordPrompt(Array(historyLimit).fill('x'), 'y')).toHaveLength(historyLimit);
});
