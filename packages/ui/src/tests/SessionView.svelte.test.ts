import { page, userEvent } from 'vitest/browser';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { commandFixtures } from '../fixtures/commands';
import { BUILTIN_COMMANDS } from '../lib/builtin-commands';
import { fileMentionFixtures } from '../fixtures/file-mentions';
import { sessionFixtures } from '../fixtures/sessions';
import { Keymap, keymapContext } from '../lib/keymap.svelte';
import SessionView from '../lib/SessionView.svelte';
import SessionViewDemo from '../stories/SessionViewDemo.svelte';
import type { SavedSessionList } from '../lib/types/session';

const stateCases = [
	['starting', sessionFixtures.starting, 'session-starting', 'Starting the agent process…'],
	['running', sessionFixtures.running, 'session-running', 'Running'],
	['waiting', sessionFixtures.waiting, 'session-waiting', 'Attention required.'],
	['failed', sessionFixtures.failed, 'session-failed', 'Session failed.'],
	['stopped', sessionFixtures.stopped, 'session-stopped', 'Session stopped.']
] as const;

test('shows the empty session state', async () => {
	await render(SessionView, { workspaces: sessionFixtures.empty });

	await expect.element(page.getByRole('heading', { name: 'No session selected' })).toBeVisible();
});

test.each(stateCases)('shows the %s state', async (_name, workspaces, activeSessionId, expectedText) => {
	await render(SessionView, { workspaces, activeSessionId });

	await expect.element(page.getByText(expectedText, { exact: false }).last()).toBeVisible();
});

test('offers Resume for a restored session and explains a failed resume', async () => {
	const onResumeSession = vi.fn(async () => {
		throw new Error('Pi could not open the session file.');
	});
	await render(SessionView, {
		workspaces: sessionFixtures.idle,
		restoredSession: { workspaceId: 'pau', id: 'native-3', title: 'Review the sandbox policy' },
		onResumeSession
	});

	await expect.element(page.getByRole('heading', { level: 1, name: 'Review the sandbox policy' })).toBeVisible();
	expect(onResumeSession).not.toHaveBeenCalled();
	await userEvent.click(page.getByRole('button', { name: 'Resume', exact: true }));

	expect(onResumeSession).toHaveBeenCalledWith('pau', 'native-3');
	await expect.element(page.getByRole('alert')).toHaveTextContent('Pi could not open the session file.');
});

/** The workspace column's title, which names the open workspace. */
function identity(): string | null | undefined {
	return document.querySelector('.session-workspace__title')?.textContent;
}

test('lists a restored session in Settled and names its workspace in the workspace column', async () => {
	const onOpenRestoredSession = vi.fn();
	const workspaces = [{ id: 'ankify', name: 'ankify', sessions: [] }, ...sessionFixtures.idle];
	const restoredSession = { workspaceId: 'ankify', id: 'native-3', title: 'Review the sandbox policy' };
	const view = await render(SessionView, { workspaces, restoredSession, onOpenRestoredSession });

	const row = page.getByRole('button', { name: /Review the sandbox policy/ });
	await expect.element(row).toHaveAttribute('aria-current', 'page');
	await expect.element(row).toHaveTextContent('Stopped');
	await expect.element(page.getByText('No sessions yet')).not.toBeInTheDocument();
	expect(identity()).toContain('ankify');

	await view.rerender({ workspaces, restoredSession, onOpenRestoredSession, activeSessionId: 'session-idle' });
	await expect.element(row).not.toHaveAttribute('aria-current');
	expect(identity()).not.toContain('ankify');
	await userEvent.click(row);
	expect(onOpenRestoredSession).toHaveBeenCalledOnce();
});

/** Saved sessions newest first, as a workspace lists them. */
function savedList(...titles: string[]): SavedSessionList {
	return { sessions: titles.map((title, index) => ({ id: `native-${index + 1}`, title })), warnings: [] };
}

/** The titles of the rail's recent saved-session rows, in order. */
function recentTitles(): (string | null)[] {
	return [...document.querySelectorAll('.session-bay__strip[data-bay-key^="saved:"] .pau-strip__name')].map(
		(name) => name.textContent
	);
}

test('lists the newest saved sessions under the live ones and resumes one', async () => {
	const onResumeSession = vi.fn();
	const live = { ...sessionFixtures.idle[0]!.sessions[0]!, savedSessionId: 'native-1' };
	await render(SessionView, {
		workspaces: [{ id: 'pau', name: 'Pau', sessions: [live] }],
		activeSessionId: live.id,
		onLoadSavedSessions: async () =>
			savedList('Fix diff gutter', 'Wire the picker', 'Draft notes', 'Tidy the rail styles', 'Older work'),
		onResumeSession
	});

	// The live session's saved conversation shows once, as the live row.
	await vi.waitFor(() => expect(recentTitles()).toEqual(['Wire the picker', 'Draft notes', 'Tidy the rail styles']));

	await userEvent.click(page.getByRole('button', { name: /Draft notes/ }));
	expect(onResumeSession).toHaveBeenCalledWith('pau', 'native-3');
});

