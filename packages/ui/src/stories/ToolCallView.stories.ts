import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import { toolCallFixtures } from '../fixtures/tool-calls';
import ToolCallViewDemo from './ToolCallViewDemo.svelte';

const meta = {
	title: 'Sessions/Tool call view',
	component: ToolCallViewDemo,
	parameters: { layout: 'fullscreen' },
	args: { tools: [toolCallFixtures.bashComplete] }
} satisfies Meta<typeof ToolCallViewDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Bash: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByLabelText('Command')).toHaveTextContent('$ git status --short');
		await expect(canvas.getByLabelText('Command output')).toHaveTextContent('M src/diff/gutter.ts');
		await expect(canvas.getByText('Exit 0')).toBeInTheDocument();
		await expect(canvas.getByText('84 ms')).toBeInTheDocument();
	}
};

export const BashRunning: Story = {
	args: { tools: [toolCallFixtures.bashRunning] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText('In progress')).toBeInTheDocument();
		await expect(canvas.getByLabelText('Command output')).toHaveTextContent('gutter.test.ts');
		await expect(canvas.queryByText(/^Exit/)).not.toBeInTheDocument();
	}
};

export const BashFailed: Story = {
	args: { tools: [toolCallFixtures.bashFailed] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText('Failed')).toBeInTheDocument();
		await expect(canvas.getByText('Exit 101')).toBeInTheDocument();
		await expect(canvas.getByText('12.4 s')).toBeInTheDocument();
	}
};

export const BashTruncated: Story = {
	args: { tools: [toolCallFixtures.bashTruncated] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const output = canvas.getByLabelText('Command output');
		await expect(canvas.getByText(/Pi kept the last 1200 of 4800 lines/)).toBeInTheDocument();
		await expect(canvas.getByText('/tmp/pi-bash-7f3a.log')).toBeInTheDocument();
		await expect(output).toHaveTextContent('test 1200 ... ok');
		await expect(output).not.toHaveTextContent('test 1000 ... ok');
		await userEvent.click(canvas.getByRole('button', { name: 'Show 200 earlier lines' }));
		await expect(canvas.getByLabelText('Command output')).toHaveTextContent('test 801 ... ok');
	}
};

export const Read: Story = {
	args: { tools: [toolCallFixtures.read, toolCallFixtures.readTruncated] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText('lines 10–14', { exact: false })).toBeInTheDocument();
		await expect(canvas.getByLabelText('Contents of src/diff/gutter.ts')).toHaveTextContent('gutterRows');
		await expect(canvas.getByText(/Pi kept the first 450 of 3000 lines because of the size limit/)).toBeInTheDocument();
		await expect(canvas.getByRole('button', { name: 'Show 200 more lines' })).toBeInTheDocument();
	}
};

export const Edit: Story = {
	args: { tools: [toolCallFixtures.edit] },
	play: async ({ canvasElement }) => {
		const diff = within(within(canvasElement).getByLabelText('Diff for README.md'));
		await expect(diff.getByText('-2 Old intro')).toHaveClass('tool-output__line--removed');
		await expect(diff.getByText('+2 New intro')).toHaveClass('tool-output__line--added');
	}
};

export const EditRunning: Story = {
	args: { tools: [toolCallFixtures.editRunning] },
	play: async ({ canvasElement }) => {
		const edits = within(within(canvasElement).getByLabelText('Requested edits for src/diff/gutter.ts'));
		await expect(edits.getByText('+return visualLineOffsets(view);')).toBeInTheDocument();
	}
};

export const EditFailed: Story = {
	args: { tools: [toolCallFixtures.editFailed] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByLabelText('Error')).toHaveTextContent('Could not find the exact text');
	}
};

export const Write: Story = {
	args: { tools: [toolCallFixtures.write] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByLabelText('New contents of src/diff/wrap.test.ts')).toHaveTextContent('wraps folded');
	}
};

export const ExtensionTool: Story = {
	args: { tools: [toolCallFixtures.extension] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText('{"action":"add","text":"Cover folded ranges"}')).toBeInTheDocument();
		await expect(canvas.getByLabelText('todo output')).toHaveTextContent('Added todo #3');
	}
};

export const Collapsed: Story = {
	args: { tools: Object.values(toolCallFixtures), initiallyOpen: false },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText('+1 −1')).toBeVisible();
		await expect(canvas.queryByText('Complete')).not.toBeInTheDocument();
		await expect(canvas.queryByLabelText('Diff for README.md')).not.toBeInTheDocument();
		await userEvent.click(canvas.getByText('README.md'));
		await expect(canvas.getByLabelText('Diff for README.md')).toBeInTheDocument();
	}
};
