import { Keymap, keymapContext } from '@stormlightlabs/pau-ui';
import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { PauApiError } from '$lib/api';
import SettingsPage from './+page.svelte';

vi.mock('$app/state', () => ({ page: { params: {}, route: { id: '/settings' } } }));

vi.mock('$lib/api', async (importOriginal) => ({
	...(await importOriginal<object>()),
	listWorkspaces: async () => [],
	getUiPreferences: async () => ({
		version: 1,
		theme: 'eldritch',
		ui_font: 'overpass',
		notifications: 'attention',
		motion: 'system',
		pane_widths: { context_rail: null, inspector: null },
		last_route: null
	}),
	updateUiPreferences: async () => {
		throw new PauApiError('The database is read-only.', 500);
	}
}));

test('marks Settings in the rail and links each section', async () => {
	await page.viewport(1440, 900);
	await render(SettingsPage);

	await expect.element(page.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
	const sections = page.getByRole('complementary', { name: 'Sections' });
	await expect.element(sections.getByRole('link', { name: 'Keyboard' })).toHaveAttribute('href', '#settings-keyboard');
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

test('lists the app shortcuts in the Keyboard section', async () => {
	await render(SettingsPage, { context: new Map([[keymapContext, new Keymap({ platform: 'mac' })]]) });

	const keyboard = page.getByRole('region', { name: 'Keyboard' });
	await expect.element(keyboard.getByText('Show keyboard shortcuts', { exact: true })).toBeVisible();
});
