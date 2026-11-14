import { expect, test } from 'vitest';

import { codeSpans, withoutCodeMarks } from '../lib/code-spans';

test('sets quoted names apart from the text around them', () => {
	expect(codeSpans('Run `claude update`, then check again.')).toEqual([
		{ text: 'Run ', code: false },
		{ text: 'claude update', code: true },
		{ text: ', then check again.', code: false }
	]);
});

test('keeps an unpaired backtick as text', () => {
	expect(codeSpans('A `b` and `c')).toEqual([
		{ text: 'A ', code: false },
		{ text: 'b', code: true },
		{ text: ' and ', code: false },
		{ text: '`c', code: false }
	]);
	expect(withoutCodeMarks('Add `claude` to PATH.')).toBe('Add claude to PATH.');
});
