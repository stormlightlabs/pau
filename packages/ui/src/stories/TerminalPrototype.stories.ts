import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import TerminalPrototypeDemo from './TerminalPrototypeDemo.svelte';

const meta = {
	title: 'Prototypes/Terminal',
	component: TerminalPrototypeDemo,
	tags: ['autodocs'],
	parameters: { layout: 'fullscreen' }
} satisfies Meta<typeof TerminalPrototypeDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Fixture: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Replay fixture' }));
		await expect(canvas.getByRole('status')).toHaveTextContent('Fixture replayed');
	}
};

export const LivePty: Story = {
	args: { endpoint: 'ws://127.0.0.1:3908/terminal' },
	parameters: {
		docs: {
			description: { story: 'Run `cargo run -p pau-term --example terminal_prototype` before opening this story.' }
		}
	}
};
