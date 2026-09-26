import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { mcpConfigurationFixtures } from '../fixtures/mcp';
import McpConfigurationView from '../lib/McpConfigurationView.svelte';

const meta = {
	title: 'Resources/MCP configuration',
	component: McpConfigurationView,
	tags: ['autodocs'],
	args: {
		configuration: mcpConfigurationFixtures.piConfiguredOff,
		onEnable: fn(),
		onResolve: fn(),
		onCreate: fn(),
		onEdit: fn(),
		onRemove: fn(),
		onToggle: fn(),
		onAuthenticate: fn(),
		onTest: fn()
	}
} satisfies Meta<typeof McpConfigurationView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ConfiguredOff: Story = {
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByText('Native Pi MCP remains active. Pau does not change that configuration.')
		).toBeVisible();
		await userEvent.click(canvas.getByRole('button', { name: 'Enable for this workspace' }));
		await expect(args.onEnable).toHaveBeenCalledOnce();
	}
};

export const PackageAbsent: Story = { args: { configuration: mcpConfigurationFixtures.piAbsent } };

export const PackageDisabled: Story = { args: { configuration: mcpConfigurationFixtures.piDisabled } };

export const ClaudeConfiguredOff: Story = { args: { configuration: mcpConfigurationFixtures.claudeConfiguredOff } };
