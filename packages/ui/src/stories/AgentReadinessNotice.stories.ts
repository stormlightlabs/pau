import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { agentReadinessFixtures } from '../fixtures/launch';
import AgentReadinessNotice from '../lib/AgentReadinessNotice.svelte';

const meta = {
	title: 'Launch/Pi readiness notice',
	component: AgentReadinessNotice,
	parameters: { layout: 'padded' },
	args: { problem: agentReadinessFixtures.missing, onOpenTerminal: fn() }
} satisfies Meta<typeof AgentReadinessNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PiMissing: Story = {
	play: async ({ args, canvasElement }) => {
		await userEvent.click(within(canvasElement).getByRole('button', { name: 'Open terminal' }));
		await expect(args.onOpenTerminal).toHaveBeenCalledOnce();
	}
};

export const PiOutdated: Story = { args: { problem: agentReadinessFixtures.outdated } };

export const NoProvider: Story = { args: { problem: agentReadinessFixtures.noProvider } };

export const WithoutWorkspace: Story = { args: { onOpenTerminal: undefined } };

export const PiMissingNarrow: Story = { parameters: { viewport: { defaultViewport: 'narrow' } } };
