import { page, userEvent } from 'vitest/browser';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { statusBarFixtures } from '../fixtures/status-bar';
import StatusBar from '../lib/StatusBar.svelte';

const { version, agentVersion } = statusBarFixtures;
const bar = () => page.getByRole('contentinfo', { name: 'Status' });
const pau = () => page.getByRole('button', { name: /^Pau/ });
const panel = () => page.getByRole('group', { name: 'Resource use' });

test('shows the workspace, the session, its process tree and the totals', async () => {
	await render(StatusBar, { version, agentVersion, ...statusBarFixtures.busy });

	await expect.element(bar()).toHaveTextContent('Branch main');
	await expect.element(bar()).toHaveTextContent('No changes');
	await expect.element(bar()).toHaveTextContent('No sandbox');
	await expect.element(bar()).toHaveTextContent('Pi 0.70.2');
	await expect.element(bar()).toHaveTextContent('Context 61%');
	await expect.element(bar()).toHaveTextContent('139k tokens');
	await expect.element(bar()).toHaveTextContent('$1.84');
	await expect.element(bar()).toHaveTextContent('Session CPU 41.6% · 512 MiB · 3 processes');
	await expect.element(pau()).toHaveTextContent('Pau 0.6.0');
	await expect.element(pau()).toHaveTextContent('23 processes');
});

test('lists each running session and its processes, and closes on Escape', async () => {
	await render(StatusBar, { version, ...statusBarFixtures.manyProcesses });

	await userEvent.click(pau());
	await expect.element(panel()).toBeVisible();
	await expect.element(panel().getByRole('heading', { name: 'Sessions 2' })).toBeVisible();
	const crowd = panel().getByRole('list', { name: 'Processes of Model list filter' });
	await expect.element(crowd.getByRole('listitem').first()).toHaveTextContent('claude');
	await expect.element(crowd.getByRole('listitem').nth(1)).toHaveTextContent('rustc');
	expect(crowd.getByRole('listitem').elements()).toHaveLength(14);
	await expect.element(panel()).toHaveTextContent('Claude Code 2.1.4');

	await userEvent.keyboard('{Escape}');
	await expect.element(panel()).not.toBeInTheDocument();
	await expect.element(pau()).toHaveFocus();
});

test('counts the processes a large tree leaves out of the list', async () => {
	await render(StatusBar, { version, ...statusBarFixtures.runaway });

	await userEvent.click(pau());
	const crowd = panel().getByRole('list', { name: 'Processes of Model list filter' });
	expect(crowd.getByRole('listitem').elements()).toHaveLength(15);
	await expect.element(crowd.getByRole('listitem').last()).toHaveTextContent('and 312 more');
});

test('closes on an outside press', async () => {
	await render(StatusBar, { version, ...statusBarFixtures.idle });

	await userEvent.click(pau());
	await expect.element(panel()).toBeVisible();
	await userEvent.click(bar().getByText('No changes'));
	await expect.element(panel()).not.toBeInTheDocument();
});

test('names a workspace without a session and a missing sample', async () => {
	await render(StatusBar, { version, ...statusBarFixtures.noSession, usage: undefined });

	await expect.element(bar()).toHaveTextContent('No session');
	await expect.element(bar()).toHaveTextContent('4 changed');
	await expect.element(bar()).toHaveTextContent('Sandboxed');
	await userEvent.click(pau());
	await expect.element(panel()).toHaveTextContent("Resource use isn't measured.");
});

test('says when no workspace is open', async () => {
	await render(StatusBar, { version });
	await expect.element(bar()).toHaveTextContent('No workspace open');
});
