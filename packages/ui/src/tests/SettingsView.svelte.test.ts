import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { APP_KEY_ACTIONS, resolveKeyActions } from '../lib/keymap.svelte';
import SettingsView, { type SettingsChoices } from '../lib/SettingsView.svelte';
import SettingsViewDemo from '../stories/SettingsViewDemo.svelte';

const left = (element: Element) => element.getBoundingClientRect().left;

type OnChange = <K extends keyof SettingsChoices>(key: K, value: SettingsChoices[K]) => Promise<void>;

function props(overrides: Partial<SettingsChoices> = {}, onChange: OnChange = vi.fn(async () => {})) {
	return {
		theme: 'eldritch',
		uiFont: 'overpass',
		notifications: 'attention',
		motion: 'system',
		...overrides,
		onChange,
		shortcuts: resolveKeyActions(APP_KEY_ACTIONS, 'mac', []),
		platform: 'mac'
	} as const;
}

const failing = () =>
	vi.fn<OnChange>(async () => {
		throw new Error('The Pau backend returned HTTP 500.');
	});

test('links Agent sandbox from the Sandbox summary and Diagnostics from About', async () => {
	await render(SettingsView, {
		...props(),
		sandbox: { workspace: 'pau', summary: 'Sandbox on, network off', href: '/workspaces/pau/sandbox' },
		diagnosticsHref: '/diagnostics'
	});

	await expect.element(page.getByText('Sandbox on, network off.', { exact: false })).toBeVisible();
	await expect
		.element(page.getByRole('link', { name: 'Edit grants in Agent sandbox' }))
		.toHaveAttribute('href', '/workspaces/pau/sandbox');
	await expect.element(page.getByRole('link', { name: 'Open Diagnostics' })).toHaveAttribute('href', '/diagnostics');
});

test('asks for a workspace before it summarizes a sandbox', async () => {
	await render(SettingsView, props());

	await expect.element(page.getByText('Open a workspace to see and edit its sandbox.')).toBeVisible();
	expect(page.getByRole('link', { name: 'Edit grants in Agent sandbox' }).elements()).toHaveLength(0);
});

test('lists every section and names the scope of each setting', async () => {
	await render(SettingsView, props());

	for (const name of ['Appearance', 'Sandbox', 'Notifications', 'Keyboard', 'Editor', 'Shell', 'About']) {
		await expect.element(page.getByRole('heading', { name, level: 2 })).toBeVisible();
	}
	for (const name of ['Theme', 'Font', 'Motion', 'Session notifications']) {
		await expect.element(page.getByRole('radiogroup', { name })).toHaveAccessibleDescription(/Scope: All workspaces/);
	}
	await expect.element(page.getByText('No settings yet.').first()).toBeVisible();
});

test.each([
	['theme', 'Nord', 'nord'],
	['uiFont', 'Inter', 'inter'],
	['motion', 'Reduce', 'reduce'],
	['notifications', 'When a session finishes or needs you', 'all'],
	['notifications', 'Off', 'off']
] as const)('saves a %s change to %s', async (key, label, value) => {
	const onChange = vi.fn<OnChange>(async () => {});
	await render(SettingsView, props({}, onChange));

	await userEvent.click(page.getByRole('radio', { name: label, exact: true }));

	expect(onChange).toHaveBeenCalledWith(key, value);
	await expect.element(page.getByRole('radio', { name: label, exact: true })).toBeChecked();
	await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
});

test('shows each font in its own typeface', async () => {
	await render(SettingsView, props());

	const label = page.getByText('Atkinson Hyperlegible Next', { exact: true }).element();
	expect(getComputedStyle(label).fontFamily).toContain('Atkinson Hyperlegible Next Variable');
});

test('keeps the previous choice and explains a failed save', async () => {
	const onChange = failing();
	await render(SettingsView, props({ motion: 'full' }, onChange));

	await userEvent.click(page.getByRole('radio', { name: 'Reduce' }));

	await expect
		.element(page.getByRole('alert'))
		.toHaveTextContent('Pau could not save this setting. The Pau backend returned HTTP 500.');
	await expect.element(page.getByRole('radio', { name: 'Full' })).toBeChecked();
	await expect.element(page.getByRole('radio', { name: 'Reduce' })).not.toBeChecked();

	onChange.mockResolvedValueOnce(undefined);
	await userEvent.click(page.getByRole('radio', { name: 'System' }));
	await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
});

test('keeps the saved notification policy and explains a failed save under it', async () => {
	await render(SettingsView, props({}, failing()));

	await userEvent.click(page.getByRole('radio', { name: 'Off' }));

	const section = page.getByRole('region', { name: 'Notifications' });
	await expect.element(section.getByRole('alert')).toHaveTextContent('The Pau backend returned HTTP 500.');
	await expect.element(page.getByRole('radio', { name: 'When a session needs you' })).toBeChecked();
	await expect.element(page.getByRole('radio', { name: 'Off' })).not.toBeChecked();
});

