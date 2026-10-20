import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import { resourceMonitoringFixtures } from '../fixtures/resource-monitoring';
import ProcessesViewDemo from './ProcessesViewDemo.svelte';

const meta = {
	title: 'Processes/Workspace processes',
	component: ProcessesViewDemo,
	parameters: { layout: 'fullscreen' },
	args: { processes: resourceMonitoringFixtures.active }
} satisfies Meta<typeof ProcessesViewDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Expand Fix diff gutter process tree' }));
		await expect(canvas.getByText('PID 3812')).toBeVisible();
	}
};

export const SustainedPressure: Story = {
	args: { processes: [resourceMonitoringFixtures.active[2]!] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Interrupt' }));
		await expect(canvas.getByText('Interrupted registry-tests')).toBeVisible();
	}
};

export const CompletedSummary: Story = { args: { processes: [resourceMonitoringFixtures.completed] } };
export const Empty: Story = { args: { processes: [] } };
export const Unavailable: Story = {
	args: { processes: [], unavailable: "Pau doesn't collect resource use for workspace processes yet." }
};
export const InApplicationShell: Story = { args: { inShell: true } };
export const Narrow: Story = { parameters: { viewport: { defaultViewport: 'narrow' } } };
