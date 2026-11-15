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

export const Sandboxed: Story = {
	args: { sandbox: { profile: 'workspace-write', unavailable: null } },
	play: async (context) => {
		await openTerminal(context);
		const canvas = within(context.canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'New sandboxed terminal (Workspace write)' }));
		await expect(await canvas.findByRole('tab', { name: /^zsh 2.*workspace write$/ })).toHaveAttribute(
			'aria-selected',
			'true'
		);
	}
};

export const SandboxUnavailable: Story = {
	args: {
		sandbox: { profile: 'workspace-write', unavailable: "sandbox-runtime's srt command was not found on PATH." }
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('button', { name: 'New sandboxed terminal (Workspace write)' })).toBeDisabled();
	}
};

export const SandboxRelayFailed: Story = {
	args: {
		sandbox: { profile: 'read-only', unavailable: null },
		sandboxError: 'The terminal relay exited before it started.'
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const button = canvas.getByRole('button', { name: 'New sandboxed terminal (Read only)' });
		await userEvent.click(button);
		await expect(await canvas.findByRole('alert')).toHaveTextContent('The terminal relay exited before it started.');
		await expect(button).toBeDisabled();
	}
};

export const Find: Story = {
	args: {
		history: [
			'error: could not compile `pau-core`',
			...Array.from({ length: 120 }, (_, index) => `   Compiling crate-${index + 1} v0.1.0`),
			'error: could not compile `pau-server`'
		]
	},
	play: async (context) => {
		await openTerminal(context);
		const canvas = within(context.canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Find in terminal' }));
		await userEvent.keyboard('error:');
		const bar = within(await canvas.findByRole('search', { name: 'Find in terminal' }));
		await expect(await bar.findByText('1 of 2')).toBeInTheDocument();
	}
};

export const FindNoMatches: Story = {
	play: async (context) => {
		await openTerminal(context);
		const canvas = within(context.canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Find in terminal' }));
		await userEvent.keyboard('warning');
		const bar = within(await canvas.findByRole('search', { name: 'Find in terminal' }));
		await expect(await bar.findByText('No matches')).toBeInTheDocument();
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

export const Reattached: Story = {
	args: { running: 3 },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByRole('tab', { name: 'zsh' })).toHaveAttribute('aria-selected', 'true');
		// The background tabs printed their ready line after reattaching, so they show new output.
		await expect(await canvas.findByRole('tab', { name: 'zsh 3 New output' })).toBeInTheDocument();
	}
};

export const Links: Story = {
	args: {
		history: [
			'   Compiling pau-term v0.1.0',
			'error[E0308]: mismatched types',
			'  --> crates/term/src/modes.rs:48:9',
			'   = help: see https://doc.rust-lang.org/error_codes/E0308.html',
			'note: v1.2.3 of src/missing.rs is not a link'
		],
		linkedFiles: ['crates/term/src/modes.rs']
	},
	play: openTerminal
};

export const ReattachFailed: Story = {
	args: { listError: 'The server stopped responding.' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByRole('alert')).toHaveTextContent('Could not reopen your terminals.');
	}
};

export const Disconnected: Story = { args: { disconnected: true } };

export const Nord: Story = { args: { theme: 'nord' }, play: openTerminal };

export const Iceberg: Story = { args: { theme: 'iceberg' }, play: openTerminal };

export const CatppuccinMocha: Story = { args: { theme: 'catppuccin-mocha' }, play: openTerminal };

export const VitesseDark: Story = { args: { theme: 'vitesse-dark' }, play: openTerminal };