test('leaves out saved sessions that are live or restored', async () => {
	const list = savedList('Review the sandbox policy', 'Running elsewhere', 'Wire the picker');
	list.sessions[1] = { ...list.sessions[1]!, live: true };
	await render(SessionView, {
		workspaces: [{ id: 'ankify', name: 'ankify', sessions: [] }],
		restoredSession: { workspaceId: 'ankify', id: 'native-1', title: 'Review the sandbox policy' },
		onLoadSavedSessions: async () => list,
		onResumeSession: vi.fn()
	});

	await vi.waitFor(() => expect(recentTitles()).toEqual(['Wire the picker']));
	const names = [...document.querySelectorAll('.session-bay__strip .pau-strip__name')].map((name) => name.textContent);
	expect(names).toEqual(['Review the sandbox policy', 'Wire the picker']);
});

test('shows nothing extra for a workspace without saved sessions', async () => {
	const onLoadSavedSessions = vi.fn(async () => savedList());
	await render(SessionView, {
		workspaces: [{ id: 'ankify', name: 'ankify', sessions: [] }],
		onLoadSavedSessions,
		onResumeSession: vi.fn()
	});

	await expect.element(page.getByText('No sessions yet')).toBeVisible();
	expect(onLoadSavedSessions).toHaveBeenCalledWith('ankify');
	expect(recentTitles()).toEqual([]);
});

test('explains a failed saved-session load and tries again', async () => {
	const onLoadSavedSessions = vi
		.fn<() => Promise<SavedSessionList>>()
		.mockRejectedValueOnce(new Error('Pau could not read the session folder.'))
		.mockResolvedValue(savedList('Wire the picker'));
	await render(SessionView, {
		workspaces: [{ id: 'ankify', name: 'ankify', sessions: [] }],
		onLoadSavedSessions,
		onResumeSession: vi.fn()
	});

	await expect.element(page.getByText('Saved sessions in ankify did not load.')).toBeVisible();
	await expect.element(page.getByText('No sessions yet')).not.toBeInTheDocument();

	// The retry keeps the shared button layout that centers its label, not the rail row's.
	const retryButton = page.getByRole('button', { name: 'Try again' }).element();
	const retry = getComputedStyle(retryButton);
	const reference = document.createElement('button');
	retryButton.parentElement!.append(reference);
	reference.className = 'pau-button pau-button--secondary';
	reference.textContent = 'Retry';
	const shared = getComputedStyle(reference);
	for (const property of ['display', 'padding-top', 'padding-left', 'height', 'border-top-width'] as const) {
		expect(retry.getPropertyValue(property), property).toBe(shared.getPropertyValue(property));
	}
	reference.remove();
	await userEvent.click(page.getByRole('button', { name: 'Try again' }));

	await vi.waitFor(() => expect(recentTitles()).toEqual(['Wire the picker']));
	await expect.element(page.getByText('Saved sessions in ankify did not load.')).not.toBeInTheDocument();
});

test('reports a failed resume from the rail', async () => {
	await render(SessionView, {
		workspaces: [{ id: 'ankify', name: 'ankify', sessions: [] }],
		onLoadSavedSessions: async () => savedList('Wire the picker'),
		onResumeSession: async () => {
			throw new Error('Pi could not open the session file.');
		}
	});

	await userEvent.click(page.getByRole('button', { name: /Wire the picker/ }));
	await expect.element(page.getByRole('alert')).toHaveTextContent('Pi could not open the session file.');
});

test('disables Resume for a restored session while disconnected', async () => {
	await render(SessionView, {
		workspaces: sessionFixtures.idle,
		disconnected: true,
		restoredSession: { workspaceId: 'pau', id: 'native-3', title: 'Review the sandbox policy' },
		onResumeSession: vi.fn()
	});

	await expect.element(page.getByRole('button', { name: 'Resume', exact: true })).toBeDisabled();
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
	const active = page.getByRole('button', { name: /Fix diff gutter/ });

	await userEvent.click(active);
	const strips = [...document.querySelectorAll<HTMLElement>('.session-bay__strip')];
	const next = strips[strips.indexOf(active.element() as HTMLElement) + 1]!;
	await userEvent.keyboard('{ArrowDown}');
	expect(document.activeElement).toBe(next);
	await userEvent.keyboard('{Enter}');

	const title = next.querySelector('.pau-strip__name')!.textContent!;
	await expect.element(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
	expect(next.getAttribute('aria-current')).toBe('page');
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

	await userEvent.click(page.getByRole('button', { name: /Session without denials/ }));
	await expect.element(page.getByLabelText('Sandbox denial').first()).not.toBeInTheDocument();
});

test.each([
	['stopped', sessionFixtures.stopped, 'session-stopped', 'Session stopped.'],
	['failed', sessionFixtures.failed, 'session-failed', 'Session failed.']
] as const)(
	'replaces the composer of a %s session with a notice that starts it again',
	async (_name, workspaces, activeSessionId, state) => {
		const onRestartSession = vi.fn();
		const workspacesWithCompaction = workspaces.map((workspace) => ({
			...workspace,
			sessions: workspace.sessions.map((session) => ({
				...session,
				capabilities: { ...session.capabilities, compaction: true, stop: true }
			}))
		}));
		await render(SessionView, {
			workspaces: workspacesWithCompaction,
			activeSessionId,
			onRestartSession,
			onCompact: vi.fn()
		});

		const notice = page.getByRole('region', { name: 'Session ended' });
		await expect.element(notice).toHaveTextContent(state);
		await expect.element(page.getByRole('form', { name: 'Prompt composer' })).not.toBeInTheDocument();
		await expect.element(page.getByRole('textbox', { name: 'Prompt' })).not.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: /Send prompt/ })).not.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Compact' })).not.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Stop', exact: true })).not.toBeInTheDocument();

		await userEvent.click(notice.getByRole('button', { name: 'Start again' }));
		expect(onRestartSession).toHaveBeenCalledWith(activeSessionId);
	}
);

