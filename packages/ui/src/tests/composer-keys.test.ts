import { expect, test } from 'vitest';

import { composerKeyAction, resolveComposerKeys } from '../lib/composer-keys';

/** A key press with only the fields the composer reads. */
const press = (init: Partial<KeyboardEvent>) =>
	({
		key: 'Enter',
		code: 'Enter',
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		metaKey: false,
		...init
	}) as KeyboardEvent;

test("uses Pi's defaults until bindings load", () => {
	const keys = resolveComposerKeys([], 'mac');

	expect(keys.byAction).toEqual({
		interrupt: ['escape'],
		followUp: ['alt+enter'],
		dequeue: ['alt+up'],
		submit: ['enter', 'meta+enter', 'ctrl+enter'],
		newLine: ['shift+enter', 'ctrl+j'],
		cycleThinking: ['shift+tab'],
		selectModel: ['ctrl+l']
	});
});

test("replaces an action's defaults with the operator's binding and unbinds an empty list", () => {
	const keys = resolveComposerKeys(
		[
			{ action: 'app.thinking.cycle', keys: ['shift+ctrl+T'] },
			{ action: 'app.model.select', keys: [] },
			{ action: 'app.message.followUp', keys: ['ctrl+enter'] }
		],
		'other'
	);

	expect(keys.byAction.cycleThinking).toEqual(['ctrl+shift+t']);
	expect(keys.byAction.selectModel).toEqual([]);
	// Pau's own Ctrl+Enter yields to the operator's follow-up binding.
	expect(keys.byChord.get('ctrl+enter')).toBe('followUp');
	expect(keys.byAction.submit).toEqual(['enter', 'meta+enter']);
});

test('reads the action from a key press and ignores IME composition', () => {
	const keys = resolveComposerKeys([], 'mac');

	expect(composerKeyAction(keys, press({ altKey: true }))).toBe('followUp');
	expect(composerKeyAction(keys, press({ isComposing: true }))).toBeUndefined();
});
