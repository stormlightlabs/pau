import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import SettingsViewDemo from './SettingsViewDemo.svelte';

const meta = {
	title: 'Settings/Settings',
	component: SettingsViewDemo,
	parameters: { layout: 'fullscreen' }
} satisfies Meta<typeof SettingsViewDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
	parameters: { viewport: { defaultViewport: 'wide' } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('radio', { name: 'Nord' }));
		await expect(canvas.getByRole('radio', { name: 'Nord' })).toBeChecked();
		await userEvent.click(canvas.getByRole('radio', { name: 'Reduce' }));
		await expect(canvas.getByRole('radio', { name: 'Reduce' })).toBeChecked();
	}
};

export const Narrow: Story = { parameters: { viewport: { defaultViewport: 'narrow' } } };

export const SaveFailed: Story = {
	args: { saveError: 'The Pau backend returned HTTP 500.' },
	parameters: { viewport: { defaultViewport: 'wide' } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('radio', { name: 'Off' }));
		await expect(await canvas.findByRole('alert')).toHaveTextContent('The Pau backend returned HTTP 500.');
		await expect(canvas.getByRole('radio', { name: 'When a session needs you' })).toBeChecked();
	}
};

/** Pi bindings that take chords from Pau, so the Keyboard section notes them. */
export const PiBindingsTakeChords: Story = {
	args: {
		piBindings: [
			{ action: 'tui.editor.deleteToLineEnd', keys: ['cmd+k'] },
			{ action: 'app.session.toggleNamedFilter', keys: ['cmd+n'] }
		]
	},
	parameters: { viewport: { defaultViewport: 'wide' } }
};

/** A saved theme and font other than the defaults. */
export const OtherTheme: Story = {
	args: { initial: { theme: 'catppuccin-mocha', uiFont: 'atkinson-hyperlegible-next' } },
	parameters: { viewport: { defaultViewport: 'wide' } }
};
