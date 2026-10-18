import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { diagnosticFixtures } from '../fixtures/diagnostics';
import DiagnosticsView from '../lib/DiagnosticsView.svelte';
import { applyTheme } from './apply-theme';

test('shows versions, handshakes, replay state, pressure, and correlated records', async () => {
	await render(DiagnosticsView, { bundle: diagnosticFixtures.active });

	await expect.element(page.getByText('0.8.8')).toBeVisible();
	await expect.element(page.getByText('prompt', { exact: false }).first()).toBeVisible();
	await expect.element(page.getByRole('cell', { name: '842' })).toBeVisible();
	await expect.element(page.getByText('event.replay_gap')).toBeVisible();
	await expect.element(page.getByText(/sequence=842/)).toBeVisible();
});

test('changes release-safe settings and starts bounded tracing explicitly', async () => {
	const onSettingsChange = vi.fn();
	const onStartPayloadTracing = vi.fn();
	await render(DiagnosticsView, { bundle: diagnosticFixtures.active, onSettingsChange, onStartPayloadTracing });

	await userEvent.click(page.getByRole('combobox', { name: 'Minimum log level' }));
	await userEvent.click(page.getByRole('option', { name: 'Warning' }));
	expect(onSettingsChange).toHaveBeenCalledWith(true, 'warn');
	await userEvent.click(page.getByRole('button', { name: 'Trace for 5 minutes' }));
	expect(onStartPayloadTracing).toHaveBeenCalledWith(300);
});

test('requires bundle review before export and passes the reviewed revision', async () => {
	const onExport = vi.fn();
	await render(DiagnosticsView, { bundle: diagnosticFixtures.active, onExport });

	const exportButton = page.getByRole('button', { name: 'Export reviewed bundle' });
	await expect.element(exportButton).toBeDisabled();
	await userEvent.click(page.getByRole('button', { name: 'Review bundle' }));
	await expect.element(page.getByText(/Excludes credentials, environment values, prompts/)).toBeVisible();
	await userEvent.click(exportButton);
	expect(onExport).toHaveBeenCalledWith('pau-diagnostics.json', 48);
});

test('shows the explicit control and CLI flag while collection is off', async () => {
	await render(DiagnosticsView, { bundle: diagnosticFixtures.disabled });

	await expect.element(page.getByRole('heading', { name: 'Collection is off' })).toBeVisible();
	await expect.element(page.getByText('--diagnostics')).toBeVisible();
	await expect.element(page.getByRole('combobox', { name: 'Minimum log level' })).toBeDisabled();
});

test('insets the header by the same padding as the first section', async () => {
	const { container } = await render(DiagnosticsView, { bundle: diagnosticFixtures.active });

	const header = container.querySelector('header')!;
	const section = container.querySelector('.diagnostics-view__settings')!;
	expect(getComputedStyle(header).paddingLeft).toBe(getComputedStyle(section).paddingLeft);
	expect(getComputedStyle(header).paddingLeft).not.toBe('0px');
	expect(getComputedStyle(header).paddingRight).toBe(getComputedStyle(header).paddingLeft);
});

test('stacks records and shows transport rows as metric blocks in a 600px main column', async () => {
	const { container } = await render(DiagnosticsView, { bundle: diagnosticFixtures.active });
	container.style.width = '600px';

	const metadata = [...container.querySelectorAll<HTMLElement>(':scope .diagnostics-view__records small')];
	expect(metadata.length).toBeGreaterThan(0);
	for (const detail of metadata) {
		expect(detail.scrollWidth).toBeLessThanOrEqual(detail.clientWidth);
		expect(getComputedStyle(detail).textOverflow).not.toBe('ellipsis');
	}
	const record = container.querySelector(':scope .diagnostics-view__records li')!;
	expect(getComputedStyle(record).gridTemplateColumns.split(' ')).toHaveLength(1);
	const heading = container.querySelector('.diagnostics-view__transport-heading')!;
	expect(getComputedStyle(heading).display).toBe('none');
	const row = container.querySelector(
		':scope .diagnostics-view__transport > div:not(.diagnostics-view__transport-heading)'
	)!;
	expect(getComputedStyle(row).gridTemplateColumns.split(' ')).toHaveLength(2);
});

test('labels the log level as normal text and shows the mode as an outlined chip', async () => {
	applyTheme();
	await render(DiagnosticsView, { bundle: diagnosticFixtures.active });

	const label = getComputedStyle(page.getByText('Minimum log level').element());
	expect(label.color).toBe(getComputedStyle(page.getByText('Enable diagnostics').element()).color);
	await expect.element(page.getByText('Diagnostics mode on')).toBeVisible();
	expect(getComputedStyle(page.getByText('Diagnostics mode on').element()).borderTopStyle).toBe('solid');
});
