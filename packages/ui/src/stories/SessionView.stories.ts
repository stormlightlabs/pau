import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import { commandFixtures } from '../fixtures/commands';
import { resourceMonitoringFixtures } from '../fixtures/resource-monitoring';
import { sessionFixtures } from '../fixtures/sessions';
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
export const Loading: Story = {
	args: { workspaces: sessionFixtures.empty, initialSessionId: undefined, loading: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('heading', { name: 'Loading sessions…' })).toBeInTheDocument();
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
		await userEvent.click(canvas.getByRole('button', { name: 'Start session in Pau' }));
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
		await expect(within(canvas.getByRole('listbox')).getAllByRole('option')).toHaveLength(4);
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
		await expect(options).toHaveLength(2);
		await expect(options[0]).toHaveTextContent('/review');
		await expect(options[1]).toHaveTextContent('/skill:release-notes');
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
export const Failed: Story = { args: { workspaces: sessionFixtures.failed, initialSessionId: 'session-failed' } };
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
export const FailedTurn: Story = {
	args: { workspaces: sessionFixtures.failedTurn, initialSessionId: 'session-idle' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('button', { name: 'Retry' })).toBeEnabled();
	}
};
export const FailedTurnWithoutRetry: Story = {
	args: { workspaces: sessionFixtures.failedTurnWithoutRetry, initialSessionId: 'session-idle' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText(/529 overloaded/)).toBeInTheDocument();
		await expect(canvas.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
	}
};
export const Retrying: Story = {
	args: { workspaces: sessionFixtures.failedTurn, initialSessionId: 'session-idle' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Retry' }));
		await expect(canvas.getByText('session-idle: retry')).toBeInTheDocument();
		await expect(canvas.getByRole('button', { name: 'Retrying…' })).toBeDisabled();
	}
};
export const RetryRejected: Story = {
	args: {
		workspaces: sessionFixtures.failedTurn,
		initialSessionId: 'session-idle',
		retryFailure: 'That turn did not fail, so there is nothing to retry.'
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Retry' }));
		await expect(await canvas.findByRole('alert')).toHaveTextContent('nothing to retry');
		await expect(canvas.getByRole('button', { name: 'Retry' })).toBeEnabled();
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
export const Stopped: Story = { args: { workspaces: sessionFixtures.stopped, initialSessionId: 'session-stopped' } };
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
		await expect(canvas.getByText('Claude · Sonnet')).toBeInTheDocument();
	}
};
export const Narrow: Story = {
	args: { workspaces: sessionFixtures.sandboxDenials, initialSessionId: 'sandbox-denials' },
	parameters: { viewport: { defaultViewport: 'narrow' } }
};

export const CompactingManually: Story = {
	args: { workspaces: sessionFixtures.compactingManual, initialSessionId: 'session-idle' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText('Compacting the conversation…', { selector: 'p' })).toBeVisible();
		await expect(canvas.getByRole('button', { name: 'Compacting…' })).toBeDisabled();
		await expect(canvas.getByRole('textbox', { name: 'Prompt' })).toBeDisabled();
		await expect(canvas.getByText(/You can send a prompt when it finishes/)).toBeVisible();
	}
};
export const CompactingAutomatically: Story = {
	args: { workspaces: sessionFixtures.compactingAutomatic, initialSessionId: 'session-running' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText(/because the context is nearly full/)).toBeVisible();
		await expect(canvas.getByRole('button', { name: 'Compacting…' })).toBeDisabled();
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
		await expect(canvas.getByRole('alert')).toHaveTextContent('The current model cannot read images');
		await expect(canvas.getByRole('img', { name: 'screenshot.png' })).toBeVisible();
	}
};
