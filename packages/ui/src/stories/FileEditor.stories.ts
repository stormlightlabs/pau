import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import FileEditorDemo from './FileEditorDemo.svelte';

const meta = {
	title: 'Workspaces/CodeMirror editor',
	component: FileEditorDemo,
	parameters: { layout: 'fullscreen' },
	args: { state: 'default' }
} satisfies Meta<typeof FileEditorDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Editable: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const editor = await canvas.findByRole('textbox');
		await userEvent.click(editor);
		await userEvent.keyboard('{End} // changed');
		await expect(await canvas.findByText('Unsaved changes')).toBeInTheDocument();
		await userEvent.click(canvas.getByRole('button', { name: 'Revert' }));
		await expect(canvas.queryByText('Unsaved changes')).not.toBeInTheDocument();
	}
};

export const ExternalChange: Story = {
	args: { state: 'external-change' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByRole('textbox');
		await userEvent.click(canvas.getByRole('button', { name: 'Check for changes' }));
		await expect(await canvas.findByText('File changed on disk')).toBeInTheDocument();
	}
};

export const ReadOnly: Story = { args: { state: 'read-only' } };
export const Binary: Story = { args: { state: 'binary' } };
export const Oversized: Story = { args: { state: 'oversized' } };
export const InvalidEncoding: Story = { args: { state: 'invalid-encoding' } };
export const Narrow: Story = { parameters: { viewport: { defaultViewport: 'narrow' } } };
