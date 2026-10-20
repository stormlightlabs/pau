import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { commandFixtures } from '../fixtures/commands';
import { agentReadinessFixtures } from '../fixtures/launch';
import { fileMentionFixtures } from '../fixtures/file-mentions';
import { modelFixtures } from '../fixtures/models';
import { resourceMonitoringFixtures } from '../fixtures/resource-monitoring';
import { savedSessionFixtures } from '../fixtures/saved-sessions';
import { sessionFixtures } from '../fixtures/sessions';
import { toolCallFixtures } from '../fixtures/tool-calls';
import { BUILTIN_COMMANDS, TERMINAL_ONLY_REASON } from '../lib/builtin-commands';
import SessionViewDemo from './SessionViewDemo.svelte';

const meta = {
	title: 'Sessions/Session view',
	component: SessionViewDemo,
	parameters: { layout: 'fullscreen' },
	args: { workspaces: sessionFixtures.running, initialSessionId: 'session-running' }
} satisfies Meta<typeof SessionViewDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { args: { workspaces: sessionFixtures.empty, initialSessionId: undefined } };
export const PiNotReady: Story = {
	args: {
		workspaces: sessionFixtures.idle,
		initialSessionId: undefined,
		agentReadiness: agentReadinessFixtures.missing
	},
	play: async ({ canvasElement }) => {
		const notice = within(canvasElement).getByRole('region', { name: 'Pi is not ready' });
		await expect(within(notice).getByRole('button', { name: 'Open terminal' })).toBeVisible();
	}
};
export const FirstRunPiNotReady: Story = {
	args: {
		workspaces: sessionFixtures.empty,
		initialSessionId: undefined,
		openable: true,
		agentReadiness: agentReadinessFixtures.noProvider
	}
};
export const FirstRun: Story = {
	args: { workspaces: sessionFixtures.empty, initialSessionId: undefined, openable: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('heading', { name: 'Open a folder to start working' })).toBeInTheDocument();
		await expect(canvas.getByText('No workspaces yet')).toBeInTheDocument();
		await expect(canvas.getByRole('button', { name: 'Open workspace…' })).toBeEnabled();
	}
};
export const OpenWorkspace: Story = {
	args: { workspaces: sessionFixtures.empty, initialSessionId: undefined, openable: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole('textbox', { name: 'Folder path' }), '/Users/operator/projects/pau');
		await userEvent.click(canvas.getByRole('button', { name: 'Open' }));
		await expect(await canvas.findByRole('heading', { name: 'pau is open' })).toBeInTheDocument();
		await expect(canvas.getByRole('button', { name: 'New session in pau' })).toBeEnabled();
	}
};
export const OpenWorkspaceWithPicker: Story = {
	args: {
		workspaces: sessionFixtures.empty,
		initialSessionId: undefined,
		openable: true,
		pickedFolder: '/Users/operator/projects/app'
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(within(canvas.getByRole('main')).getByRole('button', { name: 'Open workspace…' }));
		await expect(await canvas.findByRole('heading', { name: 'app is open' })).toBeInTheDocument();
	}
};
export const OpenWorkspaceFailed: Story = {
	args: {
		workspaces: sessionFixtures.empty,
		initialSessionId: undefined,
		openable: true,
		openFailure: 'That path is a file. Choose a folder instead.'
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole('textbox', { name: 'Folder path' }), '/Users/operator/notes.txt');
		await userEvent.click(canvas.getByRole('button', { name: 'Open' }));
		await expect(await canvas.findByRole('alert')).toHaveTextContent('That path is a file. Choose a folder instead.');
	}
};
export const Loading: Story = {
	args: { workspaces: sessionFixtures.empty, initialSessionId: undefined, loading: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('heading', { name: 'Loading sessions…' })).toBeInTheDocument();
	}
};
export const WorkspaceWithoutSessions: Story = {
	args: {
		workspaces: [{ id: 'ankify', name: 'ankify', path: '/Users/operator/projects/ankify', sessions: [] }],
		initialSessionId: undefined,
		openable: true,
		pickedFolder: null,
		savedSessions: savedSessionFixtures.empty
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText('No sessions yet')).toBeInTheDocument();
		await expect(canvas.getByRole('button', { name: 'New session in ankify' })).toBeEnabled();
		await expect(canvas.getByRole('button', { name: 'Saved sessions in ankify' })).toBeEnabled();
	}
};
export const SavedSessionPicker: Story = {
	args: {
		workspaces: [{ id: 'ankify', name: 'ankify', path: '/Users/operator/projects/ankify', sessions: [] }],
		initialSessionId: undefined,
		savedSessions: savedSessionFixtures.empty
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Saved sessions in ankify' }));
		await expect(await canvas.findByRole('heading', { name: 'Sessions in ankify' })).toBeInTheDocument();
		await expect(await canvas.findByText(/^Start a new session to begin\./)).toBeInTheDocument();
		await expect(canvas.getByRole('button', { name: 'Saved sessions in ankify' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	}
};
export const FailedStart: Story = {
	args: {
		workspaces: sessionFixtures.workspaceWithoutSessions,
		initialSessionId: undefined,
		startFailure: 'Pau could not find a working Pi installation. Install Pi or add it to your PATH, then try again.'
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'New session in Pau' }));
		await expect(canvas.getByRole('heading', { name: 'Could not start a session in Pau' })).toBeInTheDocument();
		await expect(canvas.getByRole('button', { name: 'Try again' })).toBeEnabled();
	}
};
export const Disconnected: Story = {
	args: { workspaces: sessionFixtures.idle, initialSessionId: 'session-idle', disconnected: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText(/Pau lost its connection to the backend/)).toBeInTheDocument();
		await expect(canvas.getByRole('textbox', { name: 'Prompt' })).toBeDisabled();
	}
};
export const RunWithoutQueue: Story = {
	args: { workspaces: sessionFixtures.runningWithoutQueue, initialSessionId: 'session-no-queue' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText(/cannot take new direction during a run/)).toBeInTheDocument();
		await expect(canvas.getByRole('button', { name: /Interrupt/ })).toBeEnabled();
	}
};
export const Starting: Story = { args: { workspaces: sessionFixtures.starting, initialSessionId: 'session-starting' } };
export const Running: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const prompt = canvas.getByRole('textbox', { name: 'Prompt' });
		await userEvent.type(prompt, 'Keep the public API unchanged.');
		await userEvent.click(canvas.getByRole('button', { name: /Send prompt/ }));
		await expect(canvas.getByText(/session-running: steer/)).toBeInTheDocument();
	}
};
export const PromptPending: Story = {
	args: { workspaces: sessionFixtures.idle, initialSessionId: 'session-idle', holdSend: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const prompt = canvas.getByRole('textbox', { name: 'Prompt' });
		await userEvent.type(prompt, 'Add a gutter test.');
		await userEvent.click(canvas.getByRole('button', { name: /Send prompt/ }));
		await expect(prompt).toHaveValue('');
		await expect(within(canvas.getByRole('region', { name: 'Transcript' })).getByText('Sending…')).toBeVisible();
	}
};
export const PromptNotSent: Story = {
	args: {
		workspaces: sessionFixtures.idle,
		initialSessionId: 'session-idle',
		sendFailure: 'The session stopped before the prompt arrived.'
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const prompt = canvas.getByRole('textbox', { name: 'Prompt' });
		await userEvent.type(prompt, 'Add a gutter test.');
		await userEvent.click(canvas.getByRole('button', { name: /Send prompt/ }));
		await expect(await canvas.findByText('Not sent')).toBeVisible();
		await expect(prompt).toHaveValue('Add a gutter test.');
	}
};
export const PromptHistory: Story = {
	args: { history: ['Explain the failing build.', 'Add tests for the parser.'] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const prompt = canvas.getByRole('textbox', { name: 'Prompt' });
		await userEvent.click(prompt);
		await userEvent.keyboard('{ArrowUp}');
		await expect(prompt).toHaveValue('Explain the failing build.');
		await userEvent.keyboard('{ArrowUp}');
		await expect(prompt).toHaveValue('Add tests for the parser.');
		await userEvent.keyboard('{ArrowDown}{ArrowDown}');
		await expect(prompt).toHaveValue('');
	}
};
export const EmptyPromptHistory: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const prompt = canvas.getByRole('textbox', { name: 'Prompt' });
		await userEvent.click(prompt);
		await userEvent.keyboard('{ArrowUp}{ArrowDown}');
		await expect(prompt).toHaveValue('');
	}
};
export const CommandCompletion: Story = {
	args: { commands: commandFixtures.populated },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const prompt = canvas.getByRole('textbox', { name: 'Prompt' });
		await userEvent.type(prompt, '/');
		await expect(await canvas.findByRole('listbox', { name: 'Commands' })).toBeInTheDocument();
		await expect(within(canvas.getByRole('listbox')).getAllByRole('option')).toHaveLength(
			commandFixtures.populated.length + BUILTIN_COMMANDS.length
		);
		await userEvent.keyboard('{ArrowDown}{Enter}');
		await expect(canvas.getByRole('textbox', { name: 'Prompt' })).toHaveValue('/review ');
	}
};
export const CommandCompletionFiltering: Story = {
	args: { commands: commandFixtures.populated },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole('textbox', { name: 'Prompt' }), '/re');
		await expect(await canvas.findByRole('option', { name: /release-notes/ })).toBeInTheDocument();
		const options = within(canvas.getByRole('listbox')).getAllByRole('option');
		await expect(options[0]).toHaveTextContent('/review');
		await expect(options[1]).toHaveTextContent('/resume');
		await expect(options[2]).toHaveTextContent('/reload');
		await expect(options[3]).toHaveTextContent('/skill:release-notes');
	}
};
export const BuiltinCommandUnavailable: Story = {
	args: { commands: commandFixtures.populated },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole('textbox', { name: 'Prompt' }), '/login');
		const option = await canvas.findByRole('option', { name: /\/login/ });
		await expect(option).toHaveAttribute('aria-disabled', 'true');
		await expect(option).toHaveTextContent(TERMINAL_ONLY_REASON);
	}
};
export const CommandCompletionNoMatches: Story = {
	args: { commands: commandFixtures.populated },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole('textbox', { name: 'Prompt' }), '/zzz');
		await expect(await canvas.findByText('No matching commands')).toBeInTheDocument();
		await userEvent.type(canvas.getByRole('textbox', { name: 'Prompt' }), ' now');
		await expect(await canvas.findByText(/Not a known command/)).toBeInTheDocument();
	}
};
export const CommandCompletionUnsupported: Story = {
	args: {
		workspaces: sessionFixtures.runningWithoutQueue,
		initialSessionId: 'session-no-queue',
		commands: commandFixtures.populated
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole('textbox', { name: 'Prompt' }), '/');
		await expect(canvas.queryByRole('listbox')).not.toBeInTheDocument();
		await expect(canvas.queryByText(/Not a known command/)).not.toBeInTheDocument();
	}
};
export const FileMentionResults: Story = {
	args: { files: fileMentionFixtures.populated },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const prompt = canvas.getByRole('textbox', { name: 'Prompt' });
		await userEvent.type(prompt, '@');
		await expect(await canvas.findByRole('listbox', { name: 'Files' })).toBeInTheDocument();
		await expect(within(canvas.getByRole('listbox')).getAllByRole('option')).toHaveLength(5);
		await userEvent.keyboard('{ArrowDown}{Enter}');
		await expect(prompt).toHaveValue('@src/App.svelte ');
	}
};
export const FileMentionFiltering: Story = {
	args: { files: fileMentionFixtures.populated },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole('textbox', { name: 'Prompt' }), '@release');
		await expect(await canvas.findByRole('option', { name: /release notes.md/ })).toBeInTheDocument();
		await expect(within(canvas.getByRole('listbox')).getAllByRole('option')).toHaveLength(1);
		await userEvent.keyboard('{Tab}');
		await expect(canvas.getByRole('textbox', { name: 'Prompt' })).toHaveValue('@"docs/release notes.md" ');
	}
};
export const FileMentionNoMatches: Story = {
	args: { files: fileMentionFixtures.populated },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole('textbox', { name: 'Prompt' }), '@zzz');
		await expect(await canvas.findByText('No matching files')).toBeInTheDocument();
	}
};
export const FileMentionMidDraft: Story = {
	args: { files: fileMentionFixtures.populated },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const prompt = canvas.getByRole('textbox', { name: 'Prompt' });
		await userEvent.type(prompt, 'compare  with the old one');
		await userEvent.keyboard('{ArrowLeft>17/}@api');
		await expect(await canvas.findByRole('option', { name: /api.ts/ })).toBeInTheDocument();
		await userEvent.keyboard('{Enter}');
		await expect(prompt).toHaveValue('compare @src/lib/api.ts  with the old one');
	}
};
export const FileMentionWithSlashCompletion: Story = {
	args: { files: fileMentionFixtures.populated, commands: commandFixtures.populated },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const prompt = canvas.getByRole('textbox', { name: 'Prompt' });
		await userEvent.type(prompt, '/');
		await expect(await canvas.findByRole('listbox', { name: 'Commands' })).toBeInTheDocument();
		await userEvent.keyboard('{ArrowDown}{Enter}');
		await expect(prompt).toHaveValue('/review ');
		await userEvent.type(prompt, '@read');
		await expect(await canvas.findByRole('listbox', { name: 'Files' })).toBeInTheDocument();
		await userEvent.keyboard('{Enter}');
		await expect(prompt).toHaveValue('/review @README.md ');
	}
};
export const ResourcePressure: Story = {
	args: {
		workspaces: sessionFixtures.running,
		initialSessionId: 'session-running',
		resourceSnapshot: {
			...resourceMonitoringFixtures.active[2]!,
			sessionId: 'session-running',
			label: 'Run session registry tests'
		}
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Stop session' }));
		await expect(canvas.getByText('session-running: stop')).toBeInTheDocument();
	}
};
export const Waiting: Story = { args: { workspaces: sessionFixtures.waiting, initialSessionId: 'session-waiting' } };
export const Failed: Story = {
	args: { workspaces: sessionFixtures.failed, initialSessionId: 'session-failed' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('region', { name: 'Session ended' })).toHaveTextContent('Session failed.');
		await expect(canvas.queryByRole('form', { name: 'Prompt composer' })).not.toBeInTheDocument();
		await userEvent.click(canvas.getByRole('button', { name: 'Start again' }));
		await expect(canvas.getByText('session-failed: start again')).toBeInTheDocument();
	}
};
export const SandboxDenials: Story = {
	args: { workspaces: sessionFixtures.sandboxDenials, initialSessionId: 'sandbox-denials' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getAllByLabelText('Sandbox denial')).toHaveLength(4);
		await expect(canvas.getByText('/home/me/.ssh/id_ed25519')).toBeVisible();
		await expect(canvas.getByText('api.example.com:443')).toBeVisible();
		await expect(canvas.getByText('Sandbox may have blocked this call')).toBeVisible();
	}
};
const groupedTools = sessionFixtures.idle.map((workspace) => ({
	...workspace,
	sessions: workspace.sessions.map((session) => ({
		...session,
		transcript: [
			{
				id: 'grouped-prompt',
				kind: 'message' as const,
				role: 'user' as const,
				body: 'Cover folded ranges in the wrap tests.'
			},
			toolCallFixtures.read,
			toolCallFixtures.edit,
			toolCallFixtures.write,
			toolCallFixtures.bashComplete,
			toolCallFixtures.bashFailed,
			toolCallFixtures.extension
		]
	}))
}));
export const ToolCallGroups: Story = {
	args: { workspaces: groupedTools, initialSessionId: 'session-idle' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText('4 tool calls')).toBeVisible();
		await expect(canvas.getByText('Failed')).toBeVisible();
		await expect(canvas.getByText('+1 −1')).not.toBeVisible();
	}
};
export const FailedTurn: Story = {
	args: { workspaces: sessionFixtures.failedTurn, initialSessionId: 'session-idle' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('button', { name: 'Send message again' })).toBeEnabled();
	}
};
export const FailedTurnWithoutSendAgain: Story = {
	args: { workspaces: sessionFixtures.failedTurnWithoutRetry, initialSessionId: 'session-idle' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText(/529 overloaded/)).toBeInTheDocument();
		await expect(canvas.queryByRole('button', { name: 'Send message again' })).not.toBeInTheDocument();
	}
};
export const SendingAgain: Story = {
	args: { workspaces: sessionFixtures.failedTurn, initialSessionId: 'session-idle' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Send message again' }));
		await expect(canvas.getByText('session-idle: retry')).toBeInTheDocument();
		await expect(canvas.getByRole('button', { name: 'Sending…' })).toBeDisabled();
	}
};
export const SendAgainRejected: Story = {
	args: {
		workspaces: sessionFixtures.failedTurn,
		initialSessionId: 'session-idle',
		retryFailure: 'The last reply did not fail, so there is nothing to send again.'
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Send message again' }));
		await expect(await canvas.findByRole('alert')).toHaveTextContent('nothing to send again');
		await expect(canvas.getByRole('button', { name: 'Send message again' })).toBeEnabled();
	}
};
export const AutomaticRetryPending: Story = {
	args: { workspaces: sessionFixtures.autoRetryPending, initialSessionId: 'session-running' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText(/Retrying in \d+s, attempt 2 of 3/)).toBeInTheDocument();
		await userEvent.click(canvas.getByRole('button', { name: 'Cancel retry' }));
		await expect(canvas.getByText('session-running: cancel retry')).toBeInTheDocument();
	}
};
export const QueueEmpty: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByRole('region', { name: 'Queued messages' })).not.toBeInTheDocument();
	}
};
export const QueuedMessages: Story = {
	args: { workspaces: sessionFixtures.queued, initialSessionId: 'session-running' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const queue = within(canvas.getByRole('region', { name: 'Queued messages' }));
		await expect(queue.getByText('Steer')).toBeInTheDocument();
		await expect(queue.getByText('Keep the public API unchanged.')).toBeInTheDocument();
		await expect(queue.getAllByText('Follow up')).toHaveLength(2);
		await expect(queue.getByText('Add a regression test for soft-wrap.')).toBeInTheDocument();
	}
};
export const QueueCleared: Story = {
	args: {
		workspaces: sessionFixtures.queued,
		initialSessionId: 'session-running',
		clearedQueue: { steering: ['Keep the public API unchanged.'], followUp: ['Add a regression test for soft-wrap.'] }
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const prompt = canvas.getByRole('textbox', { name: 'Prompt' });
		await userEvent.type(prompt, 'Draft in progress.');
		await userEvent.click(canvas.getByRole('button', { name: 'Clear queue' }));
		await expect(canvas.getByText('session-running: clear queue')).toBeInTheDocument();
		await expect(prompt).toHaveValue(
			'Draft in progress.\n\nKeep the public API unchanged.\n\nAdd a regression test for soft-wrap.'
		);
	}
};
export const Stopped: Story = {
	args: { workspaces: sessionFixtures.stopped, initialSessionId: 'session-stopped' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('region', { name: 'Session ended' })).toHaveTextContent('Session stopped.');
		await expect(canvas.queryByRole('form', { name: 'Prompt composer' })).not.toBeInTheDocument();
		await expect(canvas.queryByRole('button', { name: 'Compact' })).not.toBeInTheDocument();
		await expect(canvas.getByRole('button', { name: 'Start again' })).toBeEnabled();
	}
};
export const ExtensionConfirmation: Story = {
	args: { workspaces: sessionFixtures.extensionConfirm, initialSessionId: 'extension-confirm' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement.ownerDocument.body);
		await expect(canvas.getByRole('dialog', { name: 'Allow workspace update?' })).toBeVisible();
		await userEvent.click(canvas.getByRole('button', { name: 'Yes' }));
		await expect(canvas.getByText(/"confirmed":true/)).toBeInTheDocument();
	}
};
export const TerminalOnlyExtension: Story = {
	args: { workspaces: sessionFixtures.extensionUnsupported, initialSessionId: 'extension-custom' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement.ownerDocument.body);
		await expect(canvas.getByText(/Pau cannot render/)).toBeVisible();
	}
};
export const ConcurrentSessions: Story = {
	args: { workspaces: sessionFixtures.concurrent, initialSessionId: 'diff-gutter' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: /Review adapter fixtures/ }));
		await expect(canvas.getByRole('heading', { name: 'Review adapter fixtures' })).toBeInTheDocument();
		await expect(canvas.getByText('Claude', { exact: false })).toBeInTheDocument();
	}
};
/** The context rail dragged to its 160px minimum. Names truncate and each status stays on its row's line. */
export const NarrowRail: Story = {
	args: {
		workspaces: sessionFixtures.concurrent,
		initialSessionId: 'diff-gutter',
		paneWidths: { contextRail: 160, inspector: null }
	}
};
export const SessionMenu: Story = {
	args: { workspaces: sessionFixtures.idleWithPath, initialSessionId: 'session-idle' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const row = canvas.getByRole('button', { name: /Fix diff gutter/ });
		row.focus();
		await userEvent.keyboard('{Shift>}{F10}{/Shift}');
		const menu = canvas.getByRole('menu', { name: 'Fix diff gutter actions' });
		await expect(within(menu).getByRole('menuitem', { name: 'Archive' })).toHaveAccessibleDescription('Coming soon');
		await userEvent.click(within(menu).getByRole('menuitem', { name: 'Clone' }));
		await expect(canvas.getByText('session-idle: clone')).toBeInTheDocument();
		await expect(row).toHaveFocus();
	}
};
export const StoppedSessionMenu: Story = {
	args: { workspaces: sessionFixtures.idleWithPath, initialSessionId: 'session-idle' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		canvas.getByRole('button', { name: /Review fixtures/ }).focus();
		await userEvent.keyboard('{Shift>}{F10}{/Shift}');
		const menu = canvas.getByRole('menu', { name: 'Review fixtures actions' });
		await expect(within(menu).getByRole('menuitem', { name: 'Stop' })).toHaveAccessibleDescription(
			'This session has ended.'
		);
		await userEvent.keyboard('{Escape}');
		await expect(canvas.queryByRole('menu')).not.toBeInTheDocument();
	}
};
export const WorkspaceMenu: Story = {
	args: { workspaces: sessionFixtures.idleWithPath, initialSessionId: 'session-idle' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.pointer({ keys: '[MouseRight]', target: canvas.getByRole('heading', { name: 'Pau' }) });
		const menu = canvas.getByRole('menu', { name: 'Pau actions' });
		await expect(within(menu).getByRole('menuitem', { name: 'Remove workspace' })).toHaveAccessibleDescription(
			'Coming soon'
		);
		await userEvent.click(within(menu).getByRole('menuitem', { name: 'Open terminal' }));
		await expect(canvas.getByText('pau: open terminal')).toBeInTheDocument();
	}
};
export const MessageMenu: Story = {
	args: { workspaces: sessionFixtures.idleWithPath, initialSessionId: 'session-idle' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		canvas.getByRole('article', { name: 'user message' }).focus();
		await userEvent.keyboard('{Shift>}{F10}{/Shift}');
		await userEvent.click(canvas.getByRole('menuitem', { name: 'Branch from here' }));
		await expect(canvas.getByText('session-idle: branch from prompt-1')).toBeInTheDocument();
		await expect(canvas.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Edited prompt');
	}
};
export const MessageMenuBranchUnavailable: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		canvas.getByRole('article', { name: 'user message' }).focus();
		await userEvent.keyboard('{Shift>}{F10}{/Shift}');
		await expect(canvas.getByRole('menuitem', { name: 'Branch from here' })).toHaveAccessibleDescription(
			'Wait for Pi to finish before branching.'
		);
		await expect(canvas.getByRole('menuitem', { name: 'Copy message' })).toBeInTheDocument();
	}
};
export const Narrow: Story = {
	args: { workspaces: sessionFixtures.sandboxDenials, initialSessionId: 'sandbox-denials' },
	parameters: { viewport: { defaultViewport: 'narrow' } }
};
export const ModelControls: Story = {
	args: {
		workspaces: sessionFixtures.modelControls,
		initialSessionId: 'session-running',
		models: modelFixtures.populated
	},
	play: async ({ canvasElement }) => {
		const composer = within(canvasElement.querySelector<HTMLElement>('form[aria-label="Prompt composer"]')!);
		await expect(await composer.findByRole('button', { name: 'Model: Claude Sonnet 4.5' })).toBeVisible();
		await expect(composer.getByRole('combobox', { name: 'Thinking level' })).toBeVisible();
		await expect(composer.getByRole('meter', { name: 'Context window used' })).toBeVisible();
		await expect(composer.getByRole('button', { name: /Send prompt/ })).toBeVisible();
	}
};
export const NarrowModelControls: Story = { ...ModelControls, parameters: { viewport: { defaultViewport: 'narrow' } } };
export const NarrowRunning: Story = {
	args: { workspaces: sessionFixtures.queued, initialSessionId: 'session-running' },
	parameters: { viewport: { defaultViewport: 'narrow' } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('combobox', { name: 'Send as' })).toBeVisible();
		await expect(canvas.getByRole('button', { name: /Send prompt/ })).toBeVisible();
	}
};