test('keeps the draft when the session stops and returns it after Start again', async () => {
	const ready = sessionFixtures.stopped.map((workspace) => ({
		...workspace,
		sessions: workspace.sessions.map((session) => ({ ...session, status: 'idle' as const }))
	}));
	const view = await render(SessionView, { workspaces: ready, activeSessionId: 'session-stopped' });
	const prompt = page.getByRole('textbox', { name: 'Prompt' });
	await userEvent.type(prompt, 'Mention the new picker.');

	await view.rerender({ workspaces: sessionFixtures.stopped, onRestartSession: vi.fn() });
	await expect.element(page.getByRole('region', { name: 'Session ended' })).toHaveTextContent('Your unsent draft');

	await view.rerender({ workspaces: ready });
	await expect.element(prompt).toHaveValue('Mention the new picker.');
});

test('shows why Start again failed', async () => {
	const onRestartSession = vi.fn().mockRejectedValue(new Error('Pi no longer has that saved session.'));
	await render(SessionView, {
		workspaces: sessionFixtures.stopped,
		activeSessionId: 'session-stopped',
		onRestartSession
	});

	await userEvent.click(page.getByRole('button', { name: 'Start again' }));

	await expect.element(page.getByRole('alert')).toHaveTextContent('Pi no longer has that saved session.');
	await expect.element(page.getByRole('button', { name: 'Start again' })).toBeEnabled();
});

test('shows tool activity in a stopped session', async () => {
	await render(SessionView, { workspaces: sessionFixtures.stopped, activeSessionId: 'session-stopped' });

	await expect.element(page.getByText('src/diff/gutter.ts')).toBeVisible();
});

test('toggles every tool row with Ctrl+O and keeps a row the operator opened', async () => {
	await render(SessionView, { workspaces: sessionFixtures.stopped, activeSessionId: 'session-stopped' });
	const readOutput = page.getByLabelText('read output');

	await expect.element(readOutput).not.toBeInTheDocument();
	await userEvent.click(page.getByText('src/diff/gutter.ts'));
	await expect.element(readOutput).toHaveTextContent('212 lines');

	await userEvent.keyboard('{Control>}o{/Control}');
	await expect.element(page.getByLabelText('bash output')).toHaveTextContent('38 passed');
	await userEvent.keyboard('{Control>}o{/Control}');
	await expect.element(readOutput).not.toBeInTheDocument();
	await expect.element(page.getByLabelText('bash output')).not.toBeInTheDocument();
});

/** The main-pane and rail session-list loading indicators, or null where absent. */
function loadingIndicators() {
	return [
		page.getByRole('heading', { name: 'Loading sessions…' }).query(),
		document.querySelector('.session-bay__empty[role="status"]')
	];
}

async function advanceTimers(ms: number): Promise<void> {
	vi.advanceTimersByTime(ms);
	await tick();
}

describe('session list loading', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test('a fast load shows no loading indicator', async () => {
		const screen = await render(SessionView, { workspaces: [], loading: true });
		await advanceTimers(399);
		expect(loadingIndicators()).toEqual([null, null]);

		await screen.rerender({ workspaces: sessionFixtures.idle, loading: false });
		await advanceTimers(1000);
		expect(loadingIndicators()).toEqual([null, null]);
		expect(page.getByRole('heading', { name: 'No session selected' }).query()).not.toBeNull();
	});

	test('a slow load shows the indicator for at least 500ms', async () => {
		const screen = await render(SessionView, { workspaces: [], loading: true });
		await advanceTimers(400);
		expect(loadingIndicators()).not.toContain(null);

		await advanceTimers(100);
		await screen.rerender({ workspaces: sessionFixtures.idle, loading: false });
		await advanceTimers(399);
		expect(loadingIndicators()).not.toContain(null);

		await advanceTimers(1);
		expect(loadingIndicators()).toEqual([null, null]);
		expect(page.getByRole('heading', { name: 'No session selected' }).query()).not.toBeNull();
	});
});

test('explains a failed start and retries it', async () => {
	const onStartSession = vi
		.fn()
		.mockRejectedValueOnce(new Error('Pau could not find a working Pi installation.'))
		.mockResolvedValueOnce(undefined);
	await render(SessionView, { workspaces: sessionFixtures.workspaceWithoutSessions, onStartSession });

	await userEvent.click(page.getByRole('button', { name: 'New', exact: true }));
	await expect.element(page.getByRole('alert')).toHaveTextContent('Pau could not find a working Pi installation.');

	await userEvent.click(page.getByRole('button', { name: 'Try again' }));
	expect(onStartSession).toHaveBeenNthCalledWith(2, 'pau', 'pi');
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
	await expect.element(page.getByText(/Claude Code cannot take new direction during a run/)).toBeVisible();
	await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
});

test('stops the active session from its header', async () => {
	const onStop = vi.fn();
	await render(SessionView, { workspaces: sessionFixtures.idle, activeSessionId: 'session-idle', onStop });

	await userEvent.click(page.getByRole('button', { name: 'Stop', exact: true }));
	expect(onStop).toHaveBeenCalledWith('session-idle');
});

