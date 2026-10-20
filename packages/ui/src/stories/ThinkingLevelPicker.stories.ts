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

function levelStory(level: ThinkingLevel, label: string): Story {
	return {
		args: { level },
		play: async ({ canvasElement }) => {
			const select = within(canvasElement).getByRole('combobox', { name: 'Thinking level' });
			await expect(select).toBeEnabled();
			await expect(select).toHaveTextContent(label);
		}
	};
}

export const Off = levelStory('off', 'Off');
export const Minimal = levelStory('minimal', 'Minimal');
export const Low = levelStory('low', 'Low');
export const Medium = levelStory('medium', 'Medium');
export const High = levelStory('high', 'High');
export const ExtraHigh = levelStory('xhigh', 'Extra high');
export const Max = levelStory('max', 'Max');

export const UnknownLevel: Story = {
	args: { level: undefined },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('combobox', { name: 'Thinking level' })).toHaveTextContent('Choose a level');
	}
};

export const ChangeLevel: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const select = canvas.getByRole('combobox', { name: 'Thinking level' });
		await userEvent.click(select);
		await userEvent.click(await canvas.findByRole('option', { name: 'High' }));
		await expect(args.onSelect).toHaveBeenCalledWith('high');
		await expect(select).toHaveFocus();
	}
};

/** Opens the list from the keyboard, moves with the arrows, and selects with Enter. */
export const KeyboardSelection: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const select = canvas.getByRole('combobox', { name: 'Thinking level' });
		select.focus();
		await userEvent.keyboard('{ArrowDown}');
		await expect(select).toHaveAttribute('aria-expanded', 'true');
		await expect(canvas.getByRole('option', { name: 'Medium' })).toHaveAttribute('aria-selected', 'true');
		await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
		await expect(args.onSelect).toHaveBeenCalledWith('xhigh');
		await expect(select).toHaveAttribute('aria-expanded', 'false');
		await expect(select).toHaveFocus();
	}
};

/** A model that offers some levels lists only those. */
export const ModelWithSomeLevels: Story = {
	args: { level: 'low', levels: ['off', 'low', 'medium', 'high'] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('combobox', { name: 'Thinking level' }));
		const options = await canvas.findAllByRole('option');
		await expect(options.map((option) => option.textContent?.trim())).toEqual(['Off', 'Low', 'Medium', 'High']);
	}
};

/** Pi reports only `off` for a model without reasoning. */
export const ModelWithoutThinkingLevels: Story = {
	args: { level: 'off', levels: ['off'] },
	play: async ({ canvasElement }) => {
		const select = within(canvasElement).getByRole('combobox', { name: 'Thinking level' });
		await expect(select).toHaveTextContent('Off');
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
		await userEvent.click(select);
		await userEvent.click(await canvas.findByRole('option', { name: 'Max' }));
		await expect(await canvas.findByRole('alert')).toHaveTextContent('Pi rejected the request: Level not supported');
		await expect(select).toHaveTextContent('Medium');
		await expect(select).toBeEnabled();
	}
};
