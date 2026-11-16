import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import CommandPaletteDemo from './CommandPaletteDemo.svelte';

const meta = {
	title: 'Shell/Command palette',
	component: CommandPaletteDemo,
	parameters: { layout: 'fullscreen' },
	argTypes: { platform: { control: 'inline-radio', options: ['mac', 'other'] } },
	args: { platform: 'mac', piBindings: [] }
} satisfies Meta<typeof CommandPaletteDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RunFromKeyboard: Story = {
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);

		await userEvent.keyboard('{Meta>}k{/Meta}');
		const palette = await body.findByRole('dialog', { name: 'Command palette' });
		const search = within(palette).getByRole('combobox', { name: 'Search or run a command' });
		await waitFor(() => expect(search).toHaveFocus());

		await userEvent.keyboard('nwses');
		await expect(within(palette).getAllByRole('option')).toHaveLength(1);
		await expect(within(palette).getByRole('option', { name: /New session/ })).toHaveTextContent('⌘N');

		await userEvent.keyboard('{Enter}');
		await waitFor(() => expect(body.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument());
		await expect(within(canvasElement).getByLabelText('Last action')).toHaveTextContent('New session');
	}
};
