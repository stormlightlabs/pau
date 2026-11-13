import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import SettingsView from '../lib/SettingsView.svelte';
import type { MotionSetting } from '../motion';
import SettingsViewDemo from '../stories/SettingsViewDemo.svelte';

const left = (element: Element) => element.getBoundingClientRect().left;

test('lists every section and names the scope of each setting', async () => {
	await render(SettingsView, { motion: 'system', onMotionChange: vi.fn() });

	for (const name of ['Appearance', 'Notifications', 'Keyboard', 'Editor', 'Shell']) {
		await expect.element(page.getByRole('heading', { name, level: 2 })).toBeVisible();
	}
	const motion = page.getByRole('radiogroup', { name: 'Motion' });
	await expect.element(motion).toHaveAccessibleDescription(/All workspaces/);
	await expect.element(page.getByText('No settings yet.').first()).toBeVisible();
});

test('saves a change', async () => {
	const onMotionChange = vi.fn(async () => {});
	await render(SettingsView, { motion: 'system', onMotionChange });

	await userEvent.click(page.getByRole('radio', { name: 'Reduce' }));

	expect(onMotionChange).toHaveBeenCalledWith('reduce');
	await expect.element(page.getByRole('radio', { name: 'Reduce' })).toBeChecked();
	await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
});

test('keeps the previous choice and explains a failed save', async () => {
	const onMotionChange = vi.fn<(value: MotionSetting) => Promise<void>>(async () => {
		throw new Error('The Pau backend returned HTTP 500.');
	});
	await render(SettingsView, { motion: 'full', onMotionChange });

	await userEvent.click(page.getByRole('radio', { name: 'Reduce' }));

	await expect
		.element(page.getByRole('alert'))
		.toHaveTextContent('Pau could not save this setting. The Pau backend returned HTTP 500.');
	await expect.element(page.getByRole('radio', { name: 'Full' })).toBeChecked();
	await expect.element(page.getByRole('radio', { name: 'Reduce' })).not.toBeChecked();

	onMotionChange.mockResolvedValueOnce(undefined);
	await userEvent.click(page.getByRole('radio', { name: 'System' }));
	await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
});

test.each([1440, 900])('starts the title, section headings, and setting names on one edge at %ipx', async (width) => {
	await page.viewport(width, 900);
	await render(SettingsViewDemo);

	const title = left(page.getByRole('heading', { name: 'Settings', level: 1 }).element());
	expect(left(page.getByRole('heading', { name: 'Appearance', level: 2 }).element())).toBe(title);
	expect(left(page.getByText('Motion', { exact: true }).element())).toBe(title);
	expect(left(page.getByText('No settings yet.').first().element())).toBe(title);
});

test('closes the narrow section menu and moves focus to the chosen section', async () => {
	await page.viewport(360, 800);
	await render(SettingsViewDemo);
	const toggle = page.getByRole('button', { name: 'Open navigation' });

	await userEvent.click(toggle);
	await userEvent.click(page.getByRole('complementary', { name: 'Sections' }).getByRole('link', { name: 'Shell' }));

	await expect.element(toggle).toHaveAttribute('aria-expanded', 'false');
	await expect.element(page.getByRole('region', { name: 'Shell' })).toHaveFocus();
});
