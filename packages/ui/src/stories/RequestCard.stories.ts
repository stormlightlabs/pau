import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { permissionTitle } from '../fixtures/bay';
import RequestCard from '../lib/RequestCard.svelte';
import { permissionRequest, type PermissionRequest } from '../lib/permission-request';

const request = (title: string): PermissionRequest =>
	permissionRequest({
		id: 'dialog-permission',
		kind: 'select',
		title,
		options: ['allow_once', 'allow_session', 'deny']
	})!;

const meta = {
	title: 'Sessions/Request card',
	component: RequestCard,
	parameters: { layout: 'padded' },
	args: { request: request(permissionTitle), agent: 'Pi', onRespond: fn() }
} satisfies Meta<typeof RequestCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A held write, with Allow once as the one primary. */
export const Rest: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('heading', { name: 'Allow write to crates/server/src/sessions.rs?' })).toBeVisible();
		await expect(canvasElement.querySelectorAll('.pau-button--primary')).toHaveLength(1);
	}
};

/** Y, A and N answer while focus is outside a text field. */
export const Keys: Story = {
	play: async ({ args, canvasElement }) => {
		await userEvent.keyboard('n');
		await expect(args.onRespond).toHaveBeenCalledWith({ id: 'dialog-permission', value: 'deny' });
		await userEvent.tab();
		await expect(canvasElement.ownerDocument.activeElement).toHaveAccessibleName('Allow once Y');
	}
};

/** A command to run, in the code face. */
export const Command: Story = {
	args: {
		request: request(
			JSON.stringify({ pau: 'permission', tool: 'bash', operation: 'execute', command: 'pnpm install', paths: [] })
		)
	}
};

/** While Pau reconnects the card stays and its actions disable with a reason. */
export const Unavailable: Story = {
	args: { unavailable: 'Pau is reconnecting to the backend. You can answer once it reconnects.' },
	play: async ({ canvasElement }) => {
		const allow = within(canvasElement).getByRole('button', { name: /Allow once/ });
		await expect(allow).toBeDisabled();
		await expect(allow).toHaveAccessibleDescription(
			'Pau is reconnecting to the backend. You can answer once it reconnects.'
		);
	}
};

/** A long path wraps inside the question, and several paths list under it. */
export const LongContent: Story = {
	args: {
		request: request(
			JSON.stringify({
				pau: 'permission',
				tool: 'write',
				operation: 'write',
				paths: [
					'packages/ui/src/lib/resource-browser/scope-picker/ScopePickerOption.svelte',
					'packages/ui/src/lib/resource-browser/scope-picker/ScopePicker.svelte'
				],
				cwd: '/Users/dev/Projects/pau-worktrees/pau-scope'
			})
		)
	}
};
