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

export const EmptyCredentialReferences: Story = {
	args: { selection: sandboxFixtures.workspaceWrite, effective: sandboxFixtures.effective }
};

export const WithCredentialReference: Story = {
	args: { selection: sandboxFixtures.referenced, effective: sandboxFixtures.effective },
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.clear(canvas.getByRole('textbox', { name: /Source environment variable/ }));
		await userEvent.type(canvas.getByRole('textbox', { name: /Source environment variable/ }), 'NPM_TOKEN');
		await userEvent.tab();
		await expect(args.onChange).toHaveBeenCalled();
		const latestSelection = args.onChange.mock.calls.at(-1)?.[0];
		await expect(latestSelection?.mode).toBe('sandboxed');
		if (latestSelection?.mode === 'sandboxed') {
			await expect(latestSelection.settings.credentialReferences[0]?.source).toBe('NPM_TOKEN');
		}
	}
};

export const MissingCredentialSource: Story = {
	args: { selection: sandboxFixtures.missingCredentialSource, error: '"" is not an environment variable name' }
};

export const InvalidCredentialDestination: Story = {
	args: {
		selection: sandboxFixtures.invalidCredentialDestination,
		error: '"https://registry.example.com/token" is not a host or host:port'
	}
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
	args: { selection: sandboxFixtures.referenced, effective: sandboxFixtures.effective },
	parameters: { viewport: { defaultViewport: 'narrow' } }
};
