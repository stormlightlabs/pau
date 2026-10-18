import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { createRawSnippet } from 'svelte';
import { expect, within } from 'storybook/test';

import { launchFixtures } from '../fixtures/launch';
import LaunchSplash from '../lib/LaunchSplash.svelte';

const meta = {
	title: 'Launch/Launch splash',
	component: LaunchSplash,
	parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'wide' } },
	args: { phase: 'running', steps: launchFixtures.starting }
} satisfies Meta<typeof LaunchSplash>;

export default meta;
type Story = StoryObj<typeof meta>;

const narrow = { layout: 'fullscreen', viewport: { defaultViewport: 'narrow' } };

export const Starting: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent('Opening the database');
		await expect(canvas.getByText('Launch 2 / 4')).toBeVisible();
	}
};

export const StartingService: Story = { args: { steps: launchFixtures.service } };

export const CheckingPi: Story = { args: { steps: launchFixtures.checking } };

export const SlowShellPath: Story = {
	args: { steps: launchFixtures.slowPath },
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByText('Needs attention')).toBeVisible();
	}
};

export const NewerDatabase: Story = {
	args: { phase: 'failed', steps: launchFixtures.newerDatabase },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent('Pau could not start');
		await expect(canvas.getByRole('alert')).toHaveTextContent('Install that version to open it.');
		await expect(canvas.getByRole('button', { name: 'Copy details' })).toBeVisible();
	}
};

export const ServiceFailed: Story = { args: { phase: 'failed', steps: launchFixtures.backendFailure } };

export const Ready: Story = {
	args: {
		phase: 'ready',
		steps: launchFixtures.ready,
		children: createRawSnippet(() => ({ render: () => '<p>The workspace renders here.</p>' }))
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText('The workspace renders here.')).toBeVisible();
		await expect(canvas.queryByRole('main')).toBeNull();
	}
};

export const StartingNarrow: Story = { parameters: narrow };

export const CheckingPiNarrow: Story = { args: { steps: launchFixtures.checking }, parameters: narrow };

export const SlowShellPathNarrow: Story = { args: { steps: launchFixtures.slowPath }, parameters: narrow };

export const NewerDatabaseNarrow: Story = {
	args: { phase: 'failed', steps: launchFixtures.newerDatabase },
	parameters: narrow
};

export const ServiceFailedNarrow: Story = {
	args: { phase: 'failed', steps: launchFixtures.backendFailure },
	parameters: narrow
};
