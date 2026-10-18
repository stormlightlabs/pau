import { page } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { agentReadinessFixtures } from '../fixtures/launch';
import { sessionFixtures } from '../fixtures/sessions';
import AgentReadinessNotice from '../lib/AgentReadinessNotice.svelte';
import SessionView from '../lib/SessionView.svelte';
import { stubClipboard } from './clipboard-stub';

const notice = () => page.getByRole('region', { name: 'Pi is not ready' });

test.each([
	['missing', 'Install Pi', 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent'],
	['outdated', 'Update Pi', 'pi update'],
	['noProvider', 'run /login', 'pi']
] as const)('gives the command that fixes %s Pi', async (name, instruction, command) => {
	const writeText = stubClipboard();
	await render(AgentReadinessNotice, { problem: agentReadinessFixtures[name] });

	await expect.element(notice()).toHaveTextContent(agentReadinessFixtures[name].reason);
	await expect.element(notice()).toHaveTextContent(instruction);
	await expect.element(page.getByRole('code')).toHaveTextContent(command, { normalizeWhitespace: true });
	await page.getByRole('button', { name: 'Copy command' }).click();
	expect(writeText).toHaveBeenCalledWith(command);
});

test('shows the reason alone when there is no command', async () => {
	await render(AgentReadinessNotice, { problem: { reason: 'Pi cannot start a session.' } });

	await expect.element(notice()).toHaveTextContent('Pi cannot start a session.');
	expect(page.getByRole('code').query()).toBeNull();
	expect(page.getByRole('button', { name: 'Open terminal' }).query()).toBeNull();
});

test('opens a terminal in a workspace from the empty sessions view', async () => {
	const onOpenTerminal = vi.fn();
	await render(SessionView, {
		workspaces: sessionFixtures.idle,
		agentReadiness: agentReadinessFixtures.missing,
		onOpenTerminal
	});

	await expect.element(page.getByRole('heading', { name: 'No session selected' })).toBeVisible();
	await notice().getByRole('button', { name: 'Open terminal' }).click();
	expect(onOpenTerminal).toHaveBeenCalledWith('pau');
});

test('shows the notice on first run, before any workspace exists', async () => {
	await render(SessionView, {
		workspaces: [],
		agentReadiness: agentReadinessFixtures.noProvider,
		onOpenWorkspace: vi.fn()
	});

	await expect.element(page.getByRole('heading', { name: 'Open a folder to start working' })).toBeVisible();
	await expect.element(notice()).toBeVisible();
	expect(notice().getByRole('button', { name: 'Open terminal' }).query()).toBeNull();
});

test('stays hidden when Pi is ready', async () => {
	await render(SessionView, { workspaces: sessionFixtures.idle });

	await expect.element(page.getByRole('heading', { name: 'No session selected' })).toBeVisible();
	expect(notice().query()).toBeNull();
});
