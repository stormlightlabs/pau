import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import ThinkingLevelPicker from '../lib/ThinkingLevelPicker.svelte';
import type { ThinkingLevel } from '../lib/types/session';

const meta = {
	title: 'Sessions/Thinking level picker',
	component: ThinkingLevelPicker,
	parameters: { layout: 'centered' },
	args: { level: 'medium', reasoning: true, onSelect: fn() }
} satisfies Meta<typeof ThinkingLevelPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

function levelStory(level: ThinkingLevel): Story {
	return {
		args: { level },
		play: async ({ canvasElement }) => {
			const select = within(canvasElement).getByRole('combobox', { name: 'Thinking level' });
			await expect(select).toBeEnabled();
			await expect(select).toHaveValue(level);
		}
	};
}

export const Off = levelStory('off');
export const Minimal = levelStory('minimal');
export const Low = levelStory('low');
export const Medium = levelStory('medium');
export const High = levelStory('high');
export const ExtraHigh = levelStory('xhigh');
export const Max = levelStory('max');

export const UnknownLevel: Story = {
	args: { level: undefined },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('combobox', { name: 'Thinking level' })).toHaveValue('');
		await expect(canvas.getByRole('option', { name: 'Choose a level' })).toBeDisabled();
	}
};

export const ChangeLevel: Story = {
	play: async ({ canvasElement, args }) => {
		const select = within(canvasElement).getByRole('combobox', { name: 'Thinking level' });
		await userEvent.selectOptions(select, 'high');
		await expect(args.onSelect).toHaveBeenCalledWith('high');
	}
};

export const ModelWithoutThinkingLevels: Story = {
	args: { level: undefined, reasoning: false },
	play: async ({ canvasElement }) => {
		const select = within(canvasElement).getByRole('combobox', { name: 'Thinking level' });
		await expect(select).toBeDisabled();
		await expect(select).toHaveAccessibleDescription(/does not offer thinking levels/);
	}
};

export const Unsupported: Story = {
	args: { supported: false },
	play: async ({ canvasElement }) => {
		const select = within(canvasElement).getByRole('combobox', { name: 'Thinking level' });
		await expect(select).toBeDisabled();
		await expect(select).toHaveAccessibleDescription(/does not support changing the thinking level/);
	}
};

export const DuringRun: Story = {
	args: { unavailableReason: 'Wait for this run to finish before changing the thinking level.' },
	play: async ({ canvasElement }) => {
		const select = within(canvasElement).getByRole('combobox', { name: 'Thinking level' });
		await expect(select).toBeDisabled();
		await expect(select).toHaveAccessibleDescription(/Wait for this run/);
	}
};

export const Rejected: Story = {
	args: {
		onSelect: async () => {
			throw new Error('Pi rejected the request: Level not supported');
		}
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const select = canvas.getByRole('combobox', { name: 'Thinking level' });
		await userEvent.selectOptions(select, 'max');
		await expect(await canvas.findByRole('alert')).toHaveTextContent('Pi rejected the request: Level not supported');
		await expect(select).toHaveValue('medium');
		await expect(select).toBeEnabled();
	}
};
