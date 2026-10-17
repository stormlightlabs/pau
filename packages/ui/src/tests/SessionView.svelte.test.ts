import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { sessionFixtures } from '../fixtures/sessions';
import SessionView from '../lib/SessionView.svelte';
import SessionViewDemo from '../stories/SessionViewDemo.svelte';

const stateCases = [
	['starting', sessionFixtures.starting, 'session-starting', 'Starting the agent process…'],
	['running', sessionFixtures.running, 'session-running', 'Running'],
	['waiting', sessionFixtures.waiting, 'session-waiting', 'Attention required.'],
	['failed', sessionFixtures.failed, 'session-failed', 'Session failed.'],
	['stopped', sessionFixtures.stopped, 'session-stopped', 'This session has stopped.']
] as const;

test('shows the empty session state', async () => {
	await render(SessionView, { workspaces: sessionFixtures.empty });

	await expect.element(page.getByRole('heading', { name: 'No session selected' })).toBeVisible();
});

test.each(stateCases)('shows the %s state', async (_name, workspaces, activeSessionId, expectedText) => {
	await render(SessionView, { workspaces, activeSessionId });

	await expect.element(page.getByText(expectedText, { exact: false }).last()).toBeVisible();
});

test('sends a prompt and interrupts a running session from the keyboard', async () => {
	const onSend = vi.fn();
	const onInterrupt = vi.fn();
	await render(SessionView, {
		workspaces: sessionFixtures.running,
		activeSessionId: 'session-running',
		onSend,
		onInterrupt
	});
	const prompt = page.getByRole('textbox', { name: 'Prompt' });

	await userEvent.click(prompt);
	await userEvent.type(prompt, 'Keep the renderer API unchanged.');
	await userEvent.keyboard('{Control>}{Enter}{/Control}');
	expect(onSend).toHaveBeenCalledWith('session-running', 'Keep the renderer API unchanged.', 'steer');

	await userEvent.keyboard('{Escape}');
	expect(onInterrupt).toHaveBeenCalledWith('session-running');
});

test('switches concurrent sessions with the keyboard', async () => {
	await render(SessionViewDemo, { workspaces: sessionFixtures.concurrent, initialSessionId: 'diff-gutter' });
	await userEvent.click(page.getByRole('button', { name: 'Open navigation' }));
	const active = page.getByRole('button', { name: /Fix diff gutter/ });

	await userEvent.click(active);
	await userEvent.keyboard('{ArrowDown}');

	await expect.element(page.getByRole('heading', { name: 'Review session registry' })).toBeVisible();
	await expect
		.element(page.getByRole('button', { name: /Review session registry/ }))
		.toHaveAttribute('aria-current', 'page');
});

test('shows file, network, and unexplained sandbox denials in their owning session', async () => {
	await render(SessionViewDemo, { workspaces: sessionFixtures.sandboxDenials, initialSessionId: 'sandbox-denials' });

	await expect.element(page.getByText('Sandbox blocked a file read')).toBeVisible();
	await expect.element(page.getByText('/home/me/.ssh/id_ed25519')).toBeVisible();
	await expect.element(page.getByText('Sandbox blocked a file write')).toBeVisible();
	await expect.element(page.getByText('/work/pau/.git/config')).toBeVisible();
	await expect.element(page.getByText('Sandbox blocked network access')).toBeVisible();
	await expect.element(page.getByText('api.example.com:443')).toBeVisible();
	await expect.element(page.getByText('Sandbox may have blocked this call')).toBeVisible();

	await userEvent.click(page.getByRole('button', { name: 'Open navigation' }));
	await userEvent.click(page.getByRole('button', { name: /Session without denials/ }));
	await expect.element(page.getByLabelText('Sandbox denial').first()).not.toBeInTheDocument();
});

test('exposes tool activity and disabled stopped controls', async () => {
	await render(SessionView, { workspaces: sessionFixtures.stopped, activeSessionId: 'session-stopped' });

	await expect.element(page.getByText('src/diff/gutter.ts')).toBeVisible();
	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toBeDisabled();
	await expect.element(page.getByRole('button', { name: /Send prompt/ })).toBeDisabled();
});

test('shows the loading state before sessions arrive', async () => {
	await render(SessionView, { workspaces: [], loading: true });

	await expect.element(page.getByRole('heading', { name: 'Loading sessions…' })).toBeVisible();
});

test('explains a failed start and retries it', async () => {
	const onStartSession = vi
		.fn()
		.mockRejectedValueOnce(new Error('Pau could not find a working Pi installation.'))
		.mockResolvedValueOnce(undefined);
	await render(SessionView, { workspaces: sessionFixtures.workspaceWithoutSessions, onStartSession });
	await userEvent.click(page.getByRole('button', { name: 'Open navigation' }));

	await userEvent.click(page.getByRole('button', { name: 'Start session in Pau' }));
	await expect.element(page.getByRole('alert')).toHaveTextContent('Pau could not find a working Pi installation.');

	await userEvent.click(page.getByRole('button', { name: 'Close navigation' }));
	await userEvent.click(page.getByRole('button', { name: 'Try again' }));
	expect(onStartSession).toHaveBeenNthCalledWith(2, 'pau');
	await expect.element(page.getByRole('heading', { name: 'No session selected' })).toBeVisible();
});

test('disables sending and stopping while disconnected', async () => {
	await render(SessionView, {
		workspaces: sessionFixtures.idle,
		activeSessionId: 'session-idle',
		disconnected: true,
		onStartSession: vi.fn()
	});

	await expect.element(page.getByText(/Pau lost its connection to the backend/)).toBeVisible();
	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toBeDisabled();
	await expect.element(page.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled();
});

test('disables interrupting while disconnected', async () => {
	const onInterrupt = vi.fn();
	await render(SessionView, {
		workspaces: sessionFixtures.running,
		activeSessionId: 'session-running',
		disconnected: true,
		onInterrupt
	});

	await expect.element(page.getByRole('button', { name: /Interrupt/ })).toBeDisabled();
	await userEvent.keyboard('{Escape}');
	expect(onInterrupt).not.toHaveBeenCalled();
});

test('explains why a running session without queues cannot take a prompt', async () => {
	await render(SessionView, { workspaces: sessionFixtures.runningWithoutQueue, activeSessionId: 'session-no-queue' });

	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toBeDisabled();
	await expect.element(page.getByText(/Claude cannot take new direction during a run/)).toBeVisible();
	await expect.element(page.getByRole('combobox')).not.toBeInTheDocument();
});

test('stops the active session from its header', async () => {
	const onStop = vi.fn();
	await render(SessionView, { workspaces: sessionFixtures.idle, activeSessionId: 'session-idle', onStop });

	await userEvent.click(page.getByRole('button', { name: 'Stop', exact: true }));
	expect(onStop).toHaveBeenCalledWith('session-idle');
});
