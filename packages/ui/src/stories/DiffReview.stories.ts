import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import DiffReview from '../lib/DiffReview.svelte';
import type { WorkspaceGitDiff } from '../lib/types/workspace-files';

const textDiff: WorkspaceGitDiff = {
	path: 'src/review-example.ts',
	previous_path: null,
	old_content: [
		"const title = 'Review';",
		'const removed = true;',
		...Array.from({ length: 9 }, (_, index) => `const context${index} = ${index};`),
		"const replacement = 'before';",
		...Array.from({ length: 9 }, (_, index) => `const later${index} = ${index};`),
		"const longLine = 'This deleted line stays on one line until the reviewer enables wrapping for long diff content.';"
	].join('\n'),
	new_content: [
		"const title = 'Diff review';",
		'const added = true;',
		'const anotherAddition = true;',
		...Array.from({ length: 9 }, (_, index) => `const context${index} = ${index};`),
		"const replacement = 'after';",
		...Array.from({ length: 9 }, (_, index) => `const later${index} = ${index};`),
		"const longLine = 'This added line can wrap so every part remains visible without horizontal scrolling in narrow review layouts.';"
	].join('\n'),
	binary: false,
	too_large: false
};

const meta = {
	title: 'Workspaces/Diff review',
	component: DiffReview,
	parameters: { layout: 'fullscreen' },
	args: { diff: textDiff }
} satisfies Meta<typeof DiffReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FileDiff: Story = {};

export const HunkReview: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Hunk' }));
		await expect(canvas.getByText(/Hunk 1 of/)).toBeInTheDocument();
		await userEvent.click(canvas.getByRole('button', { name: 'Mark reviewed' }));
		await expect(canvas.getByRole('button', { name: 'Reviewed' })).toHaveAttribute('aria-pressed', 'true');
	}
};

export const WrappedLines: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('checkbox', { name: 'Wrap lines' }));
		await expect(canvas.getByRole('checkbox', { name: 'Wrap lines' })).toBeChecked();
	}
};

export const BinaryFile: Story = {
	args: {
		diff: {
			path: 'assets/screenshot.png',
			previous_path: null,
			old_content: null,
			new_content: null,
			binary: true,
			too_large: false
		}
	}
};
