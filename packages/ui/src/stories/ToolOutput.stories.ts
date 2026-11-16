import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import { longCommandOutput } from '../fixtures/foundation';
import ToolOutput from '../lib/ToolOutput.svelte';

const meta = {
	title: 'Foundation/Tool output',
	component: ToolOutput,
	parameters: { layout: 'padded' },
	args: { lines: longCommandOutput, label: 'cargo test output', from: 'tail' }
} satisfies Meta<typeof ToolOutput>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A long command output, capped at its last 12 lines. */
export const Capped: Story = {
	play: async ({ canvasElement }) => {
		const output = within(canvasElement).getByLabelText('cargo test output');
		await expect(output.textContent?.split('\n')).toHaveLength(12);
		await expect(output).toHaveTextContent('test result: ok');
	}
};

/** Show all opens the whole output in a box that scrolls after 30 lines. */
export const Expanded: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Show all 193 lines' }));
		await expect(canvas.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
		await expect(canvas.getByLabelText('cargo test output').textContent?.split('\n')).toHaveLength(193);
	}
};

/** File contents keep their first 12 lines. */
export const Head: Story = { args: { from: 'head', label: 'Contents of build.log' } };

/** Short output shows in full without a bar. */
export const Short: Story = {
	args: { lines: longCommandOutput.slice(-4) },
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).queryByRole('button', { name: /Show all/ })).toBeNull();
	}
};

/** A diff colors its added and removed lines. */
export const Diff: Story = {
	args: {
		label: 'Diff for sessions.rs',
		from: 'head',
		diff: true,
		lines: [
			'-    Ok(Session::running(child))',
			'+    let ready = timeout(READY_TIMEOUT, child.wait_ready());',
			'     }'
		]
	}
};
