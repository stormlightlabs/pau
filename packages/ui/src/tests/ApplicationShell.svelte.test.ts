import { page, userEvent } from 'vitest/browser';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import ApplicationShellDemo from '../stories/ApplicationShellDemo.svelte';

test('toggles contextual and inspector rails', async () => {
	await render(ApplicationShellDemo);

	const navigationToggle = page.getByRole('button', { name: 'Open navigation' });
	const inspector = page.getByRole('complementary', { name: 'Inspector' });

	await userEvent.click(inspector.getByRole('button', { name: 'Close inspector' }));
	await expect.element(page.getByRole('button', { name: 'Show inspector' })).toHaveAttribute('aria-expanded', 'false');
	await expect.element(inspector).not.toBeInTheDocument();

	await userEvent.click(navigationToggle);
	await expect.element(navigationToggle).toHaveAttribute('aria-expanded', 'true');
});

test('keeps command and named rail controls in keyboard order', async () => {
	await render(ApplicationShellDemo);

	const commandInput = page.getByRole('searchbox', { name: 'Search or run a command' });
	await userEvent.click(commandInput);
	await expect.element(commandInput).toHaveFocus();
	await userEvent.tab();
	await expect.element(page.getByRole('link', { name: 'Sessions' })).toHaveFocus();

	await expect.element(page.getByRole('link', { name: 'Files' })).toBeInTheDocument();
	await expect.element(page.getByRole('link', { name: 'Resources' })).toBeInTheDocument();
	await expect.element(page.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
	await expect.element(page.getByRole('button', { name: 'Hide inspector' })).toBeInTheDocument();
});
