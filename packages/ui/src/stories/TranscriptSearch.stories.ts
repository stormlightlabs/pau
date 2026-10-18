import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { transcriptSearchFixtures, transcriptSearchNow } from '../fixtures/transcript-search';
import TranscriptSearch from '../lib/TranscriptSearch.svelte';

const meta = {
	title: 'Sessions/Transcript search',
	component: TranscriptSearch,
	parameters: { layout: 'padded' },
	args: {
		agent: 'Pi',
		delay: 0,
		now: transcriptSearchNow,
		search: async () => transcriptSearchFixtures.results,
		onSelect: fn(() => true),
		onClose: fn()
	}
} satisfies Meta<typeof TranscriptSearch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EmptyQuery: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('searchbox', { name: 'Search transcript' })).toHaveFocus();
		await expect(canvas.getByText('Type to search this conversation.')).toBeInTheDocument();
	}
};

export const Searching: Story = {
	args: { search: () => new Promise(() => {}) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole('searchbox'), 'gutter');
		await expect(await canvas.findByText('Searching…')).toBeInTheDocument();
	}
};

export const Results: Story = {
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole('searchbox'), 'gutter');
		const list = await canvas.findByRole('list', { name: 'Search results' });
		await expect(within(list).getAllByRole('button')).toHaveLength(3);
		await expect(list.querySelector('mark')).toHaveTextContent('Gutter');
		await expect(within(list).getByText('3 days ago')).toBeInTheDocument();
		await userEvent.keyboard('{ArrowDown}');
		await expect(args.onSelect).toHaveBeenLastCalledWith(transcriptSearchFixtures.results.hits[1]);
		await userEvent.keyboard('{Enter}');
		await expect(args.onSelect).toHaveBeenCalledTimes(2);
	}
};

export const NoResults: Story = {
	args: { search: async () => transcriptSearchFixtures.noResults },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole('searchbox'), 'zebra');
		await expect(await canvas.findByText('No matches for “zebra”.')).toBeInTheDocument();
	}
};

export const Truncated: Story = {
	args: { search: async () => transcriptSearchFixtures.truncated },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole('searchbox'), 'gutter');
		await expect(await canvas.findByText('Showing the newest 3 matches.')).toBeInTheDocument();
	}
};

export const NotInLoadedTranscript: Story = {
	args: { onSelect: fn(() => false) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole('searchbox'), 'gutter');
		await userEvent.click(await canvas.findByRole('button', { name: /The gutter width/ }));
		await expect(canvas.getByText('That message is not in the loaded transcript.')).toBeInTheDocument();
	}
};

export const Failed: Story = {
	args: {
		search: async () => {
			throw new Error('Pau could not reach its backend.');
		}
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole('searchbox'), 'gutter');
		await expect(await canvas.findByRole('alert')).toHaveTextContent('Pau could not reach its backend.');
		await expect(canvas.getByRole('button', { name: 'Try again' })).toBeEnabled();
	}
};

export const EscapeCloses: Story = {
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole('searchbox'), 'gutter{Escape}');
		await expect(args.onClose).toHaveBeenCalledOnce();
	}
};
