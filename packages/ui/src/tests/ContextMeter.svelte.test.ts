import { page, userEvent } from 'vitest/browser';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { sessionFixtures } from '../fixtures/sessions';
import { usageFixtures } from '../fixtures/usage';
import ContextMeter from '../lib/ContextMeter.svelte';
import SessionView from '../lib/SessionView.svelte';

const meter = () => page.getByRole('button', { name: /Context|Usage/ });
const details = () => page.getByRole('group', { name: 'Session usage' });

test('shows context use and opens the usage details', async () => {
	await render(ContextMeter, { usage: usageFixtures.normal });

	await expect.element(meter()).toHaveTextContent(/Context 84k \/ 200k.*42%/);
	await meter().click();
	await expect.element(details()).toHaveTextContent('Cost $1.23');
	await userEvent.keyboard('{Escape}');
	await expect.element(details()).not.toBeInTheDocument();
});

test('uses the Select trigger with a chevron and opens upward from its left edge', async () => {
	const target = document.createElement('div');
	target.style.marginTop = '24rem';
	document.body.append(target);
	await render(ContextMeter, { target, props: { usage: usageFixtures.normal } });

	expect(meter().element().querySelector('.context-meter__chevron')).toBeVisible();
	await meter().click();
	const panel = details().element().getBoundingClientRect();
	const anchor = meter().element().getBoundingClientRect();
	expect(panel.left).toBe(anchor.left);
	expect(panel.bottom).toBeLessThanOrEqual(anchor.top);
	target.remove();
});

test.each([
	['nearLimit', 'The context window is filling up.'],
	['atLimit', 'The context window is almost full.']
] as const)('warns at %s', async (name, note) => {
	await render(ContextMeter, { usage: usageFixtures[name] });
	await meter().click();

	await expect.element(page.getByText(note)).toBeVisible();
});

test('shows unknown context after a compaction', async () => {
	await render(ContextMeter, { usage: usageFixtures.unknownAfterCompaction });

	await expect.element(meter()).toHaveTextContent('Context unknown / 200k');
});

test('renders nothing when unsupported or not yet reported', async () => {
	const unsupported = await render(ContextMeter, { usage: usageFixtures.normal, supported: false });
	expect(unsupported.container.querySelector('button')).toBeNull();
	const unreported = await render(ContextMeter, {});
	expect(unreported.container.querySelector('button')).toBeNull();
});

function withUsage(supported: boolean) {
	return sessionFixtures.idle.map((workspace) => ({
		...workspace,
		sessions: workspace.sessions.map((session) => ({
			...session,
			usage: usageFixtures.normal,
			capabilities: { ...session.capabilities, usage: supported }
		}))
	}));
}

test('shows the meter in the session header only when the session reports usage', async () => {
	const screen = await render(SessionView, { workspaces: withUsage(true), activeSessionId: 'session-idle' });
	await expect.element(meter()).toBeVisible();
	await screen.rerender({ workspaces: withUsage(false), activeSessionId: 'session-idle' });
	await expect.element(meter()).not.toBeInTheDocument();
});
