import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { sessionFixtures } from '../fixtures/sessions';
import SessionView from '../lib/SessionView.svelte';
import type { SessionWorkspace } from '../lib/types/session';

const base = sessionFixtures.running[0]!;
const baseSession = base.sessions[0]!;

function workspaces(count: number, status = baseSession.status, id = baseSession.id): SessionWorkspace[] {
	const transcript = Array.from({ length: count }, (_, index) => ({
		id: `entry-${id}-${index}`,
		kind: 'message' as const,
		role: 'assistant' as const,
		body: `Streamed paragraph ${index}. `.repeat(12)
	}));
	return [{ ...base, sessions: [{ ...baseSession, id, status, transcript }] }];
}

function transcriptOf(): HTMLElement {
	return document.querySelector<HTMLElement>('.session-view__transcript')!;
}

const distanceFromBottom = (node: HTMLElement) => node.scrollHeight - node.clientHeight - node.scrollTop;

async function settled(): Promise<void> {
	await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

test('stays at the bottom while output streams', async () => {
	const screen = await render(SessionView, { workspaces: workspaces(30), activeSessionId: baseSession.id });
	await settled();
	expect(transcriptOf().scrollHeight).toBeGreaterThan(transcriptOf().clientHeight);
	expect(distanceFromBottom(transcriptOf())).toBeLessThanOrEqual(1);

	await screen.rerender({ workspaces: workspaces(40), activeSessionId: baseSession.id });
	await settled();

	expect(distanceFromBottom(transcriptOf())).toBeLessThanOrEqual(1);
});

test('stops following after the user scrolls up and resumes at the bottom', async () => {
	let following = true;
	const screen = await render(SessionView, {
		workspaces: workspaces(30),
		activeSessionId: baseSession.id,
		get following() {
			return following;
		},
		set following(next: boolean) {
			following = next;
		}
	});
	await settled();
	const node = transcriptOf();

	node.scrollTop = 200;
	await expect.poll(() => following).toBe(false);

	await screen.rerender({ workspaces: workspaces(40), activeSessionId: baseSession.id });
	await settled();
	expect(node.scrollTop).toBe(200);

	node.scrollTop = node.scrollHeight;
	await expect.poll(() => following).toBe(true);
	await screen.rerender({ workspaces: workspaces(45), activeSessionId: baseSession.id });
	await settled();
	expect(distanceFromBottom(node)).toBeLessThanOrEqual(1);
});

test('a notice does not move the reading position while detached', async () => {
	const screen = await render(SessionView, { workspaces: workspaces(30), activeSessionId: baseSession.id });
	await settled();
	const node = transcriptOf();
	node.scrollTop = 150;
	await settled();

	await screen.rerender({ workspaces: workspaces(30, 'failed'), activeSessionId: baseSession.id });
	await settled();

	expect(node.scrollTop).toBe(150);
});

test('switching sessions starts at the bottom', async () => {
	const screen = await render(SessionView, { workspaces: workspaces(30), activeSessionId: baseSession.id });
	await settled();
	transcriptOf().scrollTop = 0;
	await settled();

	await screen.rerender({ workspaces: workspaces(35, 'running', 'other'), activeSessionId: 'other' });
	await settled();

	expect(distanceFromBottom(transcriptOf())).toBeLessThanOrEqual(1);
});

test.each([
	['reduce', 'instant'],
	['full', 'smooth']
])('scrolls to the latest content with %s motion using %s behaviour', async (motion, behavior) => {
	document.documentElement.dataset.motion = motion;
	const screen = await render(SessionView, { workspaces: workspaces(30), activeSessionId: baseSession.id });
	await settled();
	const scrollTo = vi.spyOn(transcriptOf(), 'scrollTo');

	try {
		screen.component.scrollToLatest();
		expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior }));
	} finally {
		delete document.documentElement.dataset.motion;
	}
});