export const CompactingManually: Story = {
	args: { workspaces: sessionFixtures.compactingManual, initialSessionId: 'session-idle' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText('Compacting the conversation…', { selector: 'p' })).toBeVisible();
		await expect(canvas.getByRole('button', { name: 'Compact' })).toBeDisabled();
		await expect(canvas.getByRole('img', { name: 'Compacting…' })).toBeVisible();
		await expect(canvas.getByRole('textbox', { name: 'Prompt' })).toBeDisabled();
		await expect(canvas.getByText(/You can send a prompt when it finishes/)).toBeVisible();
	}
};
export const CompactingAutomatically: Story = {
	args: { workspaces: sessionFixtures.compactingAutomatic, initialSessionId: 'session-running' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText(/because the context is nearly full/)).toBeVisible();
		await expect(canvas.getByRole('button', { name: 'Compact' })).toBeDisabled();
		await expect(canvas.getByRole('img', { name: 'Compacting…' })).toBeVisible();
		// Steering still queues behind the compaction.
		const prompt = canvas.getByRole('textbox', { name: 'Prompt' });
		await expect(prompt).toBeEnabled();
		await userEvent.type(prompt, 'Keep going');
		await userEvent.click(canvas.getByRole('button', { name: /Send prompt/ }));
		await expect(canvas.getByText('session-running: steer: Keep going')).toBeInTheDocument();
	}
};
export const CompactAction: Story = {
	args: { workspaces: sessionFixtures.idle, initialSessionId: 'session-idle' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Compact' }));
		await userEvent.type(canvas.getByLabelText('Instructions (optional)'), 'Keep the file list');
		await userEvent.click(canvas.getByRole('button', { name: 'Compact now' }));
		await expect(canvas.getByText('session-idle: compact: Keep the file list')).toBeInTheDocument();
	}
};
export const CompactRejected: Story = {
	args: {
		workspaces: sessionFixtures.idle,
		initialSessionId: 'session-idle',
		compactFailure: 'Pi could not compact this session: Nothing to compact (session too small)'
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Compact' }));
		await userEvent.click(canvas.getByRole('button', { name: 'Compact now' }));
		await expect(await canvas.findByRole('alert')).toHaveTextContent('Nothing to compact');
		await expect(canvas.getByRole('button', { name: 'Compact' })).toBeEnabled();
	}
};
export const Compacted: Story = {
	args: { workspaces: sessionFixtures.compacted, initialSessionId: 'session-idle' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const marker = canvas.getByLabelText('Compacted context');
		await expect(within(marker).getByText('Context compacted')).toBeVisible();
		await expect(within(marker).getByText('84,210 → about 12,300 tokens')).toBeVisible();
		await userEvent.click(within(marker).getByText('Context compacted'));
		await expect(within(marker).getByText(/renderer in src\/diff\/gutter.ts/)).toBeVisible();
	}
};
export const CompactedAutomatically: Story = {
	args: { workspaces: sessionFixtures.compactedAutomatically, initialSessionId: 'session-idle' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText('Context compacted automatically')).toBeVisible();
		await expect(canvas.getByText('201,000 tokens before')).toBeVisible();
	}
};
export const CompactionFailed: Story = {
	args: { workspaces: sessionFixtures.compactionFailed, initialSessionId: 'session-idle' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('alert')).toHaveTextContent(
			'Compaction failed. Nothing to compact (session too small). The conversation is unchanged.'
		);
		await expect(canvas.getByRole('textbox', { name: 'Prompt' })).toBeEnabled();
	}
};
export const CompactionAborted: Story = {
	args: { workspaces: sessionFixtures.compactionAborted, initialSessionId: 'session-idle' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText('Compaction cancelled.')).toBeVisible();
		await expect(canvas.getByRole('button', { name: 'Compact' })).toBeEnabled();
	}
};
export const CompactionUnsupported: Story = {
	args: { workspaces: sessionFixtures.compactionUnsupported, initialSessionId: 'session-idle' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByRole('button', { name: 'Compact' })).not.toBeInTheDocument();
	}
};