test('offers to send the prompt of the latest failed turn again', async () => {
	const onRetry = vi.fn();
	await render(SessionView, { workspaces: sessionFixtures.failedTurn, activeSessionId: 'session-idle', onRetry });

	await userEvent.click(page.getByRole('button', { name: 'Send message again' }));

	expect(onRetry).toHaveBeenCalledWith('session-idle');
	await expect.element(page.getByRole('button', { name: 'Sending…' })).toBeDisabled();
});

test('offers no send-again action while running, without the capability, or when disconnected', async () => {
	const failed = sessionFixtures.failedTurn[0]!.sessions[0]!;
	const running = [{ id: 'pau', name: 'Pau', sessions: [{ ...failed, status: 'running' as const }] }];
	const view = await render(SessionView, { workspaces: running, activeSessionId: 'session-idle' });
	await expect.element(page.getByRole('button', { name: 'Send message again' })).not.toBeInTheDocument();

	await view.rerender({ workspaces: sessionFixtures.failedTurnWithoutRetry, activeSessionId: 'session-idle' });
	await expect.element(page.getByRole('button', { name: 'Send message again' })).not.toBeInTheDocument();

	await view.rerender({ workspaces: sessionFixtures.failedTurn, activeSessionId: 'session-idle', disconnected: true });
	await expect.element(page.getByRole('button', { name: 'Send message again' })).not.toBeInTheDocument();
});

test('shows why sending again was rejected and allows another attempt', async () => {
	await render(SessionView, {
		workspaces: sessionFixtures.failedTurn,
		activeSessionId: 'session-idle',
		onRetry: () => Promise.reject(new Error('The last reply did not fail, so there is nothing to send again.'))
	});

	await userEvent.click(page.getByRole('button', { name: 'Send message again' }));

	await expect.element(page.getByRole('alert').filter({ hasText: 'nothing to send again' })).toBeVisible();
	await expect.element(page.getByRole('button', { name: 'Send message again' })).toBeEnabled();
});

test('counts down an automatic retry and cancels it', async () => {
	const onCancelRetry = vi.fn();
	await render(SessionView, {
		workspaces: sessionFixtures.autoRetryPending,
		activeSessionId: 'session-running',
		onCancelRetry
	});

	await expect.element(page.getByText(/Retrying in \d+s, attempt 2 of 3/)).toBeVisible();
	await userEvent.click(page.getByRole('button', { name: 'Cancel retry' }));

	expect(onCancelRetry).toHaveBeenCalledWith('session-running');
});

test('recalls earlier prompts and restores the draft', async () => {
	await render(SessionViewDemo, {
		workspaces: sessionFixtures.running,
		initialSessionId: 'session-running',
		history: ['second', 'first']
	});
	const prompt = page.getByRole('textbox', { name: 'Prompt' });
	await userEvent.click(prompt);
	await userEvent.keyboard('{ArrowUp}');
	await expect.element(prompt).toHaveValue('second');
	await userEvent.keyboard('{ArrowUp}{ArrowUp}');
	await expect.element(prompt).toHaveValue('first');
	await userEvent.keyboard('{ArrowDown}{ArrowDown}');
	await expect.element(prompt).toHaveValue('');
});

test('keeps a written draft when Up is pressed', async () => {
	await render(SessionViewDemo, {
		workspaces: sessionFixtures.running,
		initialSessionId: 'session-running',
		history: ['earlier']
	});
	const prompt = page.getByRole('textbox', { name: 'Prompt' });
	await userEvent.type(prompt, 'my draft');
	await userEvent.keyboard('{ArrowUp}');
	await expect.element(prompt).toHaveValue('my draft');
});

test('recalls a prompt sent in this view', async () => {
	await render(SessionViewDemo, { workspaces: sessionFixtures.running, initialSessionId: 'session-running' });
	const prompt = page.getByRole('textbox', { name: 'Prompt' });
	await userEvent.type(prompt, 'ship it');
	await userEvent.keyboard('{Control>}{Enter}{/Control}');
	await expect.element(prompt).toHaveValue('');
	await userEvent.keyboard('{ArrowUp}');
	await expect.element(prompt).toHaveValue('ship it');
});

const commandProps = {
	workspaces: sessionFixtures.running,
	initialSessionId: 'session-running',
	commands: commandFixtures.populated,
	history: ['earlier']
};

test('completes a command with the keyboard ahead of history', async () => {
	await render(SessionViewDemo, commandProps);
	const prompt = page.getByRole('textbox', { name: 'Prompt' });
	await userEvent.type(prompt, '/');
	await expect.element(page.getByRole('listbox', { name: 'Commands' })).toBeVisible();
	await expect
		.element(page.getByRole('listbox').getByRole('option'))
		.toHaveLength(commandFixtures.populated.length + BUILTIN_COMMANDS.length);

	await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
	await expect.element(page.getByRole('listbox').getByRole('option', { selected: true })).toHaveTextContent('/review');
	await userEvent.keyboard('{Tab}');
	await expect.element(prompt).toHaveValue('/review ');
	await expect.element(page.getByRole('listbox').getByRole('option')).not.toBeInTheDocument();
});

