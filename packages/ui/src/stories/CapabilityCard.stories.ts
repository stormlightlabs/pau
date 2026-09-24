import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import { capabilityFixtures } from '../fixtures/capabilities';
import CapabilityCard from '../lib/CapabilityCard.svelte';

const meta = {
	title: 'Workbench/Capability card',
	component: CapabilityCard,
	tags: ['autodocs'],
	args: { capability: capabilityFixtures.available }
} satisfies Meta<typeof CapabilityCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Available: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const button = canvas.getByRole('button', { name: 'Disable' });

		await userEvent.click(button);

		await expect(canvas.getByText('Unavailable')).toBeInTheDocument();
		await expect(canvas.getByRole('button', { name: 'Enable' })).toHaveAttribute('aria-pressed', 'false');
	}
};

export const Unavailable: Story = { args: { capability: capabilityFixtures.unavailable } };
