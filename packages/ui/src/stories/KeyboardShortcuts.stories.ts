import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import KeyboardShortcutsDemo from './KeyboardShortcutsDemo.svelte';

const meta = {
	title: 'Shell/Keyboard shortcuts',
	component: KeyboardShortcutsDemo,
	parameters: { layout: 'fullscreen' },
	argTypes: { platform: { control: 'inline-radio', options: ['mac', 'other'] } },
	args: { platform: 'mac', piBindings: [], open: false }
} satisfies Meta<typeof KeyboardShortcutsDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ShortcutList: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement.ownerDocument.body);

		await userEvent.keyboard('{Meta>}/{/Meta}');
		const dialog = await canvas.findByRole('dialog', { name: 'Keyboard shortcuts' });
		await waitFor(() => expect(dialog).toBeVisible());
		const newSession = within(dialog).getByText('New session').closest('li');
		await expect(newSession).toHaveTextContent('⌘N');
		await expect(within(dialog).getByText('Go to session 1 to 9').closest('li')).toHaveTextContent(/⌘1\s*to\s*⌘9/);

		await userEvent.click(within(dialog).getByRole('button', { name: 'Close keyboard shortcuts' }));
		await waitFor(() => expect(canvas.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument());
	}
};

export const YieldsToPiBinding: Story = {
	args: {
		platform: 'other',
		piBindings: [
			{ action: 'app.session.toggleNamedFilter', keys: ['ctrl+n'] },
			{ action: 'tui.editor.cursorLeft', keys: ['left', 'ctrl+b'] }
		]
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);

		await userEvent.keyboard('{Control>}n{/Control}');
		await expect(canvas.getByLabelText('Last action')).toHaveTextContent('None');

		await userEvent.click(canvas.getByRole('button', { name: 'Show keyboard shortcuts' }));
		const dialog = within(canvasElement.ownerDocument.body).getByRole('dialog', { name: 'Keyboard shortcuts' });
		await expect(dialog).toHaveTextContent('Your Pi key bindings take precedence. 2 shortcuts give way to them.');
		const newSession = within(dialog).getByText('New session').closest('li');
		await expect(newSession).toHaveTextContent('Pi uses Ctrl+N for app.session.toggleNamedFilter');
		await expect(newSession).toHaveTextContent('No shortcut');
	}
};

export const Open: Story = { args: { open: true } };
