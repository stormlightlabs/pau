import { afterEach, expect, test, vi } from 'vitest';
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

/** The first entry in view and how far its top sits below the viewport top. */
function readingPosition(node: HTMLElement): { entryId: string; offset: number } {
	const top = node.getBoundingClientRect().top;
	const entry = [...node.querySelectorAll<HTMLElement>('[data-entry-id]')].find(
		(candidate) => candidate.getBoundingClientRect().bottom > top
	)!;
	return { entryId: entry.dataset.entryId!, offset: Math.round(entry.getBoundingClientRect().top - top) };
}

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

test('keeps following when output grows before its own scroll event arrives', async () => {
	const screen = await render(SessionView, { workspaces: workspaces(30), activeSessionId: baseSession.id });
	await settled();
	const node = transcriptOf();

	// The follow action pins the transcript from a resize observer, and the
	// browser reports that scroll on the next frame. Output that lands in
	// between must not read as the operator scrolling up.
	const pinned = new Promise<void>((resolve) => {
		const observer = new ResizeObserver(() => {
			observer.disconnect();
			resolve();
		});
		observer.observe(node.firstElementChild!);
	});
	await screen.rerender({ workspaces: workspaces(40), activeSessionId: baseSession.id });
	await pinned;
	await new Promise((resolve) => setTimeout(resolve, 0));
	await screen.rerender({ workspaces: workspaces(50), activeSessionId: baseSession.id });
	await settled();

	expect(node.dataset.following).toBe('true');
	expect(distanceFromBottom(node)).toBeLessThanOrEqual(1);
});

