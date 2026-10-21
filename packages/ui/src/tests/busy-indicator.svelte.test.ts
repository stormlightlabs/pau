import { flushSync } from 'svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { BusyIndicator } from '../lib/busy-indicator.svelte';

/** One indicator inside an effect root, with a switch for its wait. */
function setup() {
	const wait = $state({ busy: false });
	let indicator!: BusyIndicator;
	const destroy = $effect.root(() => {
		indicator = new BusyIndicator(() => wait.busy);
	});
	flushSync();
	const set = (busy: boolean) => {
		wait.busy = busy;
		flushSync();
	};
	return { indicator, set, destroy };
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

test('a wait that ends before the delay never shows the indicator', () => {
	const { indicator, set, destroy } = setup();
	set(true);
	expect(indicator.active).toBe(true);
	vi.advanceTimersByTime(399);
	expect(indicator.visible).toBe(false);
	set(false);
	vi.advanceTimersByTime(1000);
	expect(indicator.visible).toBe(false);
	expect(indicator.active).toBe(false);
	destroy();
});

test('a wait that ends during the minimum display keeps the indicator for 500ms', async () => {
	const { indicator, set, destroy } = setup();
	set(true);
	vi.advanceTimersByTime(400);
	expect(indicator.visible).toBe(true);
	vi.advanceTimersByTime(100);
	set(false);
	let hidden = false;
	void indicator.hidden().then(() => (hidden = true));
	expect(indicator.visible).toBe(true);
	expect(indicator.active).toBe(true);
	vi.advanceTimersByTime(399);
	await Promise.resolve();
	expect(indicator.visible).toBe(true);
	expect(hidden).toBe(false);
	vi.advanceTimersByTime(1);
	await Promise.resolve();
	expect(indicator.visible).toBe(false);
	expect(indicator.active).toBe(false);
	expect(hidden).toBe(true);
	destroy();
});

test('a long wait hides the indicator as soon as it ends', () => {
	const { indicator, set, destroy } = setup();
	set(true);
	vi.advanceTimersByTime(2000);
	expect(indicator.visible).toBe(true);
	set(false);
	expect(indicator.visible).toBe(false);
	destroy();
});

test('a new wait during the minimum display keeps the indicator shown', () => {
	const { indicator, set, destroy } = setup();
	set(true);
	vi.advanceTimersByTime(400);
	set(false);
	vi.advanceTimersByTime(200);
	set(true);
	vi.advanceTimersByTime(1000);
	expect(indicator.visible).toBe(true);
	set(false);
	expect(indicator.visible).toBe(false);
	destroy();
});

test('destroying the owner cancels a pending indicator', () => {
	const { indicator, set, destroy } = setup();
	set(true);
	destroy();
	vi.advanceTimersByTime(1000);
	expect(indicator.visible).toBe(false);
});
