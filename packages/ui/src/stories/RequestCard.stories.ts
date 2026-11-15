import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import RequestCardDemo from './RequestCardDemo.svelte';

const meta = {
	title: 'Foundation/Request card',
	component: RequestCardDemo,
	parameters: { layout: 'fullscreen' }
} satisfies Meta<typeof RequestCardDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A permission request with Allow once as the primary. */
export const Rest: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('heading', { name: /Allow write to/ })).toBeInTheDocument();
		await expect(canvasElement.querySelectorAll('.pau-button--primary')).toHaveLength(1);
	}
};

/** Focus starts on Allow once; Enter answers it. */
export const Focus: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.tab();
		await expect(canvasElement.ownerDocument.activeElement).toHaveAccessibleName('Allow once Y');
		await userEvent.keyboard('{Enter}');
		await expect(within(canvasElement).getByText('Allow once sent')).toBeInTheDocument();
	}
};

/** While Pau reconnects the card stays and its actions disable with a reason. */
export const Disabled: Story = {
	args: { reconnecting: true },
	play: async ({ canvasElement }) => {
		const allow = within(canvasElement).getByRole('button', { name: /Allow once/ });
		await expect(allow).toBeDisabled();
		await expect(allow).toHaveAccessibleDescription('Reconnecting to Pau…');
	}
};

/** A long path wraps inside the question and the body hangs from its edge. */
export const LongContent: Story = {
	args: { path: 'packages/ui/src/lib/resource-browser/scope-picker/ScopePickerOption.svelte' }
};

/** In a narrow column the actions wrap. */
export const Narrow: Story = { args: { width: '24rem' } };
