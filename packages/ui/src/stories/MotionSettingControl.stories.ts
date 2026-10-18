import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import MotionSettingControl from '../lib/MotionSettingControl.svelte';

const meta = {
	title: 'Settings/Motion setting',
	component: MotionSettingControl,
	parameters: { layout: 'centered' },
	args: { value: 'system', onChange: fn() }
} satisfies Meta<typeof MotionSettingControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const System: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('radio', { name: 'System' })).toBeChecked();
		await expect(canvas.getByRole('radio', { name: 'Reduce' })).not.toBeChecked();
	}
};

export const Reduce: Story = {
	args: { value: 'reduce' },
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByRole('radio', { name: 'Reduce' })).toBeChecked();
	}
};

export const Full: Story = {
	args: { value: 'full' },
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByRole('radio', { name: 'Full' })).toBeChecked();
	}
};

export const ChangeSetting: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('group', { name: 'Motion' })).toBeVisible();
		await userEvent.click(canvas.getByRole('radio', { name: 'Reduce' }));
		await expect(args.onChange).toHaveBeenCalledWith('reduce');
	}
};
