import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, within } from 'storybook/test';

import SessionStatusLine from '../lib/SessionStatusLine.svelte';

const usage = {
	tokens: { input: 182_000, output: 24_100, cacheRead: 1_200_000, cacheWrite: 96_000, total: 1_502_100 },
	cost: 3.42
};

const meta = {
	title: 'Sessions/Status line',
	component: SessionStatusLine,
	parameters: { layout: 'padded' },
	args: {
		path: '/Users/operator/projects/pau/packages/ui',
		branch: 'design-file-rebuild',
		usage,
		usageSupported: true,
		statuses: [
			{ key: 'plan', text: 'plan mode off' },
			{ key: 'todos', text: 'todos 2/5' }
		]
	}
} satisfies Meta<typeof SessionStatusLine>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {
	play: async ({ canvasElement }) => {
		const line = within(canvasElement).getByRole('group', { name: 'Session status' });
		await expect(line).toHaveTextContent('Branch design-file-rebuild');
		await expect(line).toHaveTextContent('Cost $3.42');
		await expect(line).toHaveTextContent(/plan mode off\W*todos 2\/5$/);
	}
};

/** A new session: Pi reported usage, but no reply has used tokens yet. */
export const NoUsage: Story = {
	args: { usage: { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 }, statuses: [] }
};

/** The agent reports no usage, so only the folder and branch show. */
export const MissingStats: Story = { args: { usage: undefined, usageSupported: false, statuses: [] } };

/** When the line runs short, the path loses its start first and the statuses wrap below. */
export const LongPath: Story = {
	args: {
		path: '/Users/operator/projects/a-very-long-folder-name/with/many/nested/levels/packages/ui',
		statuses: [
			{ key: 'mcp', text: 'MCP: 3 servers connected' },
			{ key: 'plan', text: 'plan mode off' },
			{ key: 'todos', text: 'todos 2/5' }
		]
	}
};
