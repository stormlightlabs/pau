import { page, userEvent } from 'vitest/browser';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { sessionFixtures } from '../fixtures/sessions';
import ApplicationShell from '../lib/ApplicationShell.svelte';
import SessionView from '../lib/SessionView.svelte';
import ApplicationShellDemo from '../stories/ApplicationShellDemo.svelte';
import ShellBayDemo from '../stories/ShellBayDemo.svelte';
import { THEMES, UI_FONTS, type ThemeName, type UiFontName } from '../theme';

const views = () => page.getByRole('navigation', { name: 'Views' });

test('docks the workspace column in a wide window and the key map hides it', async () => {
	await page.viewport(1440, 900);
	await render(ApplicationShellDemo);

	const column = page.getByRole('complementary', { name: 'Checks' });
	await expect.element(column).toBeVisible();
	expect(page.getByRole('button', { name: 'Show checks' }).elements()).toHaveLength(0);

	await userEvent.keyboard('{Meta>}{Alt>}b{/Alt}{/Meta}');
	await expect.element(column).not.toBeInTheDocument();
});

test('opens the workspace overlay below 1200px and returns focus when it closes', async () => {
	await page.viewport(1000, 800);
	await render(ApplicationShellDemo);

	const overlay = page.getByRole('complementary', { name: 'Checks' });
	await expect.element(overlay).not.toBeInTheDocument();

	const toggle = page.getByRole('button', { name: 'Show checks' });
	await userEvent.click(toggle);
	await expect.element(overlay).toHaveFocus();
	await expect.element(toggle).toHaveAttribute('aria-expanded', 'true');

	await userEvent.keyboard('{Escape}');
	await expect.element(overlay).not.toBeInTheDocument();
	await expect.element(toggle).toHaveFocus();

	await userEvent.click(toggle);
	await userEvent.click(overlay.getByRole('button', { name: 'Close checks' }));
	await expect.element(overlay).not.toBeInTheDocument();
	await expect.element(toggle).toHaveFocus();
});

test('closes the overlay from the scrim and docks the column when the window widens', async () => {
	await page.viewport(1000, 800);
	await render(ApplicationShellDemo);

	await userEvent.click(page.getByRole('button', { name: 'Show checks' }));
	document.querySelector<HTMLButtonElement>('.app-shell__scrim')?.click();
	await expect.element(page.getByRole('complementary', { name: 'Checks' })).not.toBeInTheDocument();

	await page.viewport(1440, 900);
	await expect.element(page.getByRole('complementary', { name: 'Checks' })).toBeVisible();
});

test('keeps a session overlay closed below 1200px until the operator opens it', async () => {
	await page.viewport(1000, 900);
	await render(SessionView, { workspaces: sessionFixtures.running, activeSessionId: 'session-running' });

	await expect.element(page.getByRole('region', { name: 'Transcript' })).toBeVisible();
	await expect.element(page.getByRole('complementary', { name: 'Workspace' })).not.toBeInTheDocument();
	expect(document.querySelector('.app-shell__scrim')).toBeNull();

	await userEvent.click(page.getByRole('button', { name: 'Show workspace' }));
	await expect.element(page.getByRole('complementary', { name: 'Workspace' })).toBeVisible();
});

test('keeps Tab inside the open overlay, with the page behind its scrim inert', async () => {
	await page.viewport(1000, 900);
	await render(SessionView, { workspaces: sessionFixtures.running, activeSessionId: 'session-running' });

	await userEvent.click(page.getByRole('button', { name: 'Show workspace' }));
	const overlay = page.getByRole('complementary', { name: 'Workspace' }).element();
	await expect.element(overlay).toHaveFocus();
	expect(document.getElementById('shell-bay')?.inert).toBe(true);
	expect(document.getElementById('main-surface')?.inert).toBe(true);

	for (let step = 0; step < 20; step += 1) {
		await userEvent.keyboard('{Tab}');
		const focused = document.activeElement;
		expect(focused === document.body || overlay.contains(focused)).toBe(true);
	}

	await userEvent.click(
		page.getByRole('complementary', { name: 'Workspace' }).getByRole('button', { name: 'Close workspace' })
	);
	expect(document.getElementById('main-surface')?.inert).toBe(false);
});

