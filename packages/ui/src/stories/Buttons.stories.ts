import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import ButtonsDemo from './ButtonsDemo.svelte';

const meta = {
	title: 'Foundation/Buttons',
	component: ButtonsDemo,
	parameters: { layout: 'fullscreen' }
} satisfies Meta<typeof ButtonsDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every variant at rest and disabled, with an icon, a key cap and a long label. */
export const Rest: Story = {};

/** Keyboard focus draws the 2px focus ring outside the button. */
export const Focus: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.tab();
		const focused = canvasElement.ownerDocument.activeElement!;
		await expect(focused).toHaveAccessibleName('Send prompt');
		await expect(getComputedStyle(focused).outlineWidth).toBe('2px');
	}
};

/** A disabled button ignores hover. */
export const Disabled: Story = {
	play: async ({ canvasElement }) => {
		const button = within(canvasElement).getAllByRole('button', { name: 'Send prompt' })[1]!;
		await expect(button).toBeDisabled();
		const rest = getComputedStyle(button).backgroundColor;
		await userEvent.hover(button);
		await expect(getComputedStyle(button).backgroundColor).toBe(rest);
	}
};

/** In a narrow container the rows wrap. */
export const Narrow: Story = { args: { width: '18rem' } };
