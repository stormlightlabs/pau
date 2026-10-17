import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import { usageFixtures } from '../fixtures/usage';
import ContextMeter from '../lib/ContextMeter.svelte';

const meta = {
	title: 'Sessions/Context meter',
	component: ContextMeter,
	parameters: { layout: 'centered' },
	args: { usage: usageFixtures.normal }
} satisfies Meta<typeof ContextMeter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Normal: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('button')).toHaveTextContent('Context 84k / 200k · 42%');
		await expect(canvas.getByRole('meter')).toHaveAttribute('aria-valuenow', '42');
		await userEvent.click(canvas.getByRole('button'));
		const details = canvas.getByRole('group', { name: 'Session usage' });
		await expect(details).toHaveTextContent('Input tokens 84,210');
		await expect(details).toHaveTextContent('Cache read 410,000');
		await expect(details).toHaveTextContent('Cost $1.23');
		await expect(details).not.toHaveTextContent('context window is');
	}
};

export const NearLimit: Story = {
	args: { usage: usageFixtures.nearLimit },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('button')).toHaveTextContent('164k / 200k · 82%');
		await userEvent.click(canvas.getByRole('button'));
		await expect(canvas.getByText('The context window is filling up.')).toBeVisible();
	}
};

export const AtLimit: Story = {
	args: { usage: usageFixtures.atLimit },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('button')).toHaveTextContent('196k / 200k · 98%');
		await userEvent.click(canvas.getByRole('button'));
		await expect(canvas.getByText('The context window is almost full.')).toBeVisible();
	}
};

export const UnknownAfterCompaction: Story = {
	args: { usage: usageFixtures.unknownAfterCompaction },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('button')).toHaveTextContent('Context unknown / 200k');
		await expect(canvas.queryByRole('meter')).toBeNull();
		await userEvent.click(canvas.getByRole('button'));
		await expect(canvas.getByText('Pi measures context again after its next reply.')).toBeVisible();
	}
};

export const WithoutContextWindow: Story = {
	args: { usage: usageFixtures.noContext },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByRole('meter')).toBeNull();
		await userEvent.click(canvas.getByRole('button', { name: 'Usage' }));
		await expect(canvas.getByRole('group', { name: 'Session usage' })).toHaveTextContent('Cost $0.0042');
	}
};

export const Unsupported: Story = {
	args: { supported: false },
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).queryByRole('button')).toBeNull();
	}
};
