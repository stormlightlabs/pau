import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import ExtensionUi from '../lib/ExtensionUi.svelte';
import { themeCssProperties } from '../theme';
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
	await userEvent.click(page.getByRole('radio', { name: 'Work' }));
	await userEvent.click(page.getByRole('button', { name: 'Select' }));
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

test('shows notifications and string widgets but leaves status text to the status line', async () => {
	await render(ExtensionUi, {
		state: {
			notifications: [{ id: 'notice', message: 'Command blocked', level: 'warning' }],
			statuses: [{ key: 'mcp', text: 'Connecting' }],
			widgets: [{ key: 'details', lines: ['Server: local', 'Tools: 3'], placement: 'above-editor' }]
		}
	});

	await expect.element(page.getByText('Command blocked')).toBeVisible();
	await expect.element(page.getByText('Connecting')).not.toBeInTheDocument();
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

	await userEvent.click(page.getByRole('button', { name: 'Select' }));

	await expect
		.element(page.getByRole('dialog').getByRole('alert'))
		.toHaveTextContent('The extension could not use that answer.');
	await expect.element(page.getByRole('button', { name: 'Select' })).toBeEnabled();
});

const permissionTitle = JSON.stringify({ pau: 'permission', tool: 'bash', command: 'pnpm test', cwd: '/home/me/pau' });

/** Applies theme colors to the page the way the application shell does, so styles can be compared. */
function applyTheme(): void {
	const properties = Object.entries(themeCssProperties('eldritch', 'overpass'));
	for (const [name, value] of properties) {
		document.documentElement.style.setProperty(name, value);
	}
}

/** Resolves a color token to the computed color a property using it would have. */
function tokenColor(scope: Element, token: string): string {
	const probe = document.createElement('i');
	probe.style.color = `var(${token})`;
	scope.append(probe);
	const color = getComputedStyle(probe).color;
	probe.remove();
	return color;
}

test.each<[string, ExtensionDialog, string]>([
	['confirm', { id: 'a', kind: 'confirm', title: 'Continue?', message: 'Update the index.' }, 'Yes'],
	['select', { id: 'b', kind: 'select', title: 'Choose', options: ['Review', 'Work'] }, 'Review'],
	['input', { id: 'c', kind: 'input', title: 'Name the task' }, 'Response'],
	['editor', { id: 'd', kind: 'editor', title: 'Edit', prefill: 'text' }, 'Text']
])('draws a %s dialog with the border token and starts on its main control', async (_name, dialog, name) => {
	applyTheme();
	await render(ExtensionUi, { state: state(dialog) });
	const surface = page.getByRole('dialog');
	await expect.element(surface).toBeVisible();

	const style = getComputedStyle(surface.element());
	expect(style.borderTopColor).toBe(tokenColor(surface.element(), '--pau-border'));
	expect(style.borderTopColor).not.toBe(tokenColor(surface.element(), '--pau-focus'));
	expect(style.borderTopLeftRadius).toBe('5px');

	const control = name === 'Yes' || name === 'Review' ? 'button, input' : 'input, textarea';
	await vi.waitFor(() => {
		const active = document.activeElement as HTMLElement;
		expect(active.matches(control)).toBe(true);
		expect(active.closest('dialog')).toBe(surface.element());
		expect(active.getAttribute('aria-label')).not.toBe('Cancel');
	});
	const active = document.activeElement as HTMLElement;
	expect(active.closest('label')?.textContent?.trim() ?? active.textContent?.trim()).toContain(
		name === 'Yes' || name === 'Review' ? name : ''
	);
});

