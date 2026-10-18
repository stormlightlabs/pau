import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { mcpConfigurationFixtures } from '../fixtures/mcp';
import McpConfigurationView from '../lib/McpConfigurationView.svelte';
import { applyTheme } from './apply-theme';

test('keeps native configuration visible while Pau-managed MCP is off', async () => {
	applyTheme();
	const onEnable = vi.fn();
	await render(McpConfigurationView, { configuration: mcpConfigurationFixtures.piConfiguredOff, onEnable });

	const state = page.getByText('Pau-managed MCP off');
	await expect.element(state).toBeVisible();
	// Off is neutral, so it uses the muted text color.
	const muted = document.createElement('span');
	muted.style.color = 'var(--pau-text-muted)';
	document.body.append(muted);
	expect(getComputedStyle(state.element()).color).toBe(getComputedStyle(muted).color);
	muted.remove();
	await expect.element(page.getByText('Not connected', { exact: true })).toBeVisible();
	await expect.element(page.getByText('Connected', { exact: true })).toBeVisible();
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

test('edits, disables, tests, removes, and creates a selected server', async () => {
	const handlers = { onCreate: vi.fn(), onEdit: vi.fn(), onRemove: vi.fn(), onToggle: vi.fn(), onTest: vi.fn() };
	await render(McpConfigurationView, { configuration: mcpConfigurationFixtures.piConfiguredOff, ...handlers });

	await userEvent.click(page.getByRole('button', { name: /linear user http connected/i }));
	await expect.element(page.getByText('tools, resources, elicitation')).toBeVisible();
	await userEvent.click(page.getByRole('button', { name: 'Edit' }));
	await userEvent.click(page.getByRole('button', { name: 'Disable', exact: true }));
	await userEvent.click(page.getByRole('button', { name: 'Test connection' }));
	await userEvent.click(page.getByRole('button', { name: 'Remove server' }));
	await userEvent.click(page.getByRole('button', { name: 'Add server' }));

	expect(handlers.onEdit).toHaveBeenCalledWith('linear');
	expect(handlers.onToggle).toHaveBeenCalledWith('linear', false);
	expect(handlers.onTest).toHaveBeenCalledWith('linear');
	expect(handlers.onRemove).toHaveBeenCalledWith('linear');
	expect(handlers.onCreate).toHaveBeenCalledOnce();
});

test('offers native authentication and reports a startup failure', async () => {
	const onAuthenticate = vi.fn();
	await render(McpConfigurationView, { configuration: mcpConfigurationFixtures.claudeConfiguredOff, onAuthenticate });

	await expect.element(page.getByText('Sign in before testing this server.')).toBeVisible();
	await userEvent.click(page.getByRole('button', { name: 'Authenticate' }));
	expect(onAuthenticate).toHaveBeenCalledWith('github');

	await userEvent.click(page.getByRole('button', { name: /database project stdio failed/i }));
	await expect.element(page.getByText('The server did not finish startup before the timeout.')).toBeVisible();
});
