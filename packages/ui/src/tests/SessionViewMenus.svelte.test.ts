import { page, userEvent } from 'vitest/browser';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { sessionFixtures } from '../fixtures/sessions';
import SessionView from '../lib/SessionView.svelte';

const writeText = vi.fn<(data: string) => Promise<void>>();

beforeEach(() => {
	writeText.mockReset().mockResolvedValue(undefined);
	vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(writeText);
});

afterEach(() => vi.restoreAllMocks());

test('opens a session menu from the keyboard and renames the session', async () => {
	const onRenameSession = vi.fn();
	const onCloneSession = vi.fn();
	await render(SessionView, {
		workspaces: sessionFixtures.idleWithPath,
		activeSessionId: 'session-idle',
		onRenameSession,
		onCloneSession
	});
	const row = page.getByRole('button', { name: /Fix diff gutter/ });

	await userEvent.click(row);
	await userEvent.keyboard('{Shift>}{F10}{/Shift}');

	const menu = page.getByRole('menu', { name: 'Fix diff gutter actions' });
	await expect.element(menu).toBeVisible();
	await expect.element(menu).toHaveTextContent(/Open.*Rename….*Clone.*Copy session ID.*Stop.*Archive/);
	await expect.element(page.getByRole('menuitem', { name: 'Archive' })).toHaveAccessibleDescription('Coming soon');

	await userEvent.click(page.getByRole('menuitem', { name: 'Rename…' }));
	const name = page.getByRole('textbox', { name: 'Session name' });
	await expect.element(name).toHaveFocus();
	await userEvent.clear(name);
	await userEvent.type(name, 'Gutter fix{Enter}');

	expect(onRenameSession).toHaveBeenCalledWith('session-idle', 'Gutter fix');
	await expect.element(row).toHaveFocus();
});

test('copies the session ID and explains why an ended session cannot stop', async () => {
	const onStop = vi.fn();
	await render(SessionView, {
		workspaces: sessionFixtures.idleWithPath,
		activeSessionId: 'session-idle',
		onStop,
		onRenameSession: vi.fn()
	});
	const stopped = page.getByRole('button', { name: /Review fixtures/ });
	await expect.element(stopped).toBeVisible();

	stopped.element().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 80 }));
	const stop = page.getByRole('menuitem', { name: 'Stop' });
	await expect.element(stop).toHaveAccessibleDescription('This session has ended.');
	await expect.element(page.getByRole('menuitem', { name: 'Rename…' })).toHaveAttribute('aria-disabled', 'true');
	await userEvent.click(stop, { force: true });
	expect(onStop).not.toHaveBeenCalled();

	await userEvent.click(page.getByRole('menuitem', { name: 'Copy session ID' }));
	expect(writeText).toHaveBeenCalledWith('session-stopped');
	await expect.element(page.getByRole('menu')).not.toBeInTheDocument();
});

test('offers workspace actions and leaves removal for later', async () => {
	const onStartSession = vi.fn();
	const onOpenTerminal = vi.fn();
	const revealPath = vi.fn().mockResolvedValue(undefined);
	await render(SessionView, {
		workspaces: sessionFixtures.idleWithPath,
		activeSessionId: 'session-idle',
		onStartSession,
		onOpenTerminal,
		revealPath
	});
	const heading = page.getByRole('button', { name: 'Pau actions' });

	(heading.element() as HTMLElement).focus();
	await userEvent.keyboard('{ContextMenu}');
	await expect.element(page.getByRole('menu', { name: 'Pau actions' })).toBeVisible();
	await expect
		.element(page.getByRole('menuitem', { name: 'Remove workspace' }))
		.toHaveAccessibleDescription('Coming soon');
	await userEvent.click(page.getByRole('menuitem', { name: 'Copy path' }));
	expect(writeText).toHaveBeenCalledWith('/Users/operator/projects/pau');
	await expect.element(heading).toHaveFocus();

	await userEvent.keyboard('{Shift>}{F10}{/Shift}');
	await userEvent.click(page.getByRole('menuitem', { name: /Reveal in Finder|Show in folder/ }));
	expect(revealPath).toHaveBeenCalledWith('/Users/operator/projects/pau');

	await userEvent.keyboard('{Shift>}{F10}{/Shift}');
	await userEvent.click(page.getByRole('menuitem', { name: 'Open terminal' }));
	expect(onOpenTerminal).toHaveBeenCalledWith('pau');

	await userEvent.keyboard('{Shift>}{F10}{/Shift}');
	await userEvent.click(page.getByRole('menuitem', { name: 'New session' }));
	expect(onStartSession).toHaveBeenCalledWith('pau', 'pi');
});

test('copies a message and branches from a user message', async () => {
	const onBranchFromMessage = vi.fn().mockResolvedValue({ text: 'Fix the gutter again', cancelled: false });
	await render(SessionView, {
		workspaces: sessionFixtures.idleWithPath,
		activeSessionId: 'session-idle',
		onBranchFromMessage
	});
	const answer = page.getByRole('article', { name: 'assistant message' });

	(answer.element() as HTMLElement).focus();
	await userEvent.keyboard('{Shift>}{F10}{/Shift}');
	await expect.element(page.getByRole('menu', { name: 'Message actions' })).toBeVisible();
	await expect.element(page.getByRole('menuitem', { name: 'Branch from here' })).not.toBeInTheDocument();
	await userEvent.click(page.getByRole('menuitem', { name: 'Copy as Markdown' }));
	expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('Gutter rows now follow visual line offsets'));
	await expect.element(answer).toHaveFocus();

	const prompt = page.getByRole('article', { name: 'user message' });
	(prompt.element() as HTMLElement).focus();
	await userEvent.keyboard('{Shift>}{F10}{/Shift}');
	await expect.element(page.getByRole('menuitem', { name: 'Copy as Markdown' })).not.toBeInTheDocument();
	await userEvent.click(page.getByRole('menuitem', { name: 'Branch from here' }));

	expect(onBranchFromMessage).toHaveBeenCalledWith('session-idle', 'prompt-1');
	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Fix the gutter again');
});

test('explains why a running session cannot branch from a message', async () => {
	await render(SessionView, {
		workspaces: sessionFixtures.running,
		activeSessionId: 'session-running',
		onBranchFromMessage: vi.fn()
	});

	(page.getByRole('article', { name: 'user message' }).element() as HTMLElement).focus();
	await userEvent.keyboard('{Shift>}{F10}{/Shift}');

	await expect
		.element(page.getByRole('menuitem', { name: 'Branch from here' }))
		.toHaveAccessibleDescription('Wait for Pi to finish before branching.');
});
