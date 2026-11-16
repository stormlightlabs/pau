import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, within } from 'storybook/test';

import { markStates } from '../fixtures/foundation';
import ChipsDemo from './ChipsDemo.svelte';

const meta = {
	title: 'Foundation/Chips and marks',
	component: ChipsDemo,
	parameters: { layout: 'fullscreen' }
} satisfies Meta<typeof ChipsDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every status mark beside its label, neutral chips and key caps. */
export const Rest: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		for (const { label } of markStates) {
			await expect(canvas.getByRole('img', { name: label })).toBeInTheDocument();
		}
	}
};

/** The running mark holds still as a full ring under reduced motion. */
export const ReducedMotion: Story = {
	globals: { reducedMotion: 'on' },
	play: async ({ canvasElement }) => {
		const mark = within(canvasElement).getByRole('img', { name: 'Running' });
		await expect(getComputedStyle(mark).animationName).toBe('none');
	}
};

/** A long chip truncates on one line in a narrow container. */
export const Narrow: Story = { args: { width: '16rem' } };