const pixel = Uint8Array.from(
	atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='),
	(character) => character.codePointAt(0) ?? 0
);
const screenshot = () => new File([pixel], 'screenshot.png', { type: 'image/png' });

export const ImagesAttached: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.upload(canvas.getByLabelText('Image files'), screenshot());
		await expect(canvas.getByRole('img', { name: 'screenshot.png' })).toBeVisible();
		await userEvent.type(canvas.getByRole('textbox', { name: 'Prompt' }), 'What is in this image?');
		await userEvent.click(canvas.getByRole('button', { name: /Send prompt/ }));
		await expect(canvas.getByText(/session-running: steer: What is in this image\? \(1 image\)/)).toBeInTheDocument();
		await expect(canvas.queryByRole('img', { name: 'screenshot.png' })).not.toBeInTheDocument();
	}
};
export const ImageRemoved: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.upload(canvas.getByLabelText('Image files'), screenshot());
		await userEvent.click(canvas.getByRole('button', { name: 'Remove screenshot.png' }));
		await expect(canvas.queryByRole('img', { name: 'screenshot.png' })).not.toBeInTheDocument();
	}
};
export const ImageTypeRejected: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// The picker filters by type, so bypass its accept check to reach the validation.
		const input = canvas.getByLabelText<HTMLInputElement>('Image files');
		await userEvent.upload(input, new File(['%PDF'], 'notes.pdf', { type: 'application/pdf' }), { applyAccept: false });
		await expect(canvas.getByRole('alert')).toHaveTextContent('notes.pdf is not a supported image');
		await expect(canvas.queryByRole('list', { name: 'Attached images' })).not.toBeInTheDocument();
	}
};
export const ImageTooLarge: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const large = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' });
		await userEvent.upload(canvas.getByLabelText('Image files'), large);
		await expect(canvas.getByRole('alert')).toHaveTextContent('huge.png is larger than 5 MiB');
	}
};
export const ModelWithoutImageInput: Story = {
	args: {
		sendFailure:
			'The current model cannot read images. Switch to a model with image input, or remove the images and send again.'
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.upload(canvas.getByLabelText('Image files'), screenshot());
		await userEvent.type(canvas.getByRole('textbox', { name: 'Prompt' }), 'Describe this.');
		await userEvent.click(canvas.getByRole('button', { name: /Send prompt/ }));
		// The send fails asynchronously, so wait for the alert instead of querying at once.
		await expect(await canvas.findByRole('alert')).toHaveTextContent('The current model cannot read images');
		await expect(await canvas.findByRole('img', { name: 'screenshot.png' })).toBeVisible();
	}
};

