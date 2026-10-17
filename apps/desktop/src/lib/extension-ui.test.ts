import { describe, expect, test } from 'vitest';

import { emptyExtensionUi, reduceExtensionEvent, type LiveExtensionUi } from './extension-ui';

const waiting: LiveExtensionUi = {
	...emptyExtensionUi,
	dialogs: [{ id: 'ask', kind: 'confirm', title: 'Continue?', message: 'Run the migration.' }]
};

describe('reduceExtensionEvent', () => {
	test('closes a dialog answered in another window without a notice', () => {
		const state = reduceExtensionEvent(waiting, { type: 'extension_ui_resolved', id: 'ask', reason: 'answered' });

		expect(state.dialogs).toEqual([]);
		expect(state.notifications).toEqual([]);
	});

	test('explains a dialog that expired', () => {
		const state = reduceExtensionEvent(waiting, { type: 'extension_ui_resolved', id: 'ask', reason: 'timed_out' });

		expect(state.dialogs).toEqual([]);
		expect(state.notifications).toEqual([
			{ id: 'resolved:ask', level: 'warning', message: 'An extension request expired before it was answered.' }
		]);
	});
});
