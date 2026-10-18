import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import TerminalSurfaceDemo from './TerminalSurfaceDemo.svelte';

const meta = {
	title: 'Workspaces/Terminal',
	component: TerminalSurfaceDemo,
	parameters: { layout: 'fullscreen' },
	argTypes: {
		theme: { control: 'select', options: ['eldritch', 'nord', 'iceberg', 'catppuccin-mocha', 'vitesse-dark'] }
	},
	args: { disconnected: false }
} satisfies Meta<typeof TerminalSurfaceDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

const openTerminal: Story['play'] = async ({ canvasElement }) => {
	const canvas = within(canvasElement);
	await userEvent.click(canvas.getByRole('button', { name: 'Open a terminal' }));
	await expect(await canvas.findByRole('tab', { name: 'zsh' })).toHaveAttribute('aria-selected', 'true');
};

export const Empty: Story = {};

export const Running: Story = { play: openTerminal };

export const Tabs: Story = {
	play: async (context) => {
		await openTerminal(context);
		const canvas = within(context.canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'New terminal' }));
		await expect(await canvas.findByRole('tab', { name: 'zsh 2' })).toHaveAttribute('aria-selected', 'true');
		await userEvent.click(canvas.getByRole('tab', { name: 'zsh' }));
		await expect(canvas.getByRole('tab', { name: 'zsh' })).toHaveAttribute('aria-selected', 'true');
	}
};

export const Exited: Story = {
	args: { exitOnConnect: { exitCode: 1, signal: null } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Open a terminal' }));
		await expect(await canvas.findByText('The process exited with code 1.')).toBeInTheDocument();
	}
};

export const EndedBySignal: Story = {
	args: { exitOnConnect: { exitCode: 1, signal: 'SIGHUP' } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Open a terminal' }));
		await expect(await canvas.findByText('The process ended with SIGHUP.')).toBeInTheDocument();
	}
};

export const OpenFailed: Story = {
	args: { createError: 'The workspace directory no longer exists.' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Open a terminal' }));
		await expect(await canvas.findByRole('alert')).toHaveTextContent('Could not open a terminal.');
	}
};

export const Disconnected: Story = { args: { disconnected: true } };

export const Nord: Story = { args: { theme: 'nord' }, play: openTerminal };

export const Iceberg: Story = { args: { theme: 'iceberg' }, play: openTerminal };

export const CatppuccinMocha: Story = { args: { theme: 'catppuccin-mocha' }, play: openTerminal };

export const VitesseDark: Story = { args: { theme: 'vitesse-dark' }, play: openTerminal };
