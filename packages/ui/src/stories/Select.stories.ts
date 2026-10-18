import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import Select, { type SelectOption } from '../lib/Select.svelte';

const options: SelectOption[] = [
	{ value: 'debug', label: 'Debug', description: 'Every event, including payload sizes' },
	{ value: 'info', label: 'Info' },
	{ value: 'warn', label: 'Warning' },
	{ value: 'error', label: 'Error' },
	{ value: 'trace', label: 'Trace', disabled: true, disabledReason: 'Start payload tracing to record traces.' }
];

const meta = {
	title: 'Controls/Select',
	component: Select,
	parameters: { layout: 'centered' },
	args: { label: 'Log level', options, value: 'info', onChange: fn() }
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {
	play: async ({ canvasElement }) => {
		const select = within(canvasElement).getByRole('combobox', { name: 'Log level' });
		await expect(select).toHaveTextContent('Info');
		await expect(select).toHaveAttribute('aria-expanded', 'false');
	}
};

export const Open: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('combobox', { name: 'Log level' }));
		await expect(await canvas.findByRole('option', { name: 'Info' })).toHaveAttribute('aria-selected', 'true');
		await expect(canvas.getByRole('option', { name: 'Trace' })).toHaveAccessibleDescription(
			'Start payload tracing to record traces.'
		);
	}
};

export const KeyboardAndTypeahead: Story = {
	play: async ({ canvasElement, args }) => {
		const select = within(canvasElement).getByRole('combobox', { name: 'Log level' });
		select.focus();
		await userEvent.keyboard('w');
		await expect(select).toHaveAttribute('aria-expanded', 'true');
		await userEvent.keyboard('{Enter}');
		await expect(args.onChange).toHaveBeenCalledWith('warn');
		await expect(select).toHaveFocus();
	}
};

export const Placeholder: Story = {
	args: { value: undefined, placeholder: 'Choose a level' },
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByRole('combobox', { name: 'Log level' })).toHaveTextContent(
			'Choose a level'
		);
	}
};

export const Disabled: Story = {
	args: { disabled: true, disabledReason: 'Turn on diagnostics to choose a level.' },
	play: async ({ canvasElement }) => {
		const select = within(canvasElement).getByRole('combobox', { name: 'Log level' });
		await expect(select).toBeDisabled();
		await expect(select).toHaveAccessibleDescription('Turn on diagnostics to choose a level.');
	}
};

export const Quiet: Story = { args: { variant: 'quiet' } };

export const Rejected: Story = {
	args: {
		onChange: async () => {
			throw new Error('Pau could not save the log level.');
		}
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const select = canvas.getByRole('combobox', { name: 'Log level' });
		await userEvent.click(select);
		await userEvent.click(await canvas.findByRole('option', { name: 'Error' }));
		await expect(await canvas.findByRole('alert')).toHaveTextContent('Pau could not save the log level.');
		await expect(select).toHaveTextContent('Info');
	}
};
