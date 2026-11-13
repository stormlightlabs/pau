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
		motion: 'system',
		pane_widths: { context_rail: null, inspector: null }
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