test('closes the list with Escape without interrupting the run', async () => {
	await render(SessionViewDemo, commandProps);
	const prompt = page.getByRole('textbox', { name: 'Prompt' });
	await userEvent.type(prompt, '/re');
	await userEvent.keyboard('{Escape}');

	await expect.element(page.getByRole('listbox').getByRole('option')).not.toBeInTheDocument();
	await expect.element(prompt).toHaveValue('/re');
	await expect.element(page.getByText('No action sent')).toBeVisible();
});

test('keeps history navigation when no list is open', async () => {
	await render(SessionViewDemo, commandProps);
	const prompt = page.getByRole('textbox', { name: 'Prompt' });
	await userEvent.click(prompt);
	await userEvent.keyboard('{ArrowUp}');
	await expect.element(prompt).toHaveValue('earlier');
	await expect.element(page.getByRole('listbox').getByRole('option')).not.toBeInTheDocument();
});

test('shows a hint for an unknown command and still sends it', async () => {
	await render(SessionViewDemo, commandProps);
	const prompt = page.getByRole('textbox', { name: 'Prompt' });
	await userEvent.type(prompt, '/nope now');
	await expect.element(page.getByText('Not a known command. It will be sent as written.')).toBeVisible();

	await userEvent.keyboard('{Control>}{Enter}{/Control}');
	await expect.element(page.getByText(/session-running: steer: \/nope now/)).toBeVisible();
});

test('offers no completion when the session cannot discover commands', async () => {
	await render(SessionViewDemo, {
		...commandProps,
		workspaces: sessionFixtures.runningWithoutQueue,
		initialSessionId: 'session-no-queue'
	});
	await userEvent.type(page.getByRole('textbox', { name: 'Prompt' }), '/nope');

	await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
	await expect.element(page.getByText(/Not a known command/)).not.toBeInTheDocument();
});

test('lists queued messages by kind and hides an empty or unsupported queue', async () => {
	const view = await render(SessionView, {
		workspaces: sessionFixtures.queued,
		activeSessionId: 'session-running',
		onClearQueue: vi.fn()
	});
	await expect.element(page.getByText('Keep the public API unchanged.')).toBeVisible();
	await expect.element(page.getByText('Follow up').first()).toBeVisible();

	const queued = sessionFixtures.queued[0]!.sessions[0]!;
	const withQueue = (overrides: Partial<typeof queued>) => [
		{ id: 'pau', name: 'Pau', sessions: [{ ...queued, ...overrides }] }
	];
	await view.rerender({
		workspaces: withQueue({ messageQueue: { steering: [], followUp: [] } }),
		activeSessionId: 'session-running',
		onClearQueue: vi.fn()
	});
	await expect.element(page.getByRole('region', { name: 'Queued messages' })).not.toBeInTheDocument();

	await view.rerender({
		workspaces: withQueue({ capabilities: { ...queued.capabilities, messageQueue: false } }),
		activeSessionId: 'session-running',
		onClearQueue: vi.fn()
	});
	await expect.element(page.getByRole('region', { name: 'Queued messages' })).not.toBeInTheDocument();
});

test('restores cleared messages before an existing draft', async () => {
	const onClearQueue = vi.fn().mockResolvedValue({ steering: ['Keep the API.'], followUp: ['Add a test.'] });
	await render(SessionView, { workspaces: sessionFixtures.queued, activeSessionId: 'session-running', onClearQueue });

	await userEvent.type(page.getByRole('textbox', { name: 'Prompt' }), 'Draft.');
	await userEvent.click(page.getByRole('button', { name: 'Clear queue' }));

	expect(onClearQueue).toHaveBeenCalledWith('session-running');
	await expect
		.element(page.getByRole('textbox', { name: 'Prompt' }))
		.toHaveValue('Keep the API.\n\nAdd a test.\n\nDraft.');
});

test('puts queued messages back in the composer after an interrupt', async () => {
	const onInterrupt = vi.fn().mockResolvedValue({ steering: ['Keep the API.'], followUp: ['Add a test.'] });
	await render(SessionView, { workspaces: sessionFixtures.queued, activeSessionId: 'session-running', onInterrupt });

	await userEvent.click(page.getByRole('button', { name: /Interrupt/ }));

	expect(onInterrupt).toHaveBeenCalledWith('session-running');
	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Keep the API.\n\nAdd a test.');
});

test('leaves the composer empty when an interrupt clears no queue', async () => {
	const onInterrupt = vi.fn().mockResolvedValue({ steering: [], followUp: [] });
	await render(SessionView, { workspaces: sessionFixtures.queued, activeSessionId: 'session-running', onInterrupt });

	await userEvent.click(page.getByRole('button', { name: /Interrupt/ }));

	expect(onInterrupt).toHaveBeenCalledWith('session-running');
	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toHaveValue('');
});

test('keeps the draft after the queued messages an interrupt restores', async () => {
	const onInterrupt = vi.fn().mockResolvedValue({ steering: [], followUp: ['Add a test.'] });
	await render(SessionView, { workspaces: sessionFixtures.queued, activeSessionId: 'session-running', onInterrupt });
	const prompt = page.getByRole('textbox', { name: 'Prompt' });

	await userEvent.type(prompt, 'Draft.');
	await userEvent.click(page.getByRole('button', { name: /Interrupt/ }));

	await expect.element(prompt).toHaveValue('Add a test.\n\nDraft.');
});