test('keeps the bay and its state when the view changes', async () => {
	await page.viewport(1440, 900);
	const { rerender } = await render(ShellBayDemo, { view: 'files' });

	const bay = page.getByRole('navigation', { name: 'Sessions' });
	await expect.element(page.getByRole('tree', { name: 'pau files' })).toBeVisible();
	await expect.element(bay.getByRole('heading', { name: 'Needs you 4' })).toBeVisible();
	await userEvent.fill(bay.getByRole('searchbox', { name: 'Filter sessions' }), 'audit');
	await expect.element(bay.getByRole('heading', { name: 'Needs you 1' })).toBeVisible();
	const filesBay = bay.element();

	await rerender({ view: 'settings' });
	await expect.element(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
	expect(filesBay.isConnected).toBe(false);
	await expect.element(bay.getByRole('searchbox', { name: 'Filter sessions' })).toHaveValue('audit');
	await expect.element(bay.getByRole('heading', { name: 'Needs you 1' })).toBeVisible();
	// The view's own section column moves beside the bay, into the main surface.
	const main = page.getByRole('main');
	await expect.element(main.getByRole('complementary', { name: 'Sections' })).toBeVisible();
});

test('starts every label in a left column on one edge when only some items have a status', async () => {
	await page.viewport(1440, 900);
	await render(ApplicationShell, {
		contextLabel: 'Sections',
		productItems: [],
		contextItems: [
			{ id: 'running', label: 'Running', href: '#running', status: 'Live' },
			{ id: 'plain', label: 'Plain', href: '#plain' },
			{ id: 'waiting', label: 'Waiting', href: '#waiting', attention: true }
		]
	});

	const column = page.getByRole('complementary', { name: 'Sections' });
	const edges = ['Running', 'Plain', 'Waiting'].map(
		(name) => column.getByText(name, { exact: true }).element().getBoundingClientRect().left
	);
	expect(new Set(edges).size).toBe(1);
});

test('puts six views in the view row, links them, and marks the current one', async () => {
	await render(ApplicationShellDemo);

	await expect.element(views()).toBeVisible();
	expect(views().getByRole('listitem').elements()).toHaveLength(6);
	const sessions = views().getByRole('link', { name: 'Sessions' });
	await expect.element(sessions).toHaveAttribute('href', '#sessions');
	await expect.element(sessions).toHaveAttribute('aria-current', 'page');
	await expect.element(views().getByRole('link', { name: 'Files' })).not.toHaveAttribute('aria-current');
	expect(views().getByRole('link', { name: 'Diagnostics' }).elements()).toHaveLength(0);
});

test('names each view and its shortcut in a tooltip on keyboard focus', async () => {
	await render(ApplicationShellDemo);

	const settings = views().getByRole('link', { name: 'Settings' });
	await expect.element(settings).toHaveAccessibleDescription('Settings ⌘,');
	const tip = document.getElementById('view-settings-tip')!;
	expect(getComputedStyle(tip).display).toBe('none');

	views().getByRole('link', { name: 'Pi resources' }).element().focus();
	await userEvent.tab();
	await expect.element(settings).toHaveFocus();
	expect(getComputedStyle(tip).display).not.toBe('none');
});

test('disables views that cannot open and gives the reason in the tooltip', async () => {
	await render(ApplicationShellDemo);

	const review = views().getByRole('button', { name: 'Review' });
	await expect.element(review).toHaveAttribute('aria-disabled', 'true');
	await expect.element(review).toHaveAccessibleDescription('Review Coming soon');

	const terminal = views().getByRole('button', { name: 'Terminal' });
	await expect.element(terminal).toHaveAccessibleDescription('Terminal Open a workspace first');
});

test('shows the backend connection only while it is down', async () => {
	const { rerender } = await render(ApplicationShellDemo);
	expect(views().getByRole('status').elements()).toHaveLength(0);

	await rerender({ disconnected: true });
	await expect.element(views().getByRole('status')).toHaveTextContent('Disconnected');
});

test('opens the command palette from its shortcut, with no field of its own', async () => {
	await render(ApplicationShellDemo);

	expect(page.getByRole('button', { name: 'Search or run a command' }).elements()).toHaveLength(0);
	await userEvent.keyboard('{Meta>}k{/Meta}');
	await expect.element(page.getByRole('dialog')).toBeVisible();
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
