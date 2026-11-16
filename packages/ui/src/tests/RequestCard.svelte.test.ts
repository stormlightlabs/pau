import { page, userEvent } from 'vitest/browser';
import { expect, onTestFinished, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { permissionTitle } from '../fixtures/bay';
import { permissionRequest } from '../lib/permission-request';
import RequestCard from '../lib/RequestCard.svelte';

const request = permissionRequest({
	id: 'dialog-permission',
	kind: 'select',
	title: permissionTitle,
	options: ['allow_once', 'allow_session', 'deny']
})!;

test('answers with the option behind a key while focus is outside a text field', async () => {
	const onRespond = vi.fn();
	await render(RequestCard, { request, agent: 'Pi', onRespond });

	await userEvent.keyboard('a');
	expect(onRespond).toHaveBeenCalledWith({ id: 'dialog-permission', value: 'allow_session' });
});

test('leaves keys typed into a field alone and never takes focus', async () => {
	const onRespond = vi.fn();
	const field = document.createElement('textarea');
	document.body.append(field);
	field.focus();
	await render(RequestCard, { request, agent: 'Pi', onRespond });

	await userEvent.keyboard('yan');
	expect(onRespond).not.toHaveBeenCalled();
	expect(document.activeElement).toBe(field);
	field.remove();
});

test('leaves keys typed into an editable element alone', async () => {
	const onRespond = vi.fn();
	const editor = document.createElement('div');
	editor.contentEditable = 'true';
	document.body.append(editor);
	onTestFinished(() => editor.remove());
	editor.focus();
	await render(RequestCard, { request, agent: 'Pi', onRespond });

	await userEvent.keyboard('yan');
	expect(onRespond).not.toHaveBeenCalled();
});

test('ignores the keys while the card sits in an inert subtree', async () => {
	const onRespond = vi.fn();
	await render(RequestCard, { request, agent: 'Pi', onRespond });
	const card = document.querySelector<HTMLElement>('.request-card')!.parentElement!;
	card.inert = true;
	onTestFinished(() => {
		card.inert = false;
	});

	await userEvent.keyboard('yan');
	expect(onRespond).not.toHaveBeenCalled();
});

test('makes Allow once the one primary, with key caps on every decision', async () => {
	await render(RequestCard, { request, agent: 'Pi', onRespond: () => {} });

	await expect.element(page.getByRole('button', { name: 'Allow once Y' })).toHaveClass('pau-button--primary');
	await expect.element(page.getByRole('button', { name: 'Allow for session A' })).toHaveClass('pau-button--secondary');
	await expect.element(page.getByRole('button', { name: 'Deny N' })).toHaveAttribute('aria-keyshortcuts', 'N');
	await expect.element(page.getByText('Pi wants to use edit. Writes outside the plan ask first.')).toBeVisible();
});

test('disables the decisions with the reason while Pau reconnects', async () => {
	const onRespond = vi.fn();
	const reason = 'Pau is reconnecting to the backend. You can answer once it reconnects.';
	await render(RequestCard, { request, agent: 'Pi', unavailable: reason, onRespond });

	await expect.element(page.getByRole('button', { name: 'Deny N' })).toBeDisabled();
	await expect.element(page.getByRole('button', { name: 'Deny N' })).toHaveAccessibleDescription(reason);
	await userEvent.keyboard('n');
	expect(onRespond).not.toHaveBeenCalled();
});

test('shows why an answer was not sent', async () => {
	await render(RequestCard, {
		request,
		agent: 'Pi',
		onRespond: async () => {
			throw new Error('The session exited.');
		}
	});

	await userEvent.click(page.getByRole('button', { name: 'Allow once Y' }));
	await expect.element(page.getByRole('alert')).toHaveTextContent('The session exited.');
});
