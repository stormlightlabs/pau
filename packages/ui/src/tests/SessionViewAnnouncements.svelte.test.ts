import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { sessionFixtures } from '../fixtures/sessions';
import SessionView from '../lib/SessionView.svelte';
import type { SessionViewModel, SessionWorkspace } from '../lib/types/session';

const base = sessionFixtures.running[0]!;
const baseSession = base.sessions[0]!;

function workspaces(patch: Partial<SessionViewModel>): SessionWorkspace[] {
	return [{ ...base, sessions: [{ ...baseSession, ...patch }] }];
}

const announcer = () => document.querySelector('.session-view__announcer')!;

const entry = (body: string) => ({ id: 'm1', kind: 'message' as const, role: 'assistant' as const, body });

test('the transcript is not a live region', async () => {
	await render(SessionView, { workspaces: workspaces({}), activeSessionId: baseSession.id });
	expect(document.querySelector('.session-view__transcript')).not.toHaveAttribute('aria-live');
});

test('announces a response once, however much text streams in', async () => {
	const props = (patch: Partial<SessionViewModel>) => ({
		workspaces: workspaces(patch),
		activeSessionId: baseSession.id
	});
	const screen = await render(SessionView, props({ status: 'idle', transcript: [] }));
	for (const body of ['Reading', 'Reading the', 'Reading the files', 'Reading the files now']) {
		await screen.rerender(props({ status: 'running', transcript: [entry(body)] }));
	}
	await expect.poll(() => announcer().textContent).toBe(`${baseSession.agent} is responding`);

	await screen.rerender(props({ status: 'idle', transcript: [entry('Found it. Nothing else changed.')] }));
	await expect.poll(() => announcer().textContent).toBe(`${baseSession.agent} finished: Found it.`);
});
