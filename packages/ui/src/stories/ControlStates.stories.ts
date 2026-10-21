import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import ControlStatesDemo from './ControlStatesDemo.svelte';

const meta = {
	title: 'Controls/States',
	component: ControlStatesDemo,
	parameters: { layout: 'fullscreen' }
} satisfies Meta<typeof ControlStatesDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every shared control class at rest, with its disabled form beside it. */
export const Sheet: Story = {};

/** Hovering a disabled control leaves it unchanged. */
export const DisabledHover: Story = {
	play: async ({ canvasElement }) => {
		const button = within(canvasElement).getAllByRole('button', { name: 'Open workspace' })[1]!;
		const rest = getComputedStyle(button).backgroundImage;
		await userEvent.hover(button);
		await expect(getComputedStyle(button).backgroundImage).toBe(rest);
	}
};
