import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { sessionFixtures } from '../fixtures/sessions';
import SessionView from '../lib/SessionView.svelte';
import type { SessionStatus, SessionWorkspace, TranscriptEntry, TranscriptTool } from '../lib/types/session';

/** The idle fixture session with its transcript, status, and shell support replaced. */
function workspaces(
	transcript: TranscriptEntry[] = [],
	{ status = 'idle', shellCommands = true }: { status?: SessionStatus; shellCommands?: boolean } = {}
): SessionWorkspace[] {
	const [workspace] = sessionFixtures.idle;
	const [session] = workspace!.sessions;
	return [
		{
			...workspace!,
			sessions: [{ ...session!, status, transcript, capabilities: { ...session!.capabilities, shellCommands } }]
		}
	];
}

function shellEntry(overrides: Partial<TranscriptTool> = {}): TranscriptTool {
	return {
		id: 'shell-1',
		kind: 'tool',
		name: 'shell',
		detail: 'pnpm test',
		status: 'running',
		call: { tool: 'bash', command: 'pnpm test' },
		shell: { excludedFromContext: false },
		...overrides
	};
}

async function setup(transcript: TranscriptEntry[] = [], options?: Parameters<typeof workspaces>[1]) {
	const handlers = {
		onSend: vi.fn(),
		onInterrupt: vi.fn(),
		onRunShellCommand: vi.fn().mockResolvedValue(undefined),
		onStopShellCommands: vi.fn().mockResolvedValue(undefined)
	};
	const view = await render(SessionView, {
		workspaces: workspaces(transcript, options),
		activeSessionId: 'session-idle',
		...handlers
	});
	const prompt = page.getByRole('textbox', { name: 'Prompt' });
	await userEvent.click(prompt);
	return { ...handlers, view, prompt };
}

test('runs a ! command in the shell instead of sending it', async () => {
	const { onSend, onRunShellCommand, prompt } = await setup();

	await userEvent.type(prompt, '!  ls src ');
	await expect.element(page.getByRole('button', { name: /Run command/ })).toBeVisible();
	await userEvent.keyboard('{Enter}');

	expect(onRunShellCommand).toHaveBeenCalledWith('session-idle', 'ls src', false);
	expect(onSend).not.toHaveBeenCalled();
	await expect.element(prompt).toHaveValue('');
});

test('keeps a !! command out of the model context', async () => {
	const { onRunShellCommand, prompt } = await setup();

	await userEvent.type(prompt, '!!cat .env.local{Enter}');

	expect(onRunShellCommand).toHaveBeenCalledWith('session-idle', 'cat .env.local', true);
});

test('sends a bare ! as a prompt, as Pi does', async () => {
	const { onSend, onRunShellCommand, prompt } = await setup();

	await userEvent.type(prompt, '!!{Enter}');

	expect(onRunShellCommand).not.toHaveBeenCalled();
	expect(onSend).toHaveBeenCalledWith('session-idle', '!!', undefined);
});

test('keeps the draft and explains when the session cannot run shell commands', async () => {
	const { onSend, onRunShellCommand, prompt } = await setup([], { shellCommands: false });

	await userEvent.type(prompt, '!ls{Enter}');

	expect(onRunShellCommand).not.toHaveBeenCalled();
	expect(onSend).not.toHaveBeenCalled();
	await expect.element(prompt).toHaveValue('!ls');
	await expect.element(page.getByRole('alert')).toHaveTextContent('Pi cannot run shell commands in this session.');
});

test('runs one command at a time', async () => {
	const { onRunShellCommand, prompt } = await setup([shellEntry()]);

	await userEvent.type(prompt, '!ls{Enter}');

	expect(onRunShellCommand).not.toHaveBeenCalled();
	await expect.element(prompt).toHaveValue('!ls');
	await expect.element(page.getByRole('alert')).toHaveTextContent('A shell command is still running. Stop it with Esc');
});

