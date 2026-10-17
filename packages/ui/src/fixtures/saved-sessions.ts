import type { SavedSessionList } from '../lib/types/session';

/** Fixed reference time so relative dates render the same in every run. */
export const savedSessionsNow = new Date('2026-05-01T12:00:00Z');

export const savedSessionFixtures = {
	empty: { sessions: [], warnings: [] },
	populated: {
		sessions: [
			{ id: 'native-3', title: 'Review the sandbox policy', modifiedAt: '2026-05-01T09:00:00Z' },
			{ id: 'native-2', title: 'Fix the flaky terminal test', modifiedAt: '2026-04-29T12:00:00Z' },
			{ id: 'native-1', title: 'Untitled session' }
		],
		warnings: []
	},
	withWarnings: {
		sessions: [{ id: 'native-3', title: 'Review the sandbox policy', modifiedAt: '2026-05-01T09:00:00Z' }],
		warnings: [{ path: '/home/me/.pi/sessions/broken.jsonl', message: 'The session header is not valid JSON.' }]
	}
} satisfies Record<string, SavedSessionList>;
