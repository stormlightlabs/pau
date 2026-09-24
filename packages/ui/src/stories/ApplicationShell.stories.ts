import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import ApplicationShellDemo from './ApplicationShellDemo.svelte';

const meta = {
	title: 'Shell/Application shell',
	component: ApplicationShellDemo,
	parameters: { layout: 'fullscreen' },
	args: { disconnected: false, inspectorOpen: true, longContent: false }
} satisfies Meta<typeof ApplicationShellDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RailsAndInspector: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const inspectorToggle = canvas.getByRole('button', { name: 'Hide inspector' });

		await userEvent.click(inspectorToggle);
		await expect(canvas.queryByRole('complementary', { name: 'Inspector' })).not.toBeInTheDocument();
		await expect(canvas.getByRole('button', { name: 'Show inspector' })).toHaveAttribute('aria-expanded', 'false');
	}
};

export const InspectorClosed: Story = { args: { inspectorOpen: false } };

export const LongContent: Story = { args: { longContent: true } };

export const Disconnected: Story = { args: { disconnected: true } };

export const NarrowLayout: Story = {
	parameters: { viewport: { defaultViewport: 'narrow' } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const inspector = canvas.getByRole('complementary', { name: 'Inspector' });
		const navigationToggle = canvas.getByRole('button', { name: 'Open navigation' });

		await userEvent.click(within(inspector).getByRole('button', { name: 'Close inspector' }));
		await userEvent.click(navigationToggle);
		await expect(navigationToggle).toHaveAttribute('aria-expanded', 'true');
	}
};
