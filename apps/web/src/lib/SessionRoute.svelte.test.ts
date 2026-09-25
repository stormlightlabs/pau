import { sessionFixtures } from '@stormlightlabs/pau-ui';
import { page, userEvent } from 'vitest/browser';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import SessionRoute from './SessionRoute.svelte';

test('controls and switches two concurrent fake sessions without crossing their state', async () => {
	await render(SessionRoute, { initialWorkspaces: sessionFixtures.concurrent, initialSessionId: 'diff-gutter' });
	const prompt = page.getByRole('textbox', { name: 'Prompt' });

	await userEvent.click(prompt);
	await userEvent.type(prompt, 'Keep the renderer API unchanged.');
	await userEvent.keyboard('{Control>}{Enter}{/Control}');
	await expect.element(page.getByText('Keep the renderer API unchanged.')).toBeVisible();

	await userEvent.keyboard('{Escape}');
	await expect.element(page.getByText('Ready').last()).toBeVisible();

	await userEvent.click(page.getByRole('button', { name: 'Open navigation' }));
	const secondSession = page.getByRole('button', { name: /Review session registry/ });
	await userEvent.click(secondSession);
	await expect.element(page.getByRole('alert')).toHaveTextContent('Attention required.');

	await userEvent.click(page.getByRole('button', { name: /Fix diff gutter/ }));
	await expect.element(page.getByRole('heading', { name: 'Fix diff gutter' })).toBeVisible();
	await expect.element(page.getByText('Keep the renderer API unchanged.')).toBeVisible();
});
