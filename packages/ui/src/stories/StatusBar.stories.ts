import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import { statusBarFixtures } from '../fixtures/status-bar';
import StatusBarDemo from './StatusBarDemo.svelte';

const { version, agentVersion } = statusBarFixtures;

const meta = {
	title: 'Shell/Status bar',
	component: StatusBarDemo,
	parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'wide' } },
	args: { version, agentVersion, ...statusBarFixtures.idle }
} satisfies Meta<typeof StatusBarDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

const bar = (canvasElement: HTMLElement) => within(canvasElement).getByRole('contentinfo', { name: 'Status' });

/** One idle session: low figures, and the session's context, tokens and cost. */
export const Idle: Story = {
	play: async ({ canvasElement }) => {
		await expect(bar(canvasElement)).toHaveTextContent('Branch main');
		await expect(bar(canvasElement)).toHaveTextContent('Pi 0.70.2');
		await expect(bar(canvasElement)).toHaveTextContent('Pau 0.6.0');
	}
};

/** Four sessions at work. The panel lists each one's tree. */
export const Busy: Story = {
	args: statusBarFixtures.busy,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: /^Pau/ }));
		const panel = canvas.getByRole('group', { name: 'Resource use' });
		await expect(within(panel).getByRole('heading', { name: 'Sessions 4' })).toBeVisible();
		await userEvent.keyboard('{Escape}');
		await expect(canvas.getByRole('button', { name: /^Pau/ })).toHaveFocus();
	}
};

/** The open session started fourteen processes. The panel scrolls inside the window. */
export const ManyProcesses: Story = {
	args: statusBarFixtures.manyProcesses,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: /^Pau/ }));
		const list = canvas.getByRole('list', { name: 'Processes of Model list filter' });
		await expect(within(list).getAllByRole('listitem')).toHaveLength(14);
	}
};

/** The open session forked hundreds of processes. The panel lists the largest and counts the rest. */
export const Runaway: Story = {
	args: statusBarFixtures.runaway,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: /^Pau/ }));
		await expect(canvas.getByRole('group', { name: 'Resource use' })).toHaveTextContent('and 312 more');
	}
};

/** A sandboxed workspace with changes and no session. */
export const NoSession: Story = {
	args: statusBarFixtures.noSession,
	play: async ({ canvasElement }) => {
		await expect(bar(canvasElement)).toHaveTextContent('No session');
		await expect(bar(canvasElement)).toHaveTextContent('4 changed');
	}
};

/** Before the first sample, or after sampling fails, Pau shows its version and the panel says nothing is measured. */
export const NotMeasured: Story = { args: { usage: undefined } };

/** Below 1200px labels leave the screen and versions, tokens, cost and process counts drop. */
export const Narrow: Story = { args: statusBarFixtures.busy, parameters: { viewport: { defaultViewport: 'narrow' } } };