test('scrolling up to an earlier pin position stops following', async () => {
	const screen = await render(SessionView, { workspaces: workspaces(30), activeSessionId: baseSession.id });
	await settled();
	const node = transcriptOf();
	const pinnedAt = node.scrollTop;

	node.scrollTop = 200;
	await expect.poll(() => node.dataset.following).toBe('false');
	const height = node.scrollHeight;
	await screen.rerender({ workspaces: workspaces(40), activeSessionId: baseSession.id });
	await expect.poll(() => node.scrollHeight).toBeGreaterThan(height);
	await settled();
	node.scrollTop = node.scrollHeight;
	await expect.poll(() => node.dataset.following).toBe('true');

	node.scrollTop = pinnedAt;
	await expect.poll(() => node.dataset.following).toBe('false');
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
	const reading = readingPosition(node);

	const height = node.scrollHeight;
	await screen.rerender({ workspaces: workspaces(40), activeSessionId: baseSession.id });
	// Wait for the new entries to lay out before asserting that the position held.
	await expect.poll(() => node.scrollHeight).toBeGreaterThan(height);
	await settled();
	// The entry in view holds its place. The scroll offset itself may change
	// when content above it reflows, such as when a font finishes loading.
	expect(readingPosition(node)).toEqual(reading);
	expect(following).toBe(false);

	node.scrollTop = node.scrollHeight;
	await expect.poll(() => following).toBe(true);
	const grown = node.scrollHeight;
	await screen.rerender({ workspaces: workspaces(45), activeSessionId: baseSession.id });
	await expect.poll(() => node.scrollHeight).toBeGreaterThan(grown);
	await expect.poll(() => distanceFromBottom(node)).toBeLessThanOrEqual(1);
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

test('returning to a session restores its follow mode or reading position', async () => {
	const screen = await render(SessionView, { workspaces: workspaces(30), activeSessionId: baseSession.id });
	await settled();
	const node = transcriptOf();
	const firstVisible = () => readingPosition(node).entryId;

	await screen.rerender({ workspaces: workspaces(30, 'running', 'other'), activeSessionId: 'other' });
	await settled();
	node.scrollTop = 300;
	await settled();
	const reading = firstVisible();
	expect(node.dataset.following).toBe('false');

	await screen.rerender({ workspaces: workspaces(30), activeSessionId: baseSession.id });
	await settled();
	expect(node.dataset.following).toBe('true');
	expect(distanceFromBottom(node)).toBeLessThanOrEqual(1);

	await screen.rerender({ workspaces: workspaces(30, 'running', 'other'), activeSessionId: 'other' });
	await settled();
	expect(node.dataset.following).toBe('false');
	expect(firstVisible()).toBe(reading);
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

afterEach(() => {
	delete document.documentElement.dataset.motion;
});

const jumpButton = () => document.querySelector<HTMLButtonElement>('.session-view__jump');

async function detached(count = 30) {
	const screen = await render(SessionView, { workspaces: workspaces(count), activeSessionId: baseSession.id });
	await settled();
	return { screen, isFollowing: () => transcriptOf().dataset.following === 'true' };
}

test('Jump to latest is hidden while following', async () => {
	const { screen } = await detached();
	await screen.rerender({ workspaces: workspaces(40), activeSessionId: baseSession.id });
	await settled();
	expect(jumpButton()).toBeNull();
});

test('Jump to latest appears after new output arrives while detached, and resumes following', async () => {
	// Instant scrolling keeps the test independent of smooth-scroll timing.
	document.documentElement.dataset.motion = 'reduce';
	const { screen, isFollowing } = await detached();
	const node = transcriptOf();
	node.scrollTop = 100;
	await expect.poll(isFollowing).toBe(false);
	expect(jumpButton()).toBeNull();

	await screen.rerender({ workspaces: workspaces(33), activeSessionId: baseSession.id });
	await expect.poll(jumpButton).not.toBeNull();
	expect(jumpButton()).toHaveTextContent('3 new');
	await expect.poll(() => document.querySelector('.session-view__announcer')?.textContent).toBe('New output below');

	jumpButton()!.click();
	await expect.poll(isFollowing).toBe(true);
	await expect.poll(jumpButton).toBeNull();
});

test('Jump to latest does not take focus from the composer', async () => {
	// Instant scrolling keeps the test independent of smooth-scroll timing.
	document.documentElement.dataset.motion = 'reduce';
	const { screen, isFollowing } = await detached();
	transcriptOf().scrollTop = 100;
	await expect.poll(isFollowing).toBe(false);
	await screen.rerender({ workspaces: workspaces(33), activeSessionId: baseSession.id });
	await expect.poll(jumpButton).not.toBeNull();
	const composer = document.querySelector<HTMLTextAreaElement>('textarea')!;
	composer.focus();

	const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
	jumpButton()!.dispatchEvent(down);

	expect(down.defaultPrevented).toBe(true);
	expect(document.activeElement).toBe(composer);
});

test('Ctrl+End jumps to the latest output outside text fields', async () => {
	// Instant scrolling keeps the test independent of smooth-scroll timing.
	document.documentElement.dataset.motion = 'reduce';
	const { screen, isFollowing } = await detached();
	transcriptOf().scrollTop = 100;
	await expect.poll(isFollowing).toBe(false);
	await screen.rerender({ workspaces: workspaces(33), activeSessionId: baseSession.id });
	await expect.poll(jumpButton).not.toBeNull();

	const inField = new KeyboardEvent('keydown', { key: 'End', ctrlKey: true, bubbles: true, cancelable: true });
	document.querySelector('textarea')!.dispatchEvent(inField);
	expect(inField.defaultPrevented).toBe(false);

	const outside = new KeyboardEvent('keydown', { key: 'End', ctrlKey: true, bubbles: true, cancelable: true });
	document.body.dispatchEvent(outside);
	expect(outside.defaultPrevented).toBe(true);
	await expect.poll(isFollowing).toBe(true);
});

test.each([
	['reduce', false],
	['full', true]
])('Jump to latest fades with %s motion: %s', async (motion, fades) => {
	document.documentElement.dataset.motion = motion;
	try {
		const { screen, isFollowing } = await detached();
		transcriptOf().scrollTop = 100;
		await expect.poll(isFollowing).toBe(false);
		await screen.rerender({ workspaces: workspaces(33), activeSessionId: baseSession.id });
		await expect.poll(jumpButton).not.toBeNull();
		expect(jumpButton()!.getAnimations().length > 0).toBe(fades);
	} finally {
		delete document.documentElement.dataset.motion;
	}
});
