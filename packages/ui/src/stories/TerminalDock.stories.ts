import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import TerminalDockDemo from './TerminalDockDemo.svelte';

const meta = {
	title: 'Workspaces/Terminal dock',
	component: TerminalDockDemo,
	parameters: { layout: 'fullscreen' },
	argTypes: {
		theme: { control: 'select', options: ['eldritch', 'nord', 'iceberg', 'catppuccin-mocha', 'vitesse-dark'] }
	},
	args: { open: false, running: 2 }
} satisfies Meta<typeof TerminalDockDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Show terminal dock' }));
		await expect(await canvas.findByRole('region', { name: 'Terminal dock' })).toBeInTheDocument();
	}
};

export const Open: Story = {
	args: { open: true, history: ['$ pnpm test', ' ✓ src/tests/terminal-links.test.ts (24 tests)'] }
};

export const Narrow: Story = { args: { open: true }, parameters: { viewport: { defaultViewport: 'narrow' } } };