test('lists select options with one selected row and reserves the accent for the confirm action', async () => {
	applyTheme();
	const onRespond = vi.fn();
	await render(ExtensionUi, {
		state: state({ id: 'pick', kind: 'select', title: 'Choose a profile', options: ['Review', 'Work', 'Ship'] }),
		onRespond
	});

	const options = page.getByRole('radio');
	await expect.element(options).toHaveLength(3);
	await expect.element(page.getByRole('radio', { name: 'Review' })).toBeChecked();
	await userEvent.click(page.getByRole('radio', { name: 'Ship' }));
	await expect.element(page.getByRole('radio', { name: 'Ship' })).toBeChecked();
	await expect.element(page.getByRole('radio', { name: 'Review' })).not.toBeChecked();

	const marks = (): number =>
		[...document.querySelectorAll('.extension-ui__check')].filter(
			(mark) => getComputedStyle(mark).visibility === 'visible'
		).length;
	expect(marks()).toBe(1);

	const background = (name: string): string =>
		getComputedStyle(page.getByRole('button', { name }).element()).backgroundColor;
	expect(background('Select')).toBe(tokenColor(document.documentElement, '--pau-accent'));
	expect(background('Cancel')).toBe('rgba(0, 0, 0, 0)');

	await userEvent.click(page.getByRole('button', { name: 'Select' }));
	expect(onRespond).toHaveBeenCalledWith({ id: 'pick', value: 'Ship' });
});

test('shows a permission request as tool, command, and directory rows', async () => {
	await render(ExtensionUi, {
		state: state({ id: 'perm', kind: 'select', title: permissionTitle, options: ['Allow once', 'Deny'] })
	});

	const surface = page.getByRole('dialog', { name: 'Permission request' });
	await expect.element(surface).toBeVisible();
	await expect.element(surface.getByText('Tool', { exact: true })).toBeVisible();
	await expect.element(surface.getByText('bash', { exact: true })).toBeVisible();
	await expect.element(surface.getByText('Command', { exact: true })).toBeVisible();
	await expect.element(surface.getByText('pnpm test', { exact: true })).toBeVisible();
	await expect.element(surface.getByText('Working directory', { exact: true })).toBeVisible();
	await expect.element(surface.getByText('/home/me/pau', { exact: true })).toBeVisible();
	await expect.element(surface.getByText('"pau"')).not.toBeInTheDocument();
});

test('trims other structured titles into a code block', async () => {
	const long = JSON.stringify({ note: 'x'.repeat(2000) });
	await render(ExtensionUi, { state: state({ id: 'json', kind: 'select', title: long, options: ['Ok'] }) });

	const code = page.getByRole('dialog', { name: 'Extension request' }).getByRole('code');
	await expect.element(code).toBeVisible();
	expect(code.element().textContent?.length).toBeLessThan(700);
	await expect.element(page.getByRole('dialog').getByText(/^Choose/)).not.toBeInTheDocument();
});

test('starts a permission request with no option chosen and approves only after a choice', async () => {
	const onRespond = vi.fn();
	await render(ExtensionUi, {
		state: state({ id: 'perm', kind: 'select', title: permissionTitle, options: ['Allow once', 'Deny'] }),
		onRespond
	});

	await expect.element(page.getByRole('radio', { name: 'Allow once' })).not.toBeChecked();
	await expect.element(page.getByRole('radio', { name: 'Deny' })).not.toBeChecked();
	await expect.element(page.getByRole('button', { name: 'Select' })).toBeDisabled();
	await vi.waitFor(() =>
		expect(document.activeElement).toBe(page.getByRole('radio', { name: 'Allow once' }).element())
	);

	await userEvent.keyboard('{Enter}');
	expect(onRespond).not.toHaveBeenCalled();

	await userEvent.click(page.getByRole('radio', { name: 'Deny' }));
	await expect.element(page.getByRole('button', { name: 'Select' })).toBeEnabled();
	await userEvent.click(page.getByRole('button', { name: 'Select' }));
	expect(onRespond).toHaveBeenCalledWith({ id: 'perm', value: 'Deny' });
});

test('cancels a permission request with Escape without approving', async () => {
	const onRespond = vi.fn();
	await render(ExtensionUi, {
		state: state({ id: 'perm', kind: 'select', title: permissionTitle, options: ['Allow once', 'Deny'] }),
		onRespond
	});
	await userEvent.keyboard('{Escape}');
	expect(onRespond).toHaveBeenCalledWith({ id: 'perm', cancelled: true });
});
