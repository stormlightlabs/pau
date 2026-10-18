import { afterEach, expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { sessionFixtures } from '../fixtures/sessions';
import { Keymap, keymapContext } from '../lib/keymap.svelte';
import SessionView from '../lib/SessionView.svelte';
import type { SessionWorkspace } from '../lib/types/session';

const base = sessionFixtures.running[0]!;
const baseSession = base.sessions[0]!;

/** Three user prompts, each followed by a long reply. */
function workspaces(): SessionWorkspace[] {
	const transcript = Array.from({ length: 6 }, (_, index) => ({
		id: `entry-${index}`,
		kind: 'message' as const,
		role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
		body: `Message ${index}. `.repeat(index % 2 === 0 ? 3 : 500)
	}));
	return [{ ...base, sessions: [{ ...baseSession, transcript }] }];
}

const transcriptOf = () => document.querySelector<HTMLElement>('.session-view__transcript')!;
const prompts = () => [...document.querySelectorAll<HTMLElement>('.session-message--user')];
const offsetOf = (node: HTMLElement) =>
	Math.round(node.getBoundingClientRect().top - transcriptOf().getBoundingClientRect().top);

/** Resolves once the transcript has stopped scrolling, so a smooth scroll finishes before the next key. */
async function idle(): Promise<void> {
	let last = NaN;
	await expect
		.poll(
			async () => {
				await new Promise((resolve) => setTimeout(resolve, 100));
				const settled = transcriptOf().scrollTop === last;
				last = transcriptOf().scrollTop;
				return settled;
			},
			{ timeout: 5000 }
		)
		.toBe(true);
}

async function setup(motion: string) {
	document.documentElement.dataset.motion = motion;
	const keymap = new Keymap({ platform: 'other' });
	await render(SessionView, {
		props: { workspaces: workspaces(), activeSessionId: baseSession.id },
		context: new Map([[keymapContext, keymap]])
	});
	await expect.poll(() => transcriptOf().scrollHeight - transcriptOf().clientHeight).toBeGreaterThan(200);
	await expect.poll(() => transcriptOf().dataset.following).toBe('true');
	await expect
		.poll(() => transcriptOf().scrollHeight - transcriptOf().clientHeight - transcriptOf().scrollTop)
		.toBeLessThanOrEqual(1);
	const press = (key: string) =>
		keymap.handleKeydown(new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: true, cancelable: true }));
	return { press };
}

afterEach(() => {
	delete document.documentElement.dataset.motion;
});

test.each(['reduce', 'full'])('moves between prompts and stops at the ends with %s motion', async (motion) => {
	const { press } = await setup(motion);
	const [first, second, third] = prompts();

	for (const expected of [third, second, first]) {
		press('ArrowUp');
		await expect.poll(() => document.activeElement).toBe(expected);
		await idle();
	}
	expect(offsetOf(first!)).toBe(0);

	press('ArrowUp');
	await idle();
	expect(document.activeElement).toBe(first);
	expect(offsetOf(first!)).toBe(0);

	for (const expected of [second, third]) {
		press('ArrowDown');
		await expect.poll(() => document.activeElement).toBe(expected);
		await idle();
	}
	const resting = transcriptOf().scrollTop;
	press('ArrowDown');
	await idle();
	expect(document.activeElement).toBe(third);
	expect(transcriptOf().scrollTop).toBe(resting);
});

test.each(['reduce', 'full'])('moving to a prompt leaves follow mode with %s motion', async (motion) => {
	const { press } = await setup(motion);
	expect(transcriptOf().dataset.following).toBe('true');

	press('ArrowUp');
	await idle();
	press('ArrowUp');

	await expect.poll(() => transcriptOf().dataset.following).toBe('false');
});
