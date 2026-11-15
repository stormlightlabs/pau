import { afterEach, expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { sessionFixtures } from '../fixtures/sessions';
import SessionView from '../lib/SessionView.svelte';

const states = [
	['starting', 'Starting'],
	['idle', 'Ready'],
	['running', 'Running'],
	['waiting', 'Needs you'],
	['not_responding', 'Not responding'],
	['stopping', 'Stopping'],
	['stopped', 'Stopped'],
	['failed', 'Failed']
] as const;

const root = document.documentElement;
const base = sessionFixtures.idle[0]!.sessions[0]!;

afterEach(() => delete root.dataset.motion);

function marks(): SVGElement[] {
	return [...document.querySelectorAll<SVGElement>('.session-status-mark')];
}

test.each(states)('marks %s as "%s" in the rail and the header', async (status, label) => {
	await render(SessionView, {
		workspaces: [{ id: 'pau', name: 'Pau', sessions: [{ ...base, status }] }],
		activeSessionId: base.id
	});

	const found = marks();
	expect(found).toHaveLength(2);
	for (const mark of found) {
		expect(mark.getAttribute('role')).toBe('img');
		expect(mark.getAttribute('aria-label')).toBe(label);
		expect(mark.dataset.status).toBe(status);
	}
});

test('gives every state a distinct glyph', async () => {
	await render(SessionView, {
		workspaces: [{ id: 'pau', name: 'Pau', sessions: states.map(([status]) => ({ ...base, id: status, status })) }],
		activeSessionId: 'idle'
	});

	const glyphs = states.map(([status]) => {
		const mark = marks().find((candidate) => candidate.dataset.status === status)!;
		return mark.getHTML().replace(/<!--.*?-->/g, '');
	});
	expect(new Set(glyphs).size).toBe(states.length);
});

test('spins the running mark and holds it still under reduced motion', async () => {
	await render(SessionView, {
		workspaces: [{ id: 'pau', name: 'Pau', sessions: [{ ...base, status: 'running' as const }] }],
		activeSessionId: base.id
	});
	const mark = marks()[0]!;

	root.dataset.motion = 'full';
	expect(getComputedStyle(mark).animationName).toContain('session-status-spin');

	root.dataset.motion = 'reduce';
	expect(getComputedStyle(mark).animationName).toBe('none');
});