test('keeps the queue and shows the reason when clearing fails', async () => {
	const onClearQueue = vi.fn().mockRejectedValue(new Error('This session does not support that action.'));
	await render(SessionView, { workspaces: sessionFixtures.queued, activeSessionId: 'session-running', onClearQueue });

	await userEvent.click(page.getByRole('button', { name: 'Clear queue' }));

	await expect.element(page.getByRole('alert')).toHaveTextContent('does not support that action');
	await expect.element(page.getByText('Keep the public API unchanged.')).toBeVisible();
});

const pngFile = (name = 'shot.png') => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });

async function renderRunning(onSend = vi.fn()) {
	await render(SessionView, { workspaces: sessionFixtures.running, activeSessionId: 'session-running', onSend });
	return onSend;
}

test('attaches, removes, and sends images with the prompt', async () => {
	const onSend = await renderRunning();
	const picker = page.getByLabelText('Image files');

	await picker.upload([pngFile('first.png'), pngFile('second.png')]);
	await expect.element(page.getByRole('img', { name: 'second.png' })).toBeVisible();
	await page.getByRole('button', { name: 'Remove second.png' }).click();
	await expect.element(page.getByRole('img', { name: 'second.png' })).not.toBeInTheDocument();

	await userEvent.type(page.getByRole('textbox', { name: 'Prompt' }), 'Look at this.');
	await userEvent.keyboard('{Control>}{Enter}{/Control}');

	await vi.waitFor(() =>
		expect(onSend).toHaveBeenCalledWith('session-running', 'Look at this.', 'steer', [
			{ mimeType: 'image/png', data: 'AQID' }
		])
	);
	await expect.element(page.getByRole('img', { name: 'first.png' })).not.toBeInTheDocument();
});

