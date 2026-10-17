import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import ExtensionUi from '../lib/ExtensionUi.svelte';
import type { ExtensionDialog, ExtensionUiState } from '../lib/types/session';

const state = (dialog?: ExtensionDialog): ExtensionUiState => ({
	dialog,
	notifications: [],
	statuses: [],
	widgets: []
});

test('responds to confirmation and selection requests', async () => {
	const onRespond = vi.fn();
	const confirmation = await render(ExtensionUi, {
		state: state({ id: 'confirm', kind: 'confirm', title: 'Continue?', message: 'This updates the index.' }),
		onRespond
	});

	await userEvent.click(page.getByRole('button', { name: 'Yes' }));
	expect(onRespond).toHaveBeenCalledWith({ id: 'confirm', confirmed: true });
	confirmation.unmount();

	const selection = await render(ExtensionUi, {
		state: state({ id: 'select', kind: 'select', title: 'Choose a profile', options: ['Review', 'Work'] }),
		onRespond
	});
	await userEvent.click(page.getByRole('button', { name: 'Work' }));
	expect(onRespond).toHaveBeenCalledWith({ id: 'select', value: 'Work' });
	selection.unmount();
});

test('submits input, editor text, and cancellation', async () => {
	const inputResponse = vi.fn();
	const input = await render(ExtensionUi, {
		state: state({ id: 'input', kind: 'input', title: 'Name the task', placeholder: 'Task name' }),
		onRespond: inputResponse
	});
	await userEvent.type(page.getByRole('textbox', { name: 'Response' }), 'Review RPC');
	await userEvent.click(page.getByRole('button', { name: 'Submit' }));
	expect(inputResponse).toHaveBeenCalledWith({ id: 'input', value: 'Review RPC' });
	input.unmount();

	const editorResponse = vi.fn();
	await render(ExtensionUi, {
		state: state({ id: 'editor', kind: 'editor', title: 'Edit instructions', prefill: 'First line' }),
		onRespond: editorResponse
	});
	await expect.element(page.getByRole('textbox', { name: 'Text' })).toHaveValue('First line');
	await userEvent.click(page.getByRole('button', { name: 'Cancel' }));
	expect(editorResponse).toHaveBeenCalledWith({ id: 'editor', cancelled: true });
});

test('shows notifications, status text, and string widgets', async () => {
	await render(ExtensionUi, {
		state: {
			notifications: [{ id: 'notice', message: 'Command blocked', level: 'warning' }],
			statuses: [{ key: 'mcp', text: 'Connecting' }],
			widgets: [{ key: 'details', lines: ['Server: local', 'Tools: 3'], placement: 'above-editor' }]
		}
	});

	await expect.element(page.getByText('Command blocked')).toBeVisible();
	await expect.element(page.getByText('Connecting')).toBeVisible();
	await expect.element(page.getByRole('region', { name: 'Extension widget: details' })).toHaveTextContent('Tools: 3');
});

test('dismisses a timed-out request without sending a late response', async () => {
	const onRespond = vi.fn();
	const onTimeout = vi.fn();
	await render(ExtensionUi, {
		state: state({ id: 'timeout', kind: 'select', title: 'Choose quickly', options: ['Wait'], timeoutMs: 20 }),
		onRespond,
		onTimeout
	});

	await new Promise((resolve) => setTimeout(resolve, 40));

	expect(onTimeout).toHaveBeenCalledWith('timeout');
	expect(onRespond).not.toHaveBeenCalled();
	await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
});

test('explains terminal-only custom components and opens the terminal escape hatch', async () => {
	const onOpenTerminal = vi.fn();
	await render(ExtensionUi, { state: state({ id: 'custom', kind: 'unsupported', method: 'custom' }), onOpenTerminal });

	await expect.element(page.getByText(/Pau cannot render/)).toBeVisible();
	await userEvent.click(page.getByRole('button', { name: 'Open Pi in terminal' }));
	expect(onOpenTerminal).toHaveBeenCalledOnce();
});

test('cancels a dialog with Escape', async () => {
	const onRespond = vi.fn();
	await render(ExtensionUi, {
		state: state({ id: 'escape', kind: 'confirm', title: 'Continue?', message: 'This updates the index.' }),
		onRespond
	});
	await expect.element(page.getByRole('dialog')).toBeVisible();

	await userEvent.keyboard('{Escape}');

	expect(onRespond).toHaveBeenCalledWith({ id: 'escape', cancelled: true });
});

test('closes an open dialog when its session exits and shows the notice', async () => {
	const view = await render(ExtensionUi, {
		state: state({ id: 'exit', kind: 'select', title: 'Choose a profile', options: ['Work'] })
	});
	await expect.element(page.getByRole('dialog', { name: 'Choose a profile' })).toBeVisible();

	await view.rerender({
		state: {
			notifications: [
				{ id: 'resolved:exit', message: 'The session ended before the request was answered.', level: 'warning' }
			],
			statuses: [],
			widgets: []
		}
	});

	await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
	await expect.element(page.getByText('The session ended before the request was answered.')).toBeVisible();
});

test('shows a rejected answer inside the dialog', async () => {
	await render(ExtensionUi, {
		state: state({ id: 'reject', kind: 'select', title: 'Choose a profile', options: ['Work'] }),
		onRespond: () => Promise.reject(new Error('The extension could not use that answer.'))
	});

	await userEvent.click(page.getByRole('button', { name: 'Work' }));

	await expect
		.element(page.getByRole('dialog').getByRole('alert'))
		.toHaveTextContent('The extension could not use that answer.');
	await expect.element(page.getByRole('button', { name: 'Work' })).toBeEnabled();
});
