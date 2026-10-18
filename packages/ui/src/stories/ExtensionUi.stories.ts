import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import ExtensionUi from '../lib/ExtensionUi.svelte';
import type { ExtensionDialog, ExtensionUiState } from '../lib/types/session';

const withDialog = (dialog: ExtensionDialog): ExtensionUiState => ({
	dialog,
	notifications: [],
	statuses: [],
	widgets: []
});

const meta = {
	title: 'Sessions/Extension UI',
	component: ExtensionUi,
	args: {
		state: withDialog({ id: 'select', kind: 'select', title: 'Choose a profile', options: ['Review', 'Work'] }),
		onRespond: fn(),
		onTimeout: fn()
	}
} satisfies Meta<typeof ExtensionUi>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Select: Story = {
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement.ownerDocument.body);
		await expect(canvas.getByRole('dialog', { name: 'Choose a profile' })).toBeVisible();
		await expect(canvas.getByRole('radio', { name: 'Review' })).toBeChecked();
		await userEvent.click(canvas.getByRole('radio', { name: 'Work' }));
		await userEvent.click(canvas.getByRole('button', { name: 'Select' }));
		await expect(args.onRespond).toHaveBeenCalledWith({ id: 'select', value: 'Work' });
	}
};

export const Confirm: Story = {
	args: {
		state: withDialog({
			id: 'confirm',
			kind: 'confirm',
			title: 'Allow workspace update?',
			message: 'The extension wants to update its workspace index.'
		})
	},
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement.ownerDocument.body);
		await userEvent.click(canvas.getByRole('button', { name: 'No' }));
		await expect(args.onRespond).toHaveBeenCalledWith({ id: 'confirm', confirmed: false });
	}
};

export const Input: Story = {
	args: { state: withDialog({ id: 'input', kind: 'input', title: 'Name the task', placeholder: 'Task name' }) },
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement.ownerDocument.body);
		await userEvent.type(canvas.getByRole('textbox', { name: 'Response' }), 'Review RPC');
		await userEvent.click(canvas.getByRole('button', { name: 'Submit' }));
		await expect(args.onRespond).toHaveBeenCalledWith({ id: 'input', value: 'Review RPC' });
	}
};

export const Editor: Story = {
	args: {
		state: withDialog({
			id: 'editor',
			kind: 'editor',
			title: 'Edit instructions',
			prefill: 'Keep the public API unchanged.\nRun the focused tests.'
		})
	},
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement.ownerDocument.body);
		await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
		await expect(args.onRespond).toHaveBeenCalledWith({ id: 'editor', cancelled: true });
	}
};

export const Unsupported: Story = {
	args: { state: withDialog({ id: 'custom', kind: 'unsupported', method: 'custom' }) },
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement.ownerDocument.body);
		await expect(canvas.getByText(/Pau cannot render/)).toBeVisible();
		await userEvent.click(canvas.getByRole('button', { name: 'Dismiss' }));
		await expect(args.onRespond).toHaveBeenCalledWith({ id: 'custom', cancelled: true });
	}
};

/** Pau's permission request arrives as a JSON title and renders as tool, command, and directory rows. */
export const Permission: Story = {
	args: {
		state: withDialog({
			id: 'permission',
			kind: 'select',
			title: JSON.stringify({
				pau: 'permission',
				tool: 'bash',
				command: 'pnpm --filter @stormlightlabs/pau-desktop exec vitest run --project unit --project browser',
				cwd: '/home/me/projects/pau/apps/desktop'
			}),
			options: ['Allow once', 'Deny']
		})
	},
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		const dialog = body.getByRole('dialog', { name: 'Permission request' });
		await expect(within(dialog).getByText('Working directory')).toBeVisible();
		await expect(within(dialog).getByText('/home/me/projects/pau/apps/desktop')).toBeVisible();
		await expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
	}
};

/** Structured titles that are not permission requests show a trimmed code block. */
export const LongTitle: Story = {
	args: {
		state: withDialog({
			id: 'structured',
			kind: 'select',
			title: JSON.stringify({
				request: 'sync',
				paths: Array.from({ length: 40 }, (_, index) => `src/module-${index}.ts`)
			}),
			options: ['Continue', 'Skip']
		})
	},
	play: async ({ canvasElement }) => {
		const dialog = within(canvasElement.ownerDocument.body).getByRole('dialog', { name: 'Extension request' });
		await expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
	}
};

export const Rejected: Story = {
	args: {
		state: withDialog({ id: 'reject', kind: 'select', title: 'Choose a profile', options: ['Review'] }),
		onRespond: fn(() => {
			throw new Error('The extension could not use that answer. The value is not one of the offered options.');
		})
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement.ownerDocument.body);
		await userEvent.click(canvas.getByRole('button', { name: 'Select' }));
		await expect(await canvas.findByRole('alert')).toHaveTextContent('The extension could not use that answer.');
	}
};

export const NotificationsStatusesAndWidgets: Story = {
	args: {
		state: {
			notifications: [
				{ id: 'ready', message: 'The extension is ready.', level: 'info' },
				{ id: 'blocked', message: 'Command blocked by policy.', level: 'warning' },
				{ id: 'failed', message: 'The MCP server stopped.', level: 'error' }
			],
			statuses: [
				{ key: 'mcp', text: 'Connecting' },
				{ key: 'index', text: '42 files' }
			],
			widgets: [
				{ key: 'plan', lines: ['1. Read the spec', '2. Write the test'], placement: 'above-editor' },
				{ key: 'details', lines: ['Server: local', 'Tools: 3'], placement: 'below-editor' }
			]
		}
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole('alert')).toHaveTextContent('The MCP server stopped.');
		await expect(canvas.getByText('Connecting')).toBeVisible();
		await expect(canvas.getByRole('region', { name: 'Extension widget: details' })).toHaveTextContent('Tools: 3');
	}
};

/** The session ended while a dialog was open: the dialog is gone and a notice explains why. */
export const ExitedWhileOpen: Story = {
	args: {
		state: {
			notifications: [
				{
					id: 'resolved:select',
					message: 'The session ended before the extension request was answered.',
					level: 'warning'
				}
			],
			statuses: [],
			widgets: []
		}
	},
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument());
		await expect(body.getByText(/The session ended before/)).toBeVisible();
	}
};
