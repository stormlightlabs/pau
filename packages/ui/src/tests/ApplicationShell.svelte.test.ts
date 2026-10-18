import { page, userEvent } from 'vitest/browser';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import ApplicationShellDemo from '../stories/ApplicationShellDemo.svelte';
import { THEMES, UI_FONTS, type ThemeName, type UiFontName } from '../theme';

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

test.each(Object.keys(THEMES) as ThemeName[])('renders the %s theme contract', async (theme) => {
	await render(ApplicationShellDemo, { theme });

	expect(document.querySelector<HTMLElement>('.app-shell')?.dataset.theme).toBe(theme);
});

test.each(Object.keys(UI_FONTS) as UiFontName[])('renders the %s UI font', async (uiFont) => {
	await render(ApplicationShellDemo, { uiFont });

	const shell = document.querySelector<HTMLElement>('.app-shell');
	expect(shell?.dataset.uiFont).toBe(uiFont);
	expect(shell?.style.getPropertyValue('--pau-font-ui')).toContain(UI_FONTS[uiFont].family);
});

test('keeps command and named rail controls in keyboard order', async () => {
	await render(ApplicationShellDemo);

	const commandButton = page.getByRole('button', { name: 'Search or run a command' });
	commandButton.element().focus();
	await expect.element(commandButton).toHaveFocus();
	await userEvent.tab();
	await expect.element(page.getByRole('link', { name: 'Sessions' })).toHaveFocus();

	await expect.element(page.getByRole('link', { name: 'Files' })).toBeInTheDocument();
	await expect.element(page.getByRole('button', { name: 'Hide inspector' })).toBeInTheDocument();
});

test('links rail destinations and marks the current one', async () => {
	await render(ApplicationShellDemo);

	const sessions = page.getByRole('link', { name: 'Sessions' });
	await expect.element(sessions).toHaveAttribute('href', '#sessions');
	await expect.element(sessions).toHaveAttribute('aria-current', 'page');
	await expect.element(page.getByRole('link', { name: 'Files' })).toHaveAttribute('href', '#files');
	await expect.element(page.getByRole('link', { name: 'Files' })).not.toHaveAttribute('aria-current');
});

test('disables destinations that cannot open and explains why', async () => {
	await render(ApplicationShellDemo);

	const settings = page.getByRole('button', { name: 'Settings' });
	await expect.element(settings).toHaveAttribute('aria-disabled', 'true');
	await expect.element(settings).toHaveAccessibleDescription('Coming soon');
	await expect.element(settings).toHaveAttribute('title', 'Settings: Coming soon');
	await expect.element(page.getByRole('link', { name: 'Settings' })).not.toBeInTheDocument();

	const terminal = page.getByRole('button', { name: 'Terminal' });
	await expect.element(terminal).toHaveAccessibleDescription('Open a workspace first');
});

test('shows the Pau mark beside the product name', async () => {
	await render(ApplicationShellDemo);

	expect(document.querySelector('.app-shell__identity svg.app-shell__mark')).not.toBeNull();
	expect(document.querySelector('.app-shell__identity')?.textContent).not.toContain('π');
});
