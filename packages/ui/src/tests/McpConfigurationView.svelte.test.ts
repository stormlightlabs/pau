import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { mcpConfigurationFixtures } from '../fixtures/mcp';
import McpConfigurationView from '../lib/McpConfigurationView.svelte';

test('keeps native configuration visible while Pau-managed MCP is off', async () => {
	const onEnable = vi.fn();
	await render(McpConfigurationView, { configuration: mcpConfigurationFixtures.piConfiguredOff, onEnable });

	await expect.element(page.getByText('Pau-managed MCP off')).toBeVisible();
	await expect
		.element(page.getByText('Native Pi MCP remains active. Pau does not change that configuration.'))
		.toBeVisible();
	await userEvent.click(page.getByRole('button', { name: 'Enable for this workspace' }));
	expect(onEnable).toHaveBeenCalledOnce();
});

test('offers the recovery action when the Pi package is absent', async () => {
	const onResolve = vi.fn();
	await render(McpConfigurationView, { configuration: mcpConfigurationFixtures.piAbsent, onResolve });

	await expect.element(page.getByRole('status')).toHaveTextContent('pi-mcp-adapter is not installed');
	await userEvent.click(page.getByRole('button', { name: 'Review install command' }));
	expect(onResolve).toHaveBeenCalledOnce();
});