test('keeps the saved theme and font when their saves fail', async () => {
	await render(SettingsView, props({ theme: 'iceberg', uiFont: 'inter' }, failing()));

	await userEvent.click(page.getByRole('radio', { name: 'Nord' }));
	await userEvent.click(page.getByRole('radio', { name: 'IBM Plex Sans' }));

	await expect.element(page.getByRole('radio', { name: 'Iceberg' })).toBeChecked();
	await expect.element(page.getByRole('radio', { name: 'Inter', exact: true })).toBeChecked();
	expect(page.getByRole('alert').elements()).toHaveLength(2);
});

test('keeps a later choice when an earlier save fails', async () => {
	let saved: SettingsChoices['motion'] = 'full';
	const firstSave = Promise.withResolvers<void>();
	const onChange = vi.fn<OnChange>();
	onChange.mockReturnValueOnce(firstSave.promise);
	onChange.mockImplementationOnce(async (_key, value) => {
		saved = value as SettingsChoices['motion'];
	});
	await render(SettingsView, props({ motion: 'full' }, onChange));

	await userEvent.click(page.getByRole('radio', { name: 'Reduce' }));
	await userEvent.click(page.getByRole('radio', { name: 'System' }));
	firstSave.reject(new Error('The Pau backend returned HTTP 500.'));

	await expect.element(page.getByRole('radio', { name: 'System' })).toBeChecked();
	await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
	expect(saved).toBe('system');
});

test('lists every shortcut with its chord and where it works', async () => {
	await render(SettingsView, props());
	const keyboard = page.getByRole('region', { name: 'Keyboard' });

	for (const action of APP_KEY_ACTIONS) {
		await expect.element(keyboard.getByText(action.label, { exact: true })).toBeVisible();
	}
	const row = (label: string) => keyboard.getByRole('listitem').filter({ hasText: label });
	await expect.element(row('Open settings')).toHaveTextContent(/Scope: All views\s*⌘,/);
	await expect.element(row('New session')).toHaveTextContent(/Scope: Sessions\s*⌘N/);
	await expect.element(row('Focus the composer')).toHaveTextContent(/Scope: Sessions, not while typing\s*⌘L/);
	await expect.element(row('Go back')).toHaveTextContent(/Scope: All views, not while typing/);
	await expect.element(row('Zoom in')).toHaveTextContent(/Scope: Desktop app/);
	expect(keyboard.getByRole('radio').elements()).toHaveLength(0);
});

test('notes a shortcut that gives its chord to a Pi binding', async () => {
	await render(SettingsViewDemo, { piBindings: [{ action: 'app.session.toggleNamedFilter', keys: ['cmd+n'] }] });
	const keyboard = page.getByRole('region', { name: 'Keyboard' });

	await expect
		.element(keyboard.getByRole('listitem').filter({ hasText: 'New session' }))
		.toHaveTextContent('Pi uses ⌘N to show only named sessions');
});

test('applies a theme picked in the shell it sits in', async () => {
	await render(SettingsViewDemo);

	await userEvent.click(page.getByRole('radio', { name: 'Vitesse Dark' }));

	await expect.element(page.getByRole('radio', { name: 'Vitesse Dark' })).toBeChecked();
	await vi.waitFor(() =>
		expect(document.querySelector<HTMLElement>('[data-theme]')?.dataset.theme).toBe('vitesse-dark')
	);
});

test.each([1440, 900])('starts the title, section headings, and setting names on one edge at %ipx', async (width) => {
	await page.viewport(width, 900);
	await render(SettingsViewDemo);

	const title = left(page.getByRole('heading', { name: 'Settings', level: 1 }).element());
	expect(left(page.getByRole('heading', { name: 'Appearance', level: 2 }).element())).toBe(title);
	for (const name of ['Theme', 'Font', 'Motion', 'Session notifications']) {
		expect(left(page.getByText(name, { exact: true }).element())).toBe(title);
	}
	expect(left(page.getByRole('heading', { name: 'General', level: 3 }).element())).toBe(title);
	expect(left(page.getByText('No settings yet.').first().element())).toBe(title);
});

test('moves focus to the chosen section from the section list in a narrow window', async () => {
	await page.viewport(1000, 800);
	await render(SettingsViewDemo);

	await userEvent.click(page.getByRole('complementary', { name: 'Sections' }).getByRole('link', { name: 'Shell' }));
	await expect.element(page.getByRole('region', { name: 'Shell' })).toHaveFocus();
});
