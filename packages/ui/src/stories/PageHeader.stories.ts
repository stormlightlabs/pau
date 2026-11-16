import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import PageHeaderDemo from './PageHeaderDemo.svelte';

const meta = {
	title: 'Foundation/Page header',
	component: PageHeaderDemo,
	parameters: { layout: 'fullscreen' }
} satisfies Meta<typeof PageHeaderDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A running session, a waiting one with a long title, and a view with one action. */
export const Rest: Story = {
	play: async ({ canvasElement }) => {
		const stop = within(canvasElement).getAllByRole('button', { name: 'Stop' })[0]!;
		await expect(stop.previousElementSibling).toHaveRole('separator');
	}
};

/** Tab reaches the actions in order and ends on Stop. */
export const Focus: Story = {
	play: async ({ canvasElement }) => {
		for (let step = 0; step < 4; step++) await userEvent.tab();
		await expect(canvasElement.ownerDocument.activeElement).toHaveAccessibleName('Stop');
	}
};

/** In a narrow main surface the title truncates and the actions keep their place. */
export const Narrow: Story = {
	args: { width: '40rem' },
	play: async ({ canvasElement }) => {
		const header = canvasElement.querySelector<HTMLElement>('[data-header="long"]')!;
		const title = header.querySelector<HTMLElement>(':scope > .pau-page-header__title')!;
		await expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);
	}
};
