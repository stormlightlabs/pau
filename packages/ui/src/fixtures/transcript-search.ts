import type { SessionSearchOutcome } from '../lib/types/session';

/** Reference time for the relative dates in search results. */
export const transcriptSearchNow = new Date('2026-04-01T12:30:00Z');

const results: SessionSearchOutcome = {
	hits: [
		{
			id: 'answer-1',
			role: 'assistant',
			snippet: 'Gutter rows now follow visual line offsets, so wrapped lines keep their markers.',
			matchStart: 0,
			matchEnd: 6,
			timestamp: '2026-04-01T12:25:00Z',
			entryKey: 'answer-1'
		},
		{
			id: 'prompt-1',
			role: 'user',
			snippet: 'Fix gutter markers drifting when soft-wrap is on.',
			matchStart: 4,
			matchEnd: 10,
			timestamp: '2026-04-01T10:30:00Z',
			entryKey: 'prompt-1'
		},
		{
			id: 'old-1',
			role: 'assistant',
			snippet: 'The gutter width comes from the line count.',
			matchStart: 4,
			matchEnd: 10,
			timestamp: '2026-03-29T09:00:00Z'
		}
	],
	truncated: false
};

/** Search outcomes for the transcript search stories and tests. */
export const transcriptSearchFixtures = {
	results,
	noResults: { hits: [], truncated: false } satisfies SessionSearchOutcome,
	truncated: { ...results, truncated: true } satisfies SessionSearchOutcome
};
