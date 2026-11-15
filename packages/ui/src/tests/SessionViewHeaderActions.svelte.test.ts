import { page } from 'vitest/browser';
import { beforeEach, expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { sessionFixtures } from '../fixtures/sessions';
import SessionView from '../lib/SessionView.svelte';
import type { SessionWorkspace } from '../lib/types/session';

beforeEach(async () => {
	await page.viewport(1440, 900);
});

const states: [string, SessionWorkspace[], string][] = [
	['idle', sessionFixtures.idle, 'Ready'],
	['running', sessionFixtures.running, 'Running'],
	['waiting', sessionFixtures.waiting, 'Needs you'],
	['compacting', sessionFixtures.compactingManual, 'Compacting…']
];

const open = (workspaces: SessionWorkspace[]) => ({
	workspaces,
	activeSessionId: workspaces[0]!.sessions[0]!.id,
	onStop: async () => {},
	onCompact: async () => {}
});

const box = (element: Element) => element.getBoundingClientRect();

async function measure(fixture: SessionWorkspace[]) {
	const { unmount } = await render(SessionView, open(fixture));
	const result = {
		status: box(document.querySelector('.session-view__status')!),
		compact: box(page.getByRole('button', { name: 'Compact' }).element()),
		stop: box(page.getByRole('button', { name: 'Stop' }).element())
	};
	unmount();
	return result;
}

test.each(states)('keeps the %s header actions where the idle header puts them', async (_name, workspaces) => {
	const idle = await measure(sessionFixtures.idle);
	const other = await measure(workspaces);
	for (const key of ['status', 'compact', 'stop'] as const) {
		expect(other[key].left).toBe(idle[key].left);
		expect(other[key].width).toBe(idle[key].width);
	}
	// Status leads, then Compact, then Stop.
	expect(other.status.right).toBeLessThanOrEqual(other.compact.left);
	expect(other.compact.right).toBeLessThanOrEqual(other.stop.left);
});

test.each(states)('reports the %s state in the header status', async (_name, workspaces, label) => {
	await render(SessionView, open(workspaces));
	expect(document.querySelector('.session-view__status .pau-mark')?.getAttribute('aria-label')).toBe(label);
	expect(document.querySelector('.session-view__status')?.textContent?.trim()).toBe(label);
	await expect
		.element(page.getByRole('button', { name: 'Compact' }))
		.toHaveAttribute('aria-busy', label === 'Compacting…' ? 'true' : 'false');
});
