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
	args: { workspaces: sessionFixtures.concurrent, initialSessionId: 'diff-gutter' },
	parameters: { viewport: { defaultViewport: 'narrow' } }
};
