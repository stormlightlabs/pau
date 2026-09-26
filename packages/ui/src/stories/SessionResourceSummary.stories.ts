import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { resourceMonitoringFixtures } from '../fixtures/resource-monitoring';
import SessionResourceSummary from '../lib/SessionResourceSummary.svelte';

const meta = {
	title: 'Processes/Session resource summary',
	component: SessionResourceSummary,
	args: {
		snapshot: resourceMonitoringFixtures.active[0],
		actions: { interrupt: true, stop: true },
		onInterrupt: fn(),
		onStop: fn()
	}
} satisfies Meta<typeof SessionResourceSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Current: Story = {};
export const MissingCounters: Story = { args: { snapshot: resourceMonitoringFixtures.active[1] } };
export const SustainedPressure: Story = {
	args: { snapshot: resourceMonitoringFixtures.active[2] },
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText(/session will keep running/i)).toBeVisible();
		await userEvent.click(canvas.getByRole('button', { name: 'Stop session' }));
		await expect(args.onStop).toHaveBeenCalledWith('registry-tests');
	}
};
export const WaitingForSample: Story = { args: { snapshot: undefined } };