test('shows a rejected command under the composer and keeps it in history', async () => {
	const { onRunShellCommand, prompt } = await setup();
	onRunShellCommand.mockRejectedValue(new Error('Pi rejected the request: busy'));

	await userEvent.type(prompt, '!ls{Enter}');

	await expect.element(page.getByRole('alert')).toHaveTextContent('Pi rejected the request: busy');
	await userEvent.keyboard('{ArrowUp}');
	await expect.element(prompt).toHaveValue('!ls');
});

test('streams command output into the transcript row', async () => {
	const { view } = await setup([shellEntry()]);
	const row = page.getByRole('group').filter({ hasText: 'pnpm test' });

	await expect.element(row).toHaveTextContent('In progress');
	await expect.element(row).toHaveTextContent('Waiting for output…');

	await view.rerender({ workspaces: workspaces([shellEntry({ result: 'RUN v3\n' })]) });
	await expect.element(row.getByLabelText('Command output')).toHaveTextContent('RUN v3');

	await view.rerender({ workspaces: workspaces([shellEntry({ result: 'RUN v3\n38 passed\n' })]) });
	await expect.element(row.getByLabelText('Command output')).toHaveTextContent('38 passed');
});

test('marks a command kept out of context', async () => {
	await setup([
		shellEntry({
			status: 'complete',
			result: 'API_TOKEN=redacted\n',
			call: { tool: 'bash', command: 'pnpm test', exitCode: 0 },
			shell: { excludedFromContext: true }
		})
	]);
	const row = page.getByRole('group').filter({ hasText: 'pnpm test' });

	await expect.element(row).toHaveTextContent('Not in context · API_TOKEN=redacted');
	await expect.element(row).toHaveTextContent('The model does not see this command or its output.');
});

test('shows a failed command and a command that could not run', async () => {
	await setup([
		shellEntry({
			status: 'failed',
			result: '1 failed, 37 passed\n',
			call: { tool: 'bash', command: 'pnpm test', exitCode: 1 }
		}),
		shellEntry({
			id: 'shell-2',
			detail: 'ls',
			status: 'failed',
			result: 'Pi rejected the request: busy',
			call: { tool: 'bash', command: 'ls' }
		})
	]);
	const failed = page.getByRole('group').filter({ hasText: 'pnpm test' });
	const refused = page.getByRole('group').filter({ hasText: 'busy' });

	await expect.element(failed).toHaveTextContent('Failed');
	await expect.element(failed).toHaveTextContent('Exit 1');
	await expect.element(refused).toHaveTextContent('Failed');
	await expect.element(refused.getByLabelText('Error')).toHaveTextContent('Pi rejected the request: busy');
});

test('stops a running command with Escape when no turn runs', async () => {
	const { onStopShellCommands, onInterrupt, view } = await setup([shellEntry()]);

	await userEvent.keyboard('{Escape}');

	expect(onStopShellCommands).toHaveBeenCalledWith('session-idle');
	expect(onInterrupt).not.toHaveBeenCalled();

	await view.rerender({
		workspaces: workspaces([
			shellEntry({ status: 'complete', result: 'RUN v3\n', shell: { excludedFromContext: false, cancelled: true } })
		])
	});
	const row = page.getByRole('group').filter({ hasText: 'pnpm test' });
	await expect.element(row).toHaveTextContent('Stopped');
	await expect.element(row).toHaveTextContent('Stopped before it finished.');
	await expect.element(page.getByRole('button', { name: /Stop command/ })).not.toBeInTheDocument();
});

test('interrupts a running turn with Escape before it stops a command', async () => {
	const { onStopShellCommands, onInterrupt } = await setup([shellEntry()], { status: 'running' });

	await userEvent.keyboard('{Escape}');

	expect(onInterrupt).toHaveBeenCalledWith('session-idle');
	expect(onStopShellCommands).not.toHaveBeenCalled();

	await userEvent.click(page.getByRole('button', { name: 'Stop command' }));
	expect(onStopShellCommands).toHaveBeenCalledWith('session-idle');
});
