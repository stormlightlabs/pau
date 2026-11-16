import { Keymap, keymapContext } from '@stormlightlabs/pau-ui';
import { page, userEvent } from 'vitest/browser';
import { beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { PauApiError } from '$lib/api';
import SettingsPage from './+page.svelte';

/** Saves fail at once unless a test holds one back. */
const updateUiPreferences = vi.hoisted(() =>
	vi.fn(async (): Promise<never> => {
		throw new Error('unset');
	})
);

const listWorkspaces = vi.hoisted(() => vi.fn(async (): Promise<{ id: string }[]> => []));

vi.mock('$app/state', () => ({ page: { params: {}, route: { id: '/settings' } } }));

vi.mock('$lib/api', async (importOriginal) => ({
	...(await importOriginal<object>()),
	listWorkspaces,
	getUiPreferences: async () => ({
		version: 1,
		theme: 'eldritch',
		ui_font: 'overpass',
		notifications: 'attention',
		motion: 'system',
		pane_widths: { context_rail: null, inspector: null },
		last_route: null
	}),
	updateUiPreferences
}));

beforeEach(() => {
	updateUiPreferences.mockImplementation(async () => {
		throw new PauApiError('The database is read-only.', 500);
	});
});

test('marks Settings in the rail and links each section', async () => {
	await page.viewport(1440, 900);
	await render(SettingsPage);

	await expect.element(page.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
	const sections = page.getByRole('complementary', { name: 'Sections' });
	await expect.element(sections.getByRole('link', { name: 'Keyboard' })).toHaveAttribute('href', '#settings-keyboard');
});

test('links Agent sandbox for the first workspace and Diagnostics from About', async () => {
	listWorkspaces.mockResolvedValueOnce([{ id: 'workspace-1' }]);
	await render(SettingsPage);

	await expect
		.element(page.getByRole('link', { name: 'Edit grants in Agent sandbox' }))
		.toHaveAttribute('href', '/workspaces/workspace-1/sandbox');
	await expect.element(page.getByRole('link', { name: 'Open Diagnostics' })).toHaveAttribute('href', '/diagnostics');
});

test('shows a failed save and keeps the saved motion setting', async () => {
	await render(SettingsPage);

	await userEvent.click(page.getByRole('radio', { name: 'Reduce' }));

	await expect.element(page.getByRole('alert')).toHaveTextContent('The database is read-only.');
	await expect.element(page.getByRole('radio', { name: 'System' })).toBeChecked();
	expect(document.documentElement.dataset.motion).toBeUndefined();
});

test('shows a failed notification save and keeps the saved policy', async () => {
	await render(SettingsPage);

	await userEvent.click(page.getByRole('radio', { name: 'Off' }));

	await expect.element(page.getByRole('alert')).toHaveTextContent('The database is read-only.');
	await expect.element(page.getByRole('radio', { name: 'When a session needs you' })).toBeChecked();
});

test('shows both failures when a theme save and a queued font save fail', async () => {
	const themeSave = Promise.withResolvers<never>();
	updateUiPreferences.mockReturnValueOnce(themeSave.promise);
	await render(SettingsPage);

	await userEvent.click(page.getByRole('radio', { name: 'Nord' }));
	await userEvent.click(page.getByRole('radio', { name: 'Inter', exact: true }));
	themeSave.reject(new PauApiError('The database is read-only.', 500));

	await expect.poll(() => page.getByRole('alert').elements()).toHaveLength(2);
	await expect.element(page.getByRole('radio', { name: 'Eldritch' })).toBeChecked();
	await expect.element(page.getByRole('radio', { name: 'Overpass', exact: true })).toBeChecked();
});

test('lists the app shortcuts in the Keyboard section', async () => {
	await render(SettingsPage, { context: new Map([[keymapContext, new Keymap({ platform: 'mac' })]]) });

	const keyboard = page.getByRole('region', { name: 'Keyboard' });
	await expect.element(keyboard.getByText('Show keyboard shortcuts', { exact: true })).toBeVisible();
});
