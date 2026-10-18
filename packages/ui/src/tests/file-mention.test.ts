import { expect, test } from 'vitest';

import { insertMention, mentionAt } from '../lib/file-mention';

test('opens a mention at the start or after whitespace, not inside a word', () => {
	expect(mentionAt('@', 1)).toEqual({ start: 0, query: '', quoted: false });
	expect(mentionAt('read @src/ap', 12)).toEqual({ start: 5, query: 'src/ap', quoted: false });
	expect(mentionAt('mail me@example.com', 19)).toBeUndefined();
	expect(mentionAt('@src done', 9)).toBeUndefined();
});

test('reads only the text before the caret', () => {
	expect(mentionAt('see @src/lib and more', 12)).toEqual({ start: 4, query: 'src/lib', quoted: false });
});

test('keeps a quoted mention open through spaces until the closing quote', () => {
	expect(mentionAt('@"docs/release no', 17)).toEqual({ start: 0, query: 'docs/release no', quoted: true });
	expect(mentionAt('@"docs/a.md" next', 17)).toBeUndefined();
});

test('inserts @path with a trailing space', () => {
	const token = mentionAt('fix @src/ap now', 11)!;
	expect(insertMention('fix @src/ap now', token, 11, { path: 'src/App.svelte', directory: false })).toEqual({
		draft: 'fix @src/App.svelte  now',
		caret: 20
	});
});

test('quotes a path with spaces', () => {
	const token = mentionAt('@rel', 4)!;
	expect(insertMention('@rel', token, 4, { path: 'docs/release notes.md', directory: false })).toEqual({
		draft: '@"docs/release notes.md" ',
		caret: 25
	});
});

test('leaves a folder open for the next segment', () => {
	const token = mentionAt('@sr', 3)!;
	expect(insertMention('@sr', token, 3, { path: 'src/', directory: true })).toEqual({ draft: '@src/', caret: 5 });
	const spaced = mentionAt('@my', 3)!;
	expect(insertMention('@my', spaced, 3, { path: 'my docs/', directory: true })).toEqual({
		draft: '@"my docs/"',
		caret: 10
	});
});
