import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import MenusDemo from './MenusDemo.svelte';

const meta = { title: 'Foundation/Menus', component: MenusDemo, parameters: { layout: 'fullscreen' } } satisfies Meta<
	typeof MenusDemo
>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The menu surface with icons, a check, a hint, a key cap and a disabled row. */
export const Rest: Story = {
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByRole('menuitem', { name: /Open in editor/ })).toHaveAttribute(
			'aria-disabled',
			'true'
		);
	}
};

/** Arrow keys move the active row. */
export const Keyboard: Story = {
	play: async ({ canvasElement }) => {
		const menu = within(canvasElement).getByRole('menu');
		menu.focus();
		await userEvent.keyboard('{ArrowDown}{ArrowDown}');
		await expect(within(canvasElement).getByRole('menuitem', { name: /Copy path/ })).toHaveClass('pau-option--active');
	}
};

/** In a narrow column long hints truncate. */
export const Narrow: Story = { args: { width: '17rem' } };
