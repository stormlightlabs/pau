import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { sandboxFixtures } from '../fixtures/sandbox';
import SandboxSettingsView from '../lib/SandboxSettingsView.svelte';

const meta = {
	title: 'Workspace/Agent sandbox',
	component: SandboxSettingsView,
	tags: ['autodocs'],
	args: { selection: sandboxFixtures.unsandboxed, onChange: fn(), onSave: fn(), onUseWorkspaceDefault: fn() }
} satisfies Meta<typeof SandboxSettingsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UnsandboxedDefault: Story = {
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText('Sandbox off')).toBeVisible();
		await userEvent.click(canvas.getByRole('radio', { name: /Sandboxed/ }));
		await expect(args.onChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'sandboxed' }));
		await userEvent.click(canvas.getByRole('button', { name: 'Save workspace default' }));
		await expect(args.onSave).toHaveBeenCalledOnce();
	}
};

export const WorkspaceWrite: Story = {
	args: { selection: sandboxFixtures.workspaceWrite, effective: sandboxFixtures.effective }
};

export const WithGrants: Story = {
	args: { selection: sandboxFixtures.granted, effective: sandboxFixtures.grantedEffective }
};

export const Claude: Story = {
	args: { selection: sandboxFixtures.workspaceWrite, effective: sandboxFixtures.claudeEffective }
};

export const UnverifiedPlatform: Story = {
	args: { selection: sandboxFixtures.workspaceWrite, effective: sandboxFixtures.macosEffective }
};

export const SessionOverride: Story = {
	args: { selection: sandboxFixtures.workspaceWrite, effective: sandboxFixtures.effective, scope: 'session' },
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole('button', { name: 'Use workspace default' }));
		await expect(args.onUseWorkspaceDefault).toHaveBeenCalledOnce();
	}
};

export const Unavailable: Story = { args: { unavailable: sandboxFixtures.unavailable } };

export const InvalidGrant: Story = {
	args: { selection: sandboxFixtures.granted, error: '"https://registry.npmjs.org/" is not a host or host:port' }
};

export const Narrow: Story = {
	args: { selection: sandboxFixtures.granted, effective: sandboxFixtures.grantedEffective },
	parameters: { viewport: { defaultViewport: 'narrow' } }
};
