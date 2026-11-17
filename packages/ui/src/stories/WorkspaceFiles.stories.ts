import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';

import WorkspaceFilesDemo from './WorkspaceFilesDemo.svelte';

const meta = {
	title: 'Workspaces/File tree and search',
	component: WorkspaceFilesDemo,
	parameters: { layout: 'fullscreen' },
	args: { state: 'default' }
} satisfies Meta<typeof WorkspaceFilesDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FileTree: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const tree = await canvas.findByRole('tree', { name: 'pau files' });
		await userEvent.click(within(tree).getByRole('treeitem', { name: /packages/ }));
		await expect(within(tree).getByRole('treeitem', { name: /ui/ })).toBeInTheDocument();
	}
};

export const FileMenu: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const tree = await canvas.findByRole('tree', { name: 'pau files' });
		const readme = within(tree).getByRole('treeitem', { name: /README\.md/ });
		readme.focus();
		await userEvent.keyboard('{Shift>}{F10}{/Shift}');
		const menu = canvas.getByRole('menu', { name: 'README.md actions' });
		await expect(within(menu).getByRole('menuitem', { name: 'Copy relative path' })).toBeInTheDocument();
		await userEvent.click(within(menu).getByRole('menuitem', { name: /Reveal in Finder|Show in folder/ }));
		await expect(canvas.getByText('reveal /Users/operator/projects/pau/README.md')).toBeInTheDocument();
		await expect(readme).toHaveFocus();
	}
};

export const SearchResults: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole('searchbox', { name: 'Search files' }), 'workspace');
		await userEvent.keyboard('{Enter}');
		await expect(await canvas.findByText('2 matches')).toBeInTheDocument();
	}
};

export const DetachedHead: Story = { args: { state: 'detached' } };

export const NonRepository: Story = { args: { state: 'non-repository' } };

export const Loading: Story = { args: { state: 'loading' } };

export const Empty: Story = { args: { state: 'empty' } };

export const PermissionError: Story = { args: { state: 'permission-error' } };

export const DeepTreeAndLongPath: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		for (const name of [/packages/, /ui/, /src/, /lib/]) {
			await userEvent.click(await canvas.findByRole('treeitem', { name }));
		}
		await expect(await canvas.findByTitle(/WorkspaceFileTreeWithAnIntentionallyLongName/)).toBeInTheDocument();
	}
};

export const LargeResultSet: Story = {
	args: { state: 'large-results' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole('searchbox', { name: 'Search files' }), 'workspace');
		await userEvent.keyboard('{Enter}');
		await expect(await canvas.findByText('300 matches')).toBeInTheDocument();
	}
};

export const Narrow: Story = {
	parameters: { viewport: { defaultViewport: 'narrow' } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByRole('tree', { name: 'pau files' })).toBeInTheDocument();
	}
};
