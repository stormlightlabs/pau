import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { claudeReadinessFixtures } from '../fixtures/launch';
import { sessionFixtures } from '../fixtures/sessions';
import SessionView from '../lib/SessionView.svelte';

/** Every handler the session surface accepts, so only capabilities decide what shows. */
const handlers = () => ({
	onSendPrompt: vi.fn(),
	onInterrupt: vi.fn(),
	onStop: vi.fn(),
	onCompact: vi.fn(),
	onRenameSession: vi.fn(),
	onCloneSession: vi.fn(),
	onRunShellCommand: vi.fn(),
	onLoadModels: vi.fn().mockResolvedValue([]),
	onSelectModel: vi.fn(),
	onSelectThinkingLevel: vi.fn()
});

const claudeNotice = () => page.getByRole('region', { name: 'Claude Code is not ready' });

test('offers an idle Claude Code session only the controls it supports', async () => {
	await render(SessionView, { workspaces: sessionFixtures.claude, activeSessionId: 'claude-idle', ...handlers() });

	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toBeEnabled();
	await expect.element(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
	await expect.element(page.getByRole('button', { name: 'Compact' })).not.toBeInTheDocument();
	await expect.element(page.getByRole('button', { name: /^Model/ })).not.toBeInTheDocument();
	await expect.element(page.getByRole('combobox', { name: 'Thinking level' })).not.toBeInTheDocument();

	await userEvent.click(page.getByRole('button', { name: /Review the adapter/ }), { button: 'right' });
	await expect.element(page.getByRole('menu')).toBeVisible();
	await expect.element(page.getByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();
	await expect.element(page.getByRole('menuitem', { name: 'Clone' })).not.toBeInTheDocument();
	await expect.element(page.getByRole('menuitem', { name: 'Stop' })).toBeVisible();
});

test('lets a running Claude Code session be interrupted but not steered', async () => {
	const onInterrupt = vi.fn();
	await render(SessionView, {
		workspaces: sessionFixtures.runningWithoutQueue,
		activeSessionId: 'session-no-queue',
		...handlers(),
		onInterrupt
	});

	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toBeDisabled();
	await expect.element(page.getByText(/Claude Code cannot take new direction during a run/)).toBeVisible();
	await userEvent.click(page.getByRole('button', { name: /Interrupt/ }));
	expect(onInterrupt).toHaveBeenCalledWith('session-no-queue');
});

test('starts a Claude Code session from the New session menu', async () => {
	const onStartSession = vi.fn();
	await render(SessionView, {
		workspaces: sessionFixtures.idleWithPath,
		activeSessionId: 'session-idle',
		onStartSession
	});

	await userEvent.click(page.getByRole('button', { name: 'More ways to start a session' }));
	await userEvent.click(page.getByRole('menuitem', { name: 'New Claude Code session' }));
	expect(onStartSession).toHaveBeenCalledWith('pau', 'claude');
});

test.each(['missing', 'unsupported', 'missingBridge'] as const)(
	'disables Claude Code with its reason when it is %s',
	async (state) => {
		const problem = claudeReadinessFixtures[state];
		const onStartSession = vi.fn();
		await render(SessionView, {
			workspaces: sessionFixtures.idleWithPath,
			activeSessionId: 'session-idle',
			onStartSession,
			claudeReadiness: problem
		});

		await userEvent.click(page.getByRole('button', { name: 'More ways to start a session' }));
		const item = page.getByRole('menuitem', { name: 'New Claude Code session' });
		await expect.element(item).toBeDisabled();
		await expect.element(item).toHaveAccessibleDescription(problem.reason.replaceAll('`', ''));
		await expect.element(page.getByRole('menuitem', { name: 'New session' })).toBeEnabled();
	}
);

test('explains a missing Claude Code where an opened workspace starts sessions', async () => {
	const onStartSession = vi.fn();
	await render(SessionView, {
		workspaces: sessionFixtures.workspaceWithoutSessions,
		onStartSession,
		onOpenWorkspace: vi.fn().mockResolvedValue('pau'),
		claudeReadiness: claudeReadinessFixtures.missing
	});
	await userEvent.click(page.getByRole('button', { name: 'More ways to start a session' }));
	await userEvent.click(page.getByRole('menuitem', { name: 'Open workspace…' }));
	await userEvent.fill(page.getByRole('textbox', { name: 'Folder path' }), '/Users/operator/projects/pau');
	await userEvent.click(page.getByRole('button', { name: 'Open', exact: true }));

	await expect.element(page.getByRole('heading', { name: 'Pau is open' })).toBeVisible();
	const reason = claudeReadinessFixtures.missing.reason.replaceAll('`', '');
	const startClaude = page.getByRole('button', { name: 'Start Claude Code session' });
	await expect.element(startClaude).toBeDisabled();
	await expect.element(startClaude).toHaveAccessibleDescription(reason);
	await expect.element(claudeNotice()).toHaveTextContent(reason);
	await userEvent.click(page.getByRole('button', { name: 'Start session' }));
	expect(onStartSession).toHaveBeenCalledWith('pau', 'pi');
});

test('retries a failed Claude Code start with Claude Code', async () => {
	const onStartSession = vi
		.fn()
		.mockRejectedValueOnce(new Error('Claude Code was not found.'))
		.mockResolvedValueOnce(undefined);
	await render(SessionView, {
		workspaces: sessionFixtures.idleWithPath,
		activeSessionId: 'session-idle',
		onStartSession
	});
	await userEvent.click(page.getByRole('button', { name: 'More ways to start a session' }));
	await userEvent.click(page.getByRole('menuitem', { name: 'New Claude Code session' }));

	await expect.element(page.getByRole('alert')).toHaveTextContent('Claude Code was not found.');
	await userEvent.click(page.getByRole('button', { name: 'Try again' }));
	expect(onStartSession).toHaveBeenNthCalledWith(2, 'pau', 'claude');
});
