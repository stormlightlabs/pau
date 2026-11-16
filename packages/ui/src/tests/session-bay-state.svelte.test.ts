import { expect, test } from 'vitest';

import { SessionBayState } from '../lib/session-bay-state.svelte';

/** Needs you order: the newest arrival first, as the bay sorts it. */
function rackOrder(state: SessionBayState): string[] {
	return state.needsSince
		.entries()
		.toArray()
		.sort(([, left], [, right]) => right - left)
		.map(([id]) => id);
}

test('keeps arrival order in Needs you, newest first, and forgets sessions that leave', () => {
	const state = new SessionBayState();

	state.trackNeeds(['first', 'second']);
	state.trackNeeds(['first', 'second', 'third']);
	expect(rackOrder(state)).toEqual(['third', 'second', 'first']);

	// A session already waiting keeps its place when the list arrives in another order.
	state.trackNeeds(['third', 'first', 'second']);
	expect(rackOrder(state)).toEqual(['third', 'second', 'first']);

	// One that leaves and comes back arrives anew, at the top.
	state.trackNeeds(['second', 'third']);
	expect(state.needsSince.has('first')).toBe(false);
	state.trackNeeds(['first', 'second', 'third']);
	expect(rackOrder(state)).toEqual(['first', 'third', 'second']);
});
