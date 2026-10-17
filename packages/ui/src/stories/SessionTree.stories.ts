import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { sessionTreeFixtures } from '../fixtures/session-tree';
import SessionTree from '../lib/SessionTree.svelte';

const meta = {
	title: 'Sessions/Session tree',
	component: SessionTree,
	parameters: { layout: 'padded' },
	args: {
		agent: 'Pi',
		supported: true,
		load: async () => sessionTreeFixtures.small,
		onBranch: fn(async () => ({ text: 'Move the resize after the socket opens', cancelled: false })),
		onBranched: fn()
	}
} satisfies Meta<typeof SessionTree>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Small: Story = {
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		const tree = await canvas.findByRole('tree', { name: 'Session entries' });
		await expect(within(tree).getByText('Current', { exact: true })).toBeInTheDocument();
		await userEvent.click(within(tree).getByText('Move the resize after the socket opens'));
		await expect(canvas.getByText(/can branch only from messages on the current branch/)).toBeInTheDocument();
		await userEvent.click(within(tree).getByText('Queue resizes until the socket opens instead'));
		await userEvent.click(canvas.getByRole('button', { name: 'Branch from here' }));
		await expect(args.onBranch).toHaveBeenCalledWith('u3');
		await waitFor(() => expect(args.onBranched).toHaveBeenCalledWith('Move the resize after the socket opens'));
	}
};

export const LargeBranched: Story = {
	args: { load: async () => sessionTreeFixtures.large },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const tree = await canvas.findByRole('tree', { name: 'Session entries' });
		await expect(canvas.getByText('4,285 entries')).toBeInTheDocument();
		await expect(within(tree).getAllByRole('treeitem').length).toBeLessThan(80);
		await userEvent.click(within(tree).getByText('Current', { exact: true }));
		await userEvent.keyboard('{Home}');
		await expect(tree.querySelector('[role="treeitem"]:focus')).toHaveAttribute('aria-posinset', '1');
	}
};

export const Truncated: Story = {
	args: { load: async () => sessionTreeFixtures.truncated },
	play: async ({ canvasElement }) => {
		await expect(
			await within(canvasElement).findByText('Showing the newest 5,000 entries. Older entries are not listed.')
		).toBeInTheDocument();
	}
};

export const Empty: Story = {
	args: { load: async () => sessionTreeFixtures.empty },
	play: async ({ canvasElement }) => {
		await expect(await within(canvasElement).findByText(/No entries yet/)).toBeInTheDocument();
	}
};

export const Unsupported: Story = {
	args: { agent: 'Claude', supported: false, load: fn(async () => sessionTreeFixtures.small) },
	play: async ({ args, canvasElement }) => {
		await expect(within(canvasElement).getByText(/Claude sessions do not support branching/)).toBeInTheDocument();
		await expect(args.load).not.toHaveBeenCalled();
	}
};

export const BranchPending: Story = {
	args: { onBranch: fn(() => new Promise<never>(() => {})) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const tree = await canvas.findByRole('tree', { name: 'Session entries' });
		await userEvent.click(within(tree).getByText('Run the terminal tests again'));
		await userEvent.click(canvas.getByRole('button', { name: 'Branch from here' }));
		await expect(canvas.getByRole('button', { name: 'Branching…' })).toBeDisabled();
	}
};

export const BranchRejected: Story = {
	args: {
		onBranch: fn(async () => {
			throw new Error('Pi could not branch from that message: entry not found');
		})
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const tree = await canvas.findByRole('tree', { name: 'Session entries' });
		await userEvent.click(within(tree).getByText('Run the terminal tests again'));
		await userEvent.click(canvas.getByRole('button', { name: 'Branch from here' }));
		await expect(await canvas.findByRole('alert')).toHaveTextContent('entry not found');
	}
};

export const WaitingForRun: Story = {
	args: { branchUnavailable: 'Wait for Pi to finish before branching.' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const tree = await canvas.findByRole('tree', { name: 'Session entries' });
		await userEvent.click(within(tree).getByText('Run the terminal tests again'));
		await expect(canvas.getByRole('button', { name: 'Branch from here' })).toBeDisabled();
		await expect(canvas.getByText('Wait for Pi to finish before branching.')).toBeInTheDocument();
	}
};
