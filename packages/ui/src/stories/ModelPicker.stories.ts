import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { modelFixtures } from '../fixtures/models';
import ModelPicker from '../lib/ModelPicker.svelte';

const meta = {
	title: 'Sessions/Model picker',
	component: ModelPicker,
	parameters: { layout: 'centered' },
	args: { load: async () => modelFixtures.populated, onSelect: fn() }
} satisfies Meta<typeof ModelPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CurrentModel: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByRole('button', { name: 'Model: Claude Sonnet 4.5' })).toBeEnabled();
	}
};

export const OpenList: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByRole('button', { name: 'Model: Claude Sonnet 4.5' }));
		await expect(canvas.getByRole('button', { name: /Claude Haiku 4.5/ })).toBeEnabled();
		await expect(canvas.getByRole('button', { name: /gpt-5.*Reasoning/ })).toBeEnabled();
		const current = canvas.getByRole('button', { name: /^anthropic Claude Sonnet 4.5/ });
		await expect(current).toHaveAttribute('aria-current', 'true');
		// The list fades in after a pointer open.
		await waitFor(() => expect(current.querySelector('.model-picker__check')).toBeVisible());
	}
};

export const FullList: Story = {
	args: { load: async () => modelFixtures.full },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const trigger = await canvas.findByRole('button', { name: 'Model: Claude Sonnet 4.5' });
		await userEvent.click(trigger);
		const list = canvas.getByRole('group', { name: 'Models' });
		// The list scrolls inside its cap instead of growing past the window.
		await expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
		await userEvent.click(document.body);
		await waitFor(() => expect(canvas.queryByRole('group', { name: 'Models' })).toBeNull());
		await expect(trigger).toHaveAttribute('aria-expanded', 'false');
	}
};

export const SelectionPending: Story = {
	args: { onSelect: () => new Promise<void>(() => {}) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByRole('button', { name: 'Model: Claude Sonnet 4.5' }));
		await userEvent.click(canvas.getByRole('button', { name: /Claude Haiku 4.5/ }));
		await expect(canvas.getByRole('button', { name: 'Model: Claude Sonnet 4.5' })).toHaveTextContent('Switching…');
		await expect(canvas.getByRole('button', { name: /gpt-5/ })).toBeDisabled();
	}
};

export const Rejected: Story = {
	args: {
		onSelect: async () => {
			throw new Error('Pi rejected the request: Model not found');
		}
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByRole('button', { name: 'Model: Claude Sonnet 4.5' }));
		await userEvent.click(canvas.getByRole('button', { name: /gpt-5/ }));
		await expect(await canvas.findByRole('alert')).toHaveTextContent('Pi rejected the request: Model not found');
		await expect(canvas.getByRole('button', { name: /gpt-5/ })).toBeEnabled();
	}
};

export const NoModels: Story = {
	args: { load: async () => modelFixtures.empty },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByRole('button', { name: 'Model: Model' }));
		await expect(canvas.getByText(/No models are available/)).toBeInTheDocument();
	}
};
