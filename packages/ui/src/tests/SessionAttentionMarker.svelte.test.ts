import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { sessionFixtures } from '../fixtures/sessions';
import { Keymap, keymapContext } from '../lib/keymap.svelte';
import { SessionBayState, sessionBayStateContext } from '../lib/session-bay-state.svelte';
import SessionBay from '../lib/SessionBay.svelte';
import SessionView from '../lib/SessionView.svelte';
import type { SessionViewModel, SessionWorkspace } from '../lib/types/session';
import SessionViewDemo from '../stories/SessionViewDemo.svelte';

const root = document.documentElement;
const template = sessionFixtures.idle[0]!.sessions[0]!;

afterEach(() => delete root.dataset.motion);

/** A viewed session plus one more per status, each unseen unless stated. */
function rail(statuses: SessionViewModel['status'][], unseen = true): SessionWorkspace[] {
	return [
		{
			id: 'pau',
			name: 'Pau',
			sessions: [
				{ ...template, id: 'viewed', title: 'Viewed' },
				...statuses.map((status) => ({ ...template, id: `s-${status}`, title: `Session ${status}`, status, unseen }))
			]
		}
	];
}

const markers = () => [...document.querySelectorAll<HTMLElement>('.session-bay__marker')];

test.each([
	['waiting', 'waiting', 'Waiting for your input'],
	['failed', 'failed', 'Failed while out of view'],
	['idle', 'unread', 'Finished while out of view']
] as const)('marks an unseen %s session as %s', async (status, kind, label) => {
	await render(SessionView, { workspaces: rail([status]), activeSessionId: 'viewed' });

	expect(markers().map((marker) => marker.dataset.marker)).toEqual([kind]);
	await expect.element(page.getByText(label)).toBeInTheDocument();
});

test('shows no marker for a seen session or for the open session', async () => {
	await render(SessionView, { workspaces: rail(['waiting'], false), activeSessionId: 'viewed' });
	expect(markers()).toHaveLength(0);

	await render(SessionView, { workspaces: rail(['waiting']), activeSessionId: 's-waiting' });
	expect(markers()).toHaveLength(0);
});

test('holds the marker still', async () => {
	await render(SessionView, { workspaces: rail(['waiting']), activeSessionId: 'viewed' });
	root.dataset.motion = 'full';
	expect(getComputedStyle(markers()[0]!).animationName).toBe('none');
});

test('opening a marked session reports the selection that clears it', async () => {
	const onSelectSession = vi.fn();
	const view = await render(SessionView, { workspaces: rail(['failed']), activeSessionId: 'viewed', onSelectSession });

	await userEvent.click(page.getByRole('button', { name: /Session failed/ }));
	expect(onSelectSession).toHaveBeenCalledWith('s-failed');

	await view.rerender({ workspaces: rail(['failed'], false), activeSessionId: 's-failed' });
	expect(markers()).toHaveLength(0);
});

test('Shift+Esc clears all markers without interrupting a running session', async () => {
	const onClearAttention = vi.fn();
	const onInterrupt = vi.fn();
	const keymap = new Keymap({ platform: 'mac' });
	const handleKeydown = (event: KeyboardEvent) => keymap.handleKeydown(event);
	await render(SessionView, {
		props: { workspaces: sessionFixtures.running, activeSessionId: 'session-running', onClearAttention, onInterrupt },
		context: new Map([[keymapContext, keymap]])
	});
	addEventListener('keydown', handleKeydown);

	try {
		await userEvent.click(page.getByRole('textbox', { name: 'Prompt' }));
		await userEvent.keyboard('{Shift>}{Escape}{/Shift}');
	} finally {
		removeEventListener('keydown', handleKeydown);
	}

	expect(onClearAttention).toHaveBeenCalledOnce();
	expect(onInterrupt).not.toHaveBeenCalled();
});

/** A key map listening on the window, as the app's key map owner does. */
function listeningKeymap(): Keymap {
	const keymap = new Keymap({ platform: 'mac' });
	const listen = (event: KeyboardEvent) => keymap.handleKeydown(event);
	addEventListener('keydown', listen);
	onTestFinished(() => removeEventListener('keydown', listen));
	return keymap;
}

const jump = () => userEvent.keyboard('{Meta>}{Alt>}a{/Alt}{/Meta}');

test('⌥⌘A opens and focuses waiting, then failed, then unread sessions, and wraps', async () => {
	const keymap = listeningKeymap();
	await render(SessionViewDemo, {
		props: { workspaces: rail(['idle', 'failed', 'waiting']), initialSessionId: 'viewed' },
		context: new Map([[keymapContext, keymap]])
	});
	await userEvent.click(page.getByRole('textbox', { name: 'Prompt' }));

	for (const title of ['Session waiting', 'Session failed', 'Session idle', 'Session waiting']) {
		await jump();
		const strip = page.getByRole('button', { name: new RegExp(title) });
		await expect.element(strip).toHaveAttribute('aria-current', 'page');
		await expect.element(strip).toHaveFocus();
	}
});

test('⌥⌘A does nothing when no session needs attention', async () => {
	const keymap = listeningKeymap();
	await render(SessionViewDemo, {
		props: { workspaces: rail(['idle', 'running'], false), initialSessionId: 'viewed' },
		context: new Map([[keymapContext, keymap]])
	});
	const prompt = page.getByRole('textbox', { name: 'Prompt' });
	await userEvent.click(prompt);

	await jump();
	await expect.element(page.getByRole('button', { name: /Viewed/ })).toHaveAttribute('aria-current', 'page');
	await expect.element(prompt).toHaveFocus();
});

test('a jump from a view without the session open focuses the strip once the session view shows it', async () => {
	const keymap = listeningKeymap();
	const memory = new SessionBayState();
	const context = new Map<unknown, unknown>([
		[keymapContext, keymap],
		[sessionBayStateContext, memory]
	]);
	const onSelectSession = vi.fn();
	const elsewhere = await render(SessionBay, { props: { workspaces: rail(['failed']), onSelectSession }, context });

	await jump();
	expect(onSelectSession).toHaveBeenCalledWith('s-failed');
	expect(document.activeElement).toBe(document.body);
	elsewhere.unmount();

	await render(SessionView, { props: { workspaces: rail(['failed']), activeSessionId: 's-failed' }, context });
	await expect.element(page.getByRole('button', { name: /Session failed/ })).toHaveFocus();
});
