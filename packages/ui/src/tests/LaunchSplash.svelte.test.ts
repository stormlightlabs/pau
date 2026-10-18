import { createRawSnippet } from 'svelte';
import { page } from 'vitest/browser';
import { afterEach, expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { launchFixtures } from '../fixtures/launch';
import LaunchSplash from '../lib/LaunchSplash.svelte';
import { stubClipboard } from './clipboard-stub';

const app = createRawSnippet(() => ({ render: () => '<p>Workspace view</p>' }));
const splash = () => page.getByRole('main');
const step = (label: string) => page.getByRole('listitem').filter({ hasText: label });

afterEach(() => {
	delete document.documentElement.dataset.motion;
});

test.each([
	['starting', 'Launch 2 / 4', 'Opening the database'],
	['service', 'Launch 3 / 4', 'Starting the local service'],
	['checking', 'Launch 4 / 4', 'Checking Pi']
] as const)('names the current step while %s', async (name, count, label) => {
	await render(LaunchSplash, { phase: 'running', steps: launchFixtures[name] });

	await expect.element(page.getByText(count)).toBeVisible();
	await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent(label);
	await expect.element(step(label)).toHaveAttribute('aria-current', 'step');
	await expect.element(step('Loading your shell PATH')).toHaveTextContent('Done');
	expect(splash().element().textContent).not.toMatch(/%/);
	expect(splash().element().querySelector('progress')).toBeNull();
});

test('shows a step that failed without stopping launch', async () => {
	await render(LaunchSplash, { phase: 'running', steps: launchFixtures.slowPath });

	await expect.element(step('Loading your shell PATH')).toHaveTextContent('Needs attention');
	await expect.element(page.getByText(/took longer than 5 seconds/)).toBeVisible();
	await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent('Starting the local service');
	expect(page.getByRole('alert').query()).toBeNull();
});

test('shows the failed step, its reason, and the update action', async () => {
	const writeText = stubClipboard();
	await render(LaunchSplash, { phase: 'failed', steps: launchFixtures.newerDatabase });

	await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent('Pau could not start');
	await expect.element(step('Opening the database')).toHaveTextContent('Failed');
	await expect.element(page.getByText(/created by a newer version of Pau/)).toBeVisible();
	await expect
		.element(page.getByRole('alert'))
		.toHaveTextContent('This data comes from a newer version of Pau. Install that version to open it.');
	await expect.element(splash()).toHaveAttribute('aria-busy', 'false');

	await page.getByRole('button', { name: 'Copy details' }).click();
	await expect.poll(() => writeText.mock.calls.length).toBe(1);
	expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Opening the database: Failed'));
	expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Install that version'));
});

test('shows a failure that has no action', async () => {
	await render(LaunchSplash, { phase: 'failed', steps: launchFixtures.backendFailure });

	await expect.element(step('Starting the local service')).toHaveTextContent('Address already in use');
	await expect.element(page.getByRole('button', { name: 'Copy details' })).toBeVisible();
});

test('shows an error when launch could not be followed', async () => {
	await render(LaunchSplash, { phase: 'failed', steps: [], error: 'The startup command is not available.' });

	await expect.element(page.getByRole('alert')).toHaveTextContent('The startup command is not available.');
});

test('shows the app once launch is ready and fades the splash out', async () => {
	document.documentElement.dataset.motion = 'full';
	const screen = await render(LaunchSplash, { phase: 'running', steps: launchFixtures.checking, children: app });
	expect(page.getByText('Workspace view').query()).toBeNull();

	await screen.rerender({ phase: 'ready', steps: launchFixtures.ready, children: app });

	await expect.element(page.getByText('Workspace view')).toBeInTheDocument();
	expect(splash().query()).not.toBeNull();
	await expect.element(splash()).not.toBeInTheDocument();
});

test('removes the splash at once under reduced motion', async () => {
	document.documentElement.dataset.motion = 'reduce';
	const screen = await render(LaunchSplash, { phase: 'running', steps: launchFixtures.checking, children: app });

	await screen.rerender({ phase: 'ready', steps: launchFixtures.ready, children: app });

	await expect.element(page.getByText('Workspace view')).toBeInTheDocument();
	await new Promise(requestAnimationFrame);
	expect(splash().query()).toBeNull();
});
