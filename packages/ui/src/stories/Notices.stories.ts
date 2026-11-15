import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import NoticesDemo from './NoticesDemo.svelte';

const meta = {
	title: 'Foundation/Notices',
	component: NoticesDemo,
	parameters: { layout: 'fullscreen' }
} satisfies Meta<typeof NoticesDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Information, warning and danger notices, a plain one, and the notice slot. */
export const Rest: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('region', { name: 'Pau could not start' })).toBeInTheDocument();
		for (const button of canvas.getAllByRole('button')) await expect(button.getBoundingClientRect().height).toBe(32);
	}
};

/** A notice's actions take focus in reading order. */
export const Focus: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.tab();
		await expect(canvasElement.ownerDocument.activeElement).toHaveAccessibleName('Open terminal');
	}
};

/** In a narrow column the text wraps and the actions stay beside it. */
export const Narrow: Story = { args: { width: '28rem' } };