test('rejects unsupported and oversized files by name', async () => {
	await renderRunning();
	const picker = page.getByLabelText('Image files');

	await picker.upload([new File(['x'], 'notes.pdf', { type: 'application/pdf' })]);
	await expect.element(page.getByRole('alert')).toHaveTextContent('notes.pdf is not a supported image');

	await picker.upload([new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' })]);
	await expect.element(page.getByRole('alert')).toHaveTextContent('huge.png is larger than 5 MiB');
	await expect.element(page.getByRole('list', { name: 'Attached images' })).not.toBeInTheDocument();
});

test('keeps images after a failed send', async () => {
	await renderRunning(vi.fn().mockRejectedValue(new Error('The current model cannot read images.')));

	await page.getByLabelText('Image files').upload([pngFile()]);
	await userEvent.type(page.getByRole('textbox', { name: 'Prompt' }), 'Describe this.');
	await userEvent.keyboard('{Control>}{Enter}{/Control}');

	await expect.element(page.getByRole('alert')).toHaveTextContent('The current model cannot read images.');
	await expect.element(page.getByRole('img', { name: 'shot.png' })).toBeVisible();
});

/** Fires one drag event carrying `files` at `target`. */
function drag(target: Element, type: string, files: File[]): void {
	const dataTransfer = new DataTransfer();
	for (const file of files) dataTransfer.items.add(file);
	target.dispatchEvent(new DragEvent(type, { dataTransfer, bubbles: true, cancelable: true }));
}

const pdfFile = () => new File(['x'], 'notes.pdf', { type: 'application/pdf' });

test('shows the drop target while images are dragged over the composer, including its children', async () => {
	await renderRunning();
	const form = page.getByRole('form', { name: 'Prompt composer' });
	const composer = form.element();
	const field = page.getByRole('textbox', { name: 'Prompt' }).element();

	drag(composer, 'dragenter', [pngFile()]);
	await expect.element(form.getByRole('status')).toHaveTextContent('Drop to attach');
	await expect.element(form).toHaveAttribute('data-drop', 'accept');

	// Entering a child fires before leaving the composer, which must not clear the target.
	drag(field, 'dragenter', [pngFile()]);
	drag(composer, 'dragleave', [pngFile()]);
	await expect.element(form.getByRole('status')).toHaveTextContent('Drop to attach');

	drag(field, 'dragleave', [pngFile()]);
	await expect.element(form.getByRole('status')).not.toBeInTheDocument();
	await expect.element(form).not.toHaveAttribute('data-drop');
});

test('attaches a dropped image and clears the drop target', async () => {
	await renderRunning();
	const form = page.getByRole('form', { name: 'Prompt composer' });

	drag(form.element(), 'dragenter', [pngFile('dropped.png')]);
	drag(form.element(), 'drop', [pngFile('dropped.png')]);

	await expect.element(page.getByRole('img', { name: 'dropped.png' })).toBeVisible();
	await expect.element(form.getByRole('status')).not.toBeInTheDocument();
});

test('explains before and after the drop that an unsupported file cannot attach', async () => {
	await renderRunning();
	const form = page.getByRole('form', { name: 'Prompt composer' });

	drag(form.element(), 'dragenter', [pdfFile()]);
	await expect.element(form).toHaveAttribute('data-drop', 'reject');
	await expect
		.element(form.getByRole('status'))
		.toHaveTextContent('These files cannot be attached Only PNG, JPEG, GIF, and WebP images can be attached.');

	drag(form.element(), 'drop', [pdfFile()]);
	await expect.element(form.getByRole('status')).toHaveTextContent('Nothing was attached');
	await expect.element(page.getByRole('list', { name: 'Attached images' })).not.toBeInTheDocument();
	await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
	await expect.element(form.getByRole('status'), { timeout: 4000 }).not.toBeInTheDocument();
});

test('attaches images pasted into the composer', async () => {
	await renderRunning();

	const pasted = new DataTransfer();
	pasted.items.add(pngFile('pasted.png'));
	page
		.getByRole('textbox', { name: 'Prompt' })
		.element()
		.dispatchEvent(new ClipboardEvent('paste', { clipboardData: pasted, bubbles: true, cancelable: true }));
	await expect.element(page.getByRole('img', { name: 'pasted.png' })).toBeVisible();
});

test('asks for a folder on first run and opens it from a typed path', async () => {
	await render(SessionViewDemo, { workspaces: sessionFixtures.empty, openable: true });

	await expect.element(page.getByRole('heading', { name: 'Open a folder to start working' })).toBeVisible();
	await expect.element(page.getByText('No workspaces yet')).toBeInTheDocument();
	await expect.element(page.getByRole('button', { name: 'Open', exact: true })).toBeDisabled();
	await userEvent.fill(page.getByRole('textbox', { name: 'Folder path' }), '/Users/operator/projects/pau');
	await userEvent.click(page.getByRole('button', { name: 'Open', exact: true }));

	await expect.element(page.getByRole('heading', { name: 'pau is open' })).toBeVisible();
	await expect.element(page.getByRole('button', { name: 'New', exact: true })).toBeEnabled();
	await userEvent.click(page.getByRole('button', { name: 'Start session', exact: true }));
	await expect.element(page.getByText('workspace-pau: start session')).toBeVisible();
});

test('opens a workspace with the native folder picker', async () => {
	await render(SessionViewDemo, {
		workspaces: sessionFixtures.empty,
		openable: true,
		pickedFolder: '/Users/operator/projects/app'
	});

	await expect.element(page.getByRole('textbox', { name: 'Folder path' })).not.toBeInTheDocument();
	await userEvent.click(page.getByRole('main').getByRole('button', { name: 'Open workspace…' }));

	await expect.element(page.getByRole('heading', { name: 'app is open' })).toBeVisible();
});

test('ignores a cancelled folder picker', async () => {
	await render(SessionViewDemo, { workspaces: sessionFixtures.empty, openable: true, pickedFolder: null });

	await userEvent.click(page.getByRole('main').getByRole('button', { name: 'Open workspace…' }));

	await expect.element(page.getByRole('heading', { name: 'Open a folder to start working' })).toBeVisible();
	await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
});

test('explains a folder that cannot open and keeps the path for correction', async () => {
	await render(SessionViewDemo, {
		workspaces: sessionFixtures.empty,
		openable: true,
		openFailure: 'No folder exists at that path. Check the path and try again.'
	});

	const path = page.getByRole('textbox', { name: 'Folder path' });
	await userEvent.fill(path, '/missing');
	await userEvent.click(page.getByRole('button', { name: 'Open', exact: true }));

	await expect.element(page.getByRole('alert')).toHaveTextContent('No folder exists at that path.');
	await expect.element(path).toHaveValue('/missing');
});

test('selects an already open workspace instead of adding it again', async () => {
	await render(SessionViewDemo, { workspaces: sessionFixtures.running, openable: true });

	await userEvent.click(page.getByRole('button', { name: 'More ways to start a session' }));
	await userEvent.click(page.getByRole('menuitem', { name: 'Open workspace…' }));
	await userEvent.fill(page.getByRole('textbox', { name: 'Folder path' }), '/Users/operator/Pau');
	await userEvent.click(page.getByRole('button', { name: 'Open', exact: true }));

	await expect.element(page.getByRole('heading', { name: 'Fix diff gutter', level: 1 })).toBeVisible();
	expect(document.querySelectorAll('.session-bay__strip')).toHaveLength(1);
	expect(document.querySelector('.session-workspace__title')?.textContent?.trim()).toBe('Pau');
});

test('marks the supplied Sessions destination when a session needs attention', async () => {
	await render(SessionView, {
		workspaces: sessionFixtures.waiting,
		activeSessionId: 'session-waiting',
		productItems: [
			{ id: 'sessions', label: 'Sessions', icon: 'agents', href: '/', active: true },
			{ id: 'settings', label: 'Settings', icon: 'settings' }
		]
	});

	const sessions = page.getByRole('link', { name: 'Sessions' });
	await expect.element(sessions).toHaveAttribute('href', '/');
	await expect.element(sessions.getByLabelText('Needs attention')).toBeInTheDocument();
	await expect
		.element(page.getByRole('button', { name: 'Settings' }))
		.toHaveAccessibleDescription('Settings Coming soon');
});

test('runs session shortcuts from the app key map', async () => {
	const keymap = new Keymap({ platform: 'mac' });
	const onSelectSession = vi.fn();
	const onStartSession = vi.fn().mockResolvedValue(undefined);
	await render(SessionView, {
		props: { workspaces: sessionFixtures.concurrent, activeSessionId: 'diff-gutter', onSelectSession, onStartSession },
		context: new Map([[keymapContext, keymap]])
	});
	const press = (init: KeyboardEventInit) => keymap.handleKeydown(new KeyboardEvent('keydown', init));

	press({ key: 'Tab', ctrlKey: true });
	expect(onSelectSession).toHaveBeenLastCalledWith('registry-review');
	press({ key: 'Tab', ctrlKey: true, shiftKey: true });
	expect(onSelectSession).toHaveBeenLastCalledWith('session-docs');
	press({ key: '3', code: 'Digit3', metaKey: true });
	expect(onSelectSession).toHaveBeenLastCalledWith('claude-review');
	press({ key: 'n', code: 'KeyN', metaKey: true });
	expect(onStartSession).toHaveBeenCalledWith('pau', 'pi');
	press({ key: 'l', code: 'KeyL', metaKey: true });
	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toHaveFocus();
});

const mentionProps = {
	workspaces: sessionFixtures.running,
	initialSessionId: 'session-running',
	files: fileMentionFixtures.populated,
	commands: commandFixtures.populated,
	history: ['earlier']
};

test('completes a mid-draft @ mention with Tab and keeps the text after it', async () => {
	await render(SessionViewDemo, mentionProps);
	const prompt = page.getByRole('textbox', { name: 'Prompt' });
	await userEvent.type(prompt, 'check  please');
	await userEvent.keyboard('{ArrowLeft>7/}');
	await userEvent.keyboard('@app');
	await expect.element(page.getByRole('listbox', { name: 'Files' }).getByRole('option')).toHaveLength(1);
	await userEvent.keyboard('{Tab}');
	await expect.element(prompt).toHaveValue('check @src/App.svelte  please');
});

test('filters as the path grows and moves the highlight ahead of history', async () => {
	await render(SessionViewDemo, mentionProps);
	const prompt = page.getByRole('textbox', { name: 'Prompt' });
	await userEvent.type(prompt, '@src');
	await expect.element(page.getByRole('listbox', { name: 'Files' }).getByRole('option')).toHaveLength(3);
	await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
	await expect
		.element(page.getByRole('listbox').getByRole('option', { selected: true }))
		.toHaveTextContent('App.svelte');
	await expect.element(prompt).toHaveValue('@src');
	await userEvent.keyboard('{Enter}');
	await expect.element(prompt).toHaveValue('@src/App.svelte ');
});

test('quotes a path with spaces and keeps a folder open for the next segment', async () => {
	await render(SessionViewDemo, mentionProps);
	const prompt = page.getByRole('textbox', { name: 'Prompt' });
	await userEvent.type(prompt, '@release');
	await expect.element(page.getByRole('option', { name: /release notes/ })).toBeVisible();
	await userEvent.keyboard('{Enter}');
	await expect.element(prompt).toHaveValue('@"docs/release notes.md" ');

	await userEvent.clear(prompt);
	await userEvent.type(prompt, '@src');
	await expect.element(page.getByRole('listbox', { name: 'Files' }).getByRole('option').first()).toBeVisible();
	await userEvent.keyboard('{Enter}');
	await expect.element(prompt).toHaveValue('@src/');
});

test('shows when nothing matches, and Escape closes the list without interrupting the run', async () => {
	await render(SessionViewDemo, mentionProps);
	const prompt = page.getByRole('textbox', { name: 'Prompt' });
	await userEvent.type(prompt, '@zzz');
	await expect.element(page.getByText('No matching files')).toBeVisible();

	await userEvent.clear(prompt);
	await userEvent.type(prompt, '@');
	await expect.element(page.getByRole('listbox', { name: 'Files' })).toBeVisible();
	await userEvent.keyboard('{Escape}');
	await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
	await expect.element(page.getByText('No action sent')).toBeVisible();
});

test('closes file and command completion on a press outside the composer', async () => {
	await render(SessionViewDemo, mentionProps);
	const prompt = page.getByRole('textbox', { name: 'Prompt' });
	await userEvent.type(prompt, '@src');
	await expect.element(page.getByRole('listbox', { name: 'Files' })).toBeVisible();
	await userEvent.click(page.getByRole('heading', { level: 1 }).first());
	await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();

	await userEvent.clear(prompt);
	await userEvent.type(prompt, '/');
	await expect.element(page.getByRole('listbox', { name: 'Commands' })).toBeVisible();
	await userEvent.click(page.getByRole('heading', { level: 1 }).first());
	await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
});

test('reports a failed file search', async () => {
	await render(SessionViewDemo, { ...mentionProps, searchFailure: true });
	await userEvent.type(page.getByRole('textbox', { name: 'Prompt' }), '@src');
	await expect.element(page.getByText('Files could not be searched')).toBeVisible();
});

test('keeps slash completion and history working beside file mentions', async () => {
	await render(SessionViewDemo, mentionProps);
	const prompt = page.getByRole('textbox', { name: 'Prompt' });
	await userEvent.type(prompt, '/');
	await expect.element(page.getByRole('listbox', { name: 'Commands' })).toBeVisible();
	await userEvent.keyboard('{Tab}');
	await expect.element(prompt).toHaveValue('/condense ');
	await userEvent.type(prompt, '@read');
	await expect.element(page.getByRole('option', { name: /README/ })).toBeVisible();
	await userEvent.keyboard('{Tab}');
	await expect.element(prompt).toHaveValue('/condense @README.md ');

	await userEvent.clear(prompt);
	await userEvent.keyboard('{ArrowUp}');
	await expect.element(prompt).toHaveValue('earlier');
	await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
});
