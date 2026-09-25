import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

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
export const Waiting: Story = { args: { workspaces: sessionFixtures.waiting, initialSessionId: 'session-waiting' } };
export const Failed: Story = { args: { workspaces: sessionFixtures.failed, initialSessionId: 'session-failed' } };
export const Stopped: Story = { args: { workspaces: sessionFixtures.stopped, initialSessionId: 'session-stopped' } };
export const ConcurrentSessions: Story = {
	args: { workspaces: sessionFixtures.concurrent, initialSessionId: 'diff-gutter' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: /Review session registry/ }));
		await expect(canvas.getByRole('heading', { name: 'Review session registry' })).toBeInTheDocument();
	}
};
export const Narrow: Story = {
	args: { workspaces: sessionFixtures.concurrent, initialSessionId: 'diff-gutter' },
	parameters: { viewport: { defaultViewport: 'narrow' } }
};
