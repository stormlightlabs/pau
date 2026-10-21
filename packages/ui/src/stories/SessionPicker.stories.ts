import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { savedSessionFixtures, savedSessionsNow } from '../fixtures/saved-sessions';
import SessionPicker from '../lib/SessionPicker.svelte';

const meta = {
	title: 'Sessions/Session picker',
	component: SessionPicker,
	parameters: { layout: 'fullscreen' },
	args: {
		workspaceName: 'Pau',
		now: savedSessionsNow,
		load: async () => savedSessionFixtures.populated,
		onNew: fn(),
		onResume: fn()
	}
} satisfies Meta<typeof SessionPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
	args: { load: async () => savedSessionFixtures.empty },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText(/Saved Pi sessions in this workspace appear here/)).toBeInTheDocument();
		await expect(canvas.getByRole('button', { name: 'New session' })).toBeEnabled();
	}
};

export const Populated: Story = {
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText('Review the sandbox policy')).toBeInTheDocument();
		await expect(canvas.getByText('Modified 3 hours ago')).toBeInTheDocument();
		await expect(canvas.getByText('Modified 2 days ago')).toBeInTheDocument();
		await userEvent.click(canvas.getByRole('button', { name: 'Resume Fix the flaky terminal test' }));
		await expect(args.onResume).toHaveBeenCalledWith('native-2');
	}
};

export const Loading: Story = {
	args: { load: () => new Promise(() => {}) },
	play: async ({ canvasElement }) => {
		await expect(await within(canvasElement).findByRole('status')).toHaveTextContent('Loading saved sessions…');
	}
};

export const Warnings: Story = {
	args: { load: async () => savedSessionFixtures.withWarnings },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByText('1 file was skipped'));
		await expect(canvas.getByText(/session header is not valid JSON/)).toBeVisible();
	}
};

export const LoadFailed: Story = {
	args: {
		load: async () => {
			throw new Error('Pau could not reach its backend. Check that the desktop app is still running, then try again.');
		}
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByRole('alert')).toHaveTextContent(/could not reach its backend/);
		await expect(canvas.getByRole('button', { name: 'Try again' })).toBeEnabled();
	}
};

export const FailedResume: Story = {
	args: {
		onResume: async () => {
			throw new Error(
				'Pi no longer has that session. It may have been deleted. Pick another session or start a new one.'
			);
		}
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByRole('button', { name: 'Resume Review the sandbox policy' }));
		await expect(await canvas.findByRole('alert')).toHaveTextContent(/no longer has that session/);
		await expect(canvas.getByRole('button', { name: 'Resume Review the sandbox policy' })).toBeEnabled();
	}
};
