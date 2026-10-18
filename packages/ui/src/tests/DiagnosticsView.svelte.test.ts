import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { diagnosticFixtures } from '../fixtures/diagnostics';
import DiagnosticsView from '../lib/DiagnosticsView.svelte';

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
