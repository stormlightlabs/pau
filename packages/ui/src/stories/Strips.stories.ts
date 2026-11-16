import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent } from 'storybook/test';

import StripsDemo from './StripsDemo.svelte';

const meta = { title: 'Foundation/Strips', component: StripsDemo, parameters: { layout: 'fullscreen' } } satisfies Meta<
	typeof StripsDemo
>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A full bay: Needs you, Running and Settled, then changed files as row strips. */
export const Bay: Story = {};

/** Focus draws the ring inside the strip, which runs edge to edge. */
export const Focus: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.tab();
		const focused = canvasElement.ownerDocument.activeElement!;
		await expect(focused).toHaveClass('pau-strip');
		await expect(getComputedStyle(focused).outlineOffset).toBe('-2px');
	}
};

/** The narrow bay is 288px; long names and state lines truncate. */
export const Narrow: Story = { args: { width: 'var(--pau-size-bay-narrow)' } };