const longTranscript = sessionFixtures.running.map((workspace) => ({
	...workspace,
	sessions: workspace.sessions.map((session) => ({
		...session,
		transcript: Array.from({ length: 30 }, (_, index) => ({
			id: `long-${index}`,
			kind: 'message' as const,
			role: 'assistant' as const,
			body: `Streamed paragraph ${index}. `.repeat(12)
		}))
	}))
}));
export const JumpToLatest: Story = {
	args: { workspaces: longTranscript, replyOnSend: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const transcript = canvas.getByLabelText('Transcript');
		await expect(canvas.queryByRole('button', { name: /Jump to latest/ })).not.toBeInTheDocument();

		transcript.scrollTop = 0;
		await userEvent.type(canvas.getByRole('textbox', { name: 'Prompt' }), 'More please.');
		await userEvent.click(canvas.getByRole('button', { name: /Send prompt/ }));

		const jump = await canvas.findByRole('button', { name: /Jump to latest/ });
		await expect(await canvas.findByText('New output below')).toBeInTheDocument();
		await userEvent.click(jump);
		await waitFor(() => expect(canvas.queryByRole('button', { name: /Jump to latest/ })).not.toBeInTheDocument(), {
			timeout: 5000
		});
		await expect(transcript).toHaveAttribute('data-following', 'true');
	}
};
