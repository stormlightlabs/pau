import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import FieldsDemo from './FieldsDemo.svelte';

const meta = { title: 'Foundation/Fields', component: FieldsDemo, parameters: { layout: 'fullscreen' } } satisfies Meta<
	typeof FieldsDemo
>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Text fields, select triggers and choices at rest, invalid, disabled and long. */
export const Rest: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('textbox', { name: 'Custom editor command' })).toHaveAttribute(
			'aria-invalid',
			'true'
		);
		await expect(canvas.getByRole('textbox', { name: 'Workspace path, disabled' })).toBeDisabled();
	}
};

/** Focus on the input inside a wrapper draws the ring around the whole field. */
export const Focus: Story = {
	play: async ({ canvasElement }) => {
		const input = within(canvasElement).getByRole('textbox', { name: 'Filter sessions' });
		await userEvent.click(input);
		await userEvent.keyboard('audit');
		await expect(getComputedStyle(input.closest('.pau-field')!).outlineWidth).toBe('2px');
	}
};

/** The select opens its list from the keyboard; a checkbox toggles from its label. */
export const Keyboard: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const trigger = canvas.getByRole('combobox', { name: 'Thinking level' });
		trigger.focus();
		await userEvent.keyboard('{Enter}');
		await expect(trigger).toHaveAttribute('aria-expanded', 'true');
		await userEvent.keyboard('{Escape}');
		await expect(trigger).toHaveAttribute('aria-expanded', 'false');
		await expect(trigger).toHaveFocus();
		const hidden = canvas.getByRole('checkbox', { name: 'Show hidden files' });
		await userEvent.click(canvas.getByText('Show hidden files'));
		await expect(hidden).toBeChecked();
	}
};

/** An invalid field draws its border in the danger color. */
export const Error: Story = {
	play: async ({ canvasElement }) => {
		const field = within(canvasElement).getByRole('textbox', { name: 'Custom editor command' });
		const valid = within(canvasElement).getByRole('textbox', { name: 'Workspace path' });
		await expect(getComputedStyle(field).borderTopColor).not.toBe(getComputedStyle(valid).borderTopColor);
	}
};

/** Disabled controls ignore hover and say so to assistive technology. */
export const Disabled: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('checkbox', { name: 'Show ignored files' })).toBeDisabled();
		await expect(canvas.getByRole('combobox', { name: 'Thinking level, disabled' })).toBeDisabled();
	}
};

/** In a narrow container fields shrink and long values stay on one line. */
export const Narrow: Story = { args: { width: '18rem' } };
