import { page } from 'vitest/browser';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { diagnosticFixtures } from '../fixtures/diagnostics';
import { mcpConfigurationFixtures } from '../fixtures/mcp';
import { resourceMonitoringFixtures } from '../fixtures/resource-monitoring';
import { sandboxFixtures } from '../fixtures/sandbox';
import DiagnosticsView from '../lib/DiagnosticsView.svelte';
import McpConfigurationView from '../lib/McpConfigurationView.svelte';
import ProcessesView from '../lib/ProcessesView.svelte';
import SandboxSettingsView from '../lib/SandboxSettingsView.svelte';
import SessionResourceSummary from '../lib/SessionResourceSummary.svelte';
import FileEditorDemo from '../stories/FileEditorDemo.svelte';
import '../styles/tokens.css';

/** Resolves a length token to CSS pixels. */
function px(name: string) {
	const probe = document.createElement('div');
	probe.style.width = `var(${name})`;
	document.body.append(probe);
	const width = probe.getBoundingClientRect().width;
	probe.remove();
	return width;
}

/** Every view action uses the shared button: one row height and one text size, whatever its container sets. */
function expectSharedSize(container: HTMLElement, minimum: number) {
	const buttons = [...container.querySelectorAll<HTMLButtonElement>('.pau-button')];
	expect(buttons.length).toBeGreaterThanOrEqual(minimum);
	for (const button of buttons) {
		expect(button.getBoundingClientRect().height, button.textContent ?? '').toBe(px('--pau-size-row-md'));
		expect(getComputedStyle(button).fontSize, button.textContent ?? '').toBe(`${px('--pau-type-md')}px`);
	}
}

test('view actions share the button height and text size', async () => {
	const processes = resourceMonitoringFixtures.active;
	const views = [
		{ view: await render(DiagnosticsView, { bundle: diagnosticFixtures.active }), minimum: 3 },
		{
			view: await render(McpConfigurationView, { configuration: mcpConfigurationFixtures.piConfiguredOff }),
			minimum: 6
		},
		{
			view: await render(ProcessesView, {
				workspaceName: 'Pau',
				processes,
				actions: Object.fromEntries(processes.map((process) => [process.processId, { interrupt: true, stop: true }]))
			}),
			minimum: 6
		},
		{
			view: await render(SessionResourceSummary, {
				snapshot: resourceMonitoringFixtures.active[2],
				actions: { interrupt: true, stop: true }
			}),
			minimum: 2
		},
		{
			view: await render(SandboxSettingsView, {
				selection: sandboxFixtures.referenced,
				effective: sandboxFixtures.referencedEffective
			}),
			minimum: 3
		}
	];
	for (const { view, minimum } of views) expectSharedSize(view.container, minimum);
});

test('editor header and external-change banner buttons use the shared size', async () => {
	const { container } = await render(FileEditorDemo, { state: 'external-change' });
	await page.getByRole('button', { name: 'Check for changes' }).click();
	await expect.element(page.getByText('File changed on disk')).toBeVisible();

	expectSharedSize(container, 4);
});
