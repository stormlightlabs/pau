import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, within } from 'storybook/test';

import { markdownFixtures } from '../fixtures/markdown';
import MarkdownDemo from './MarkdownDemo.svelte';

const meta = {
	title: 'Sessions/Markdown',
	component: MarkdownDemo,
	argTypes: {
		theme: { control: 'select', options: ['eldritch', 'nord', 'iceberg', 'catppuccin-mocha', 'vitesse-dark'] }
	},
	args: { text: markdownFixtures.headings, theme: 'eldritch' }
} satisfies Meta<typeof MarkdownDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Headings: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('heading', { level: 1, name: 'Findings' })).toBeInTheDocument();
		await expect(canvas.getByRole('heading', { level: 3, name: 'Fix' })).toBeInTheDocument();
	}
};

export const Lists: Story = {
	args: { text: markdownFixtures.lists },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getAllByRole('list')).toHaveLength(4);
		await expect(canvas.getAllByRole('listitem').length).toBe(7);
		await expect(canvas.getAllByRole('checkbox', { name: 'Task' })[0]).toBeChecked();
	}
};

export const CodeBlocks: Story = {
	args: { text: markdownFixtures.code },
	play: async ({ canvasElement }) => {
		const code = canvasElement.querySelector(':scope pre code') as HTMLElement;
		await expect(code).toHaveTextContent('export function width');
		await expect(getComputedStyle(code).fontFamily).toContain('IBM Plex Mono');
		await expect(within(canvasElement).getByText('plain output <b>not html</b>')).toBeInTheDocument();
	}
};

export const LongCodeBlock: Story = {
	args: { text: markdownFixtures.longCode },
	play: async ({ canvasElement }) => {
		const pre = canvasElement.querySelector('pre') as HTMLElement;
		await expect(pre.scrollWidth).toBeGreaterThan(pre.clientWidth);
	}
};

export const Links: Story = {
	args: { text: markdownFixtures.links },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const link = canvas.getByRole('link', { name: 'the docs' });
		await expect(link).toHaveAttribute('href', 'https://example.com/docs');
		await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
		await expect(canvas.getAllByRole('link')).toHaveLength(1);
	}
};

export const Tables: Story = {
	args: { text: markdownFixtures.table },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('columnheader', { name: 'Tool' })).toBeInTheDocument();
		await expect(canvas.getAllByRole('row')).toHaveLength(3);
	}
};

export const RawHtmlStaysText: Story = {
	args: { text: markdownFixtures.html },
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('script, b, div[onclick], img')).toBeNull();
		await expect(canvasElement).toHaveTextContent('<b>bold</b>');
	}
};

export const StreamingPartialMessage: Story = {
	args: { text: markdownFixtures.streaming },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getAllByRole('listitem')).toHaveLength(2);
		await expect(canvasElement.querySelector(':scope pre code')).toHaveTextContent('const width = measure(');
	}
};

export const Nord: Story = { args: { text: markdownFixtures.code, theme: 'nord' } };
export const Iceberg: Story = { args: { text: markdownFixtures.code, theme: 'iceberg' } };
export const CatppuccinMocha: Story = { args: { text: markdownFixtures.code, theme: 'catppuccin-mocha' } };
export const VitesseDark: Story = { args: { text: markdownFixtures.code, theme: 'vitesse-dark' } };
