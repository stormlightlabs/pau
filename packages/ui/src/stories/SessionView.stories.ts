import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

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
