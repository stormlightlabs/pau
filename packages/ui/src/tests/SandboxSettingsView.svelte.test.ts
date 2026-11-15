import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { sandboxFixtures } from '../fixtures/sandbox';
import SandboxSettingsView from '../lib/SandboxSettingsView.svelte';
import { applyTheme } from './apply-theme';

test('starts unsandboxed and keeps permission prompts separate from the sandbox', async () => {
	await render(SandboxSettingsView, { selection: sandboxFixtures.unsandboxed });

	await expect.element(page.getByText('Sandbox off')).toBeVisible();
	await expect.element(page.getByRole('radio', { name: /Unsandboxed/ })).toBeChecked();
	await expect.element(page.getByText(/Permission prompts decide when an agent asks/)).toBeVisible();
	await expect.element(page.getByText(/Terminals and editors stay unsandboxed/)).toBeVisible();
	await expect.element(page.getByRole('group', { name: 'Grants' })).not.toBeInTheDocument();
});

test('edits a profile and its grants before saving', async () => {
	const onChange = vi.fn();
	const onSave = vi.fn();
	await render(SandboxSettingsView, { selection: sandboxFixtures.unsandboxed, onChange, onSave });

	await userEvent.click(page.getByRole('radio', { name: /Sandboxed/ }));
	await userEvent.click(page.getByRole('radio', { name: /Read only/ }));
	await userEvent.fill(
		page.getByRole('textbox', { name: /Network destinations/ }),
		'registry.npmjs.org\n\n *.example.com '
	);
	await userEvent.click(page.getByRole('textbox', { name: /Extra writable directories/ }));
	await expect.element(page.getByText(/Recommended while a network destination is granted/)).toBeVisible();
	await userEvent.click(page.getByRole('checkbox', { name: /Block reads from the home directory/ }));
	await userEvent.fill(page.getByRole('textbox', { name: /Tools allowed outside the sandbox/ }), 'web_search');
	await userEvent.click(page.getByRole('button', { name: 'Save workspace default' }));

	expect(onSave).toHaveBeenCalledWith({
		mode: 'sandboxed',
		settings: {
			profile: 'read-only',
			grants: { domains: ['registry.npmjs.org', '*.example.com'], writableRoots: [], unixSockets: false },
			homeReadDeny: true,
			shareClaudeTemp: false,
			unsandboxedTools: ['web_search'],
			credentialReferences: []
		}
	});
	expect(onChange).toHaveBeenCalledTimes(5);
});

test('shows an empty credential-reference state', async () => {
	await render(SandboxSettingsView, { selection: sandboxFixtures.workspaceWrite });

	await expect.element(page.getByText('No credential references.')).toBeVisible();
	await expect.element(page.getByRole('button', { name: 'Add credential reference' })).toBeVisible();
});

test('adds, edits, and removes valid credential references', async () => {
	const onChange = vi.fn();
	const onSave = vi.fn();
	await render(SandboxSettingsView, { selection: sandboxFixtures.referenced, onChange, onSave });

	await expect.element(page.getByRole('textbox', { name: /Source environment variable/ })).toHaveValue('PACKAGE_TOKEN');
	await userEvent.fill(page.getByRole('textbox', { name: /Source environment variable/ }), 'NPM_TOKEN');
	await userEvent.click(page.getByRole('combobox', { name: 'Value shape' }));
	await userEvent.click(page.getByRole('option', { name: 'Password in a URL' }));
	await userEvent.fill(page.getByRole('textbox', { name: /TLS destinations/ }), 'registry.npmjs.org\n*.npmjs.org:443');
	await userEvent.tab();
	await userEvent.click(page.getByRole('button', { name: 'Add credential reference' }));
	await expect.element(page.getByRole('group', { name: 'Credential 2' })).toBeVisible();
	await userEvent.click(page.getByRole('button', { name: 'Remove credential' }).last());
	await userEvent.click(page.getByRole('button', { name: 'Save workspace default' }));

	expect(onSave).toHaveBeenCalledWith({
		mode: 'sandboxed',
		settings: {
			...sandboxFixtures.referenced.settings,
			credentialReferences: [
				{ source: 'NPM_TOKEN', shape: 'url-password', destinations: ['registry.npmjs.org', '*.npmjs.org:443'] }
			]
		}
	});
});

test('shows a missing credential source error without losing its destination', async () => {
	await render(SandboxSettingsView, {
		selection: sandboxFixtures.missingCredentialSource,
		error: '"" is not an environment variable name'
	});

	await expect.element(page.getByRole('textbox', { name: /Source environment variable/ })).toHaveValue('');
	await expect.element(page.getByRole('textbox', { name: /TLS destinations/ })).toHaveValue('registry.example.com');
	await expect.element(page.getByRole('alert')).toHaveTextContent('is not an environment variable name');
});

test('shows an invalid credential destination without losing the reference', async () => {
	await render(SandboxSettingsView, {
		selection: sandboxFixtures.invalidCredentialDestination,
		error: '"https://registry.example.com/token" is not a host or host:port'
	});

	await expect.element(page.getByRole('textbox', { name: /Source environment variable/ })).toHaveValue('PACKAGE_TOKEN');
	await expect
		.element(page.getByRole('textbox', { name: /TLS destinations/ }))
		.toHaveValue('https://registry.example.com/token');
	await expect.element(page.getByRole('alert')).toHaveTextContent('is not a host or host:port');
});

test('names the effective access, disabled tools, placeholders, and gaps', async () => {
	await render(SandboxSettingsView, {
		selection: sandboxFixtures.granted,
		effective: sandboxFixtures.grantedEffective
	});

	await expect.element(page.getByRole('heading', { name: 'Effective access for Pi' })).toBeVisible();
	await expect.element(page.getByText(/Bubblewrap 0.12.0/)).toBeVisible();
	await expect.element(page.getByText('(this computer or a private network)')).toBeVisible();
	await expect.element(page.getByText('Tools from other Pi extensions')).toBeVisible();
	await expect.element(page.getByText('web_search')).toBeVisible();
	await expect.element(page.getByText(/File and Git views hide them/)).toBeVisible();
	await expect.element(page.getByText(/Unix sockets cannot be filtered by path/)).toBeVisible();
	await expect.element(page.getByText('No credential is brokered.', { exact: false })).toBeVisible();
});

test('shows one brokered credential and its permitted destination', async () => {
	await render(SandboxSettingsView, {
		selection: sandboxFixtures.referenced,
		effective: sandboxFixtures.referencedEffective
	});

	await expect.element(page.getByRole('list', { name: 'Brokered credential destinations' })).toBeVisible();
	await expect.element(page.getByText('PACKAGE_TOKEN', { exact: true })).toBeVisible();
	await expect.element(page.getByText('registry.example.com', { exact: true })).toBeVisible();
	await expect.element(page.getByText(/can use a brokered credential on your behalf or return it/)).toBeVisible();
});

test('shows every destination for each brokered credential', async () => {
	await render(SandboxSettingsView, {
		selection: sandboxFixtures.referenced,
		effective: sandboxFixtures.severalBrokeredDestinationsEffective
	});

	for (const value of [
		'PACKAGE_TOKEN',
		'registry.example.com',
		'*.packages.example.com:443',
		'DEPLOY_TOKEN',
		'deploy.example.com'
	]) {
		await expect.element(page.getByText(value, { exact: true })).toBeVisible();
	}
});

test('warns on an unverified platform and blocks the sandbox where none can start', async () => {
	const { rerender } = await render(SandboxSettingsView, {
		selection: sandboxFixtures.workspaceWrite,
		effective: sandboxFixtures.macosEffective
	});
	await expect.element(page.getByText("Pau has not verified this platform's sandbox.")).toBeVisible();

	await rerender({
		selection: sandboxFixtures.unsandboxed,
		effective: undefined,
		unavailable: sandboxFixtures.unavailable
	});
	await expect.element(page.getByRole('radio', { name: /Sandboxed/ })).toBeDisabled();
	await expect.element(page.getByText(/Unavailable on this computer: bwrap was not found/)).toBeVisible();
});

test('offers the workspace default for a session override and reports errors', async () => {
	const onUseWorkspaceDefault = vi.fn();
	await render(SandboxSettingsView, {
		selection: sandboxFixtures.workspaceWrite,
		scope: 'session',
		error: 'writable root /home contains the home directory',
		onUseWorkspaceDefault
	});

	await expect.element(page.getByText('This session only')).toBeVisible();
	await expect.element(page.getByRole('alert')).toHaveTextContent('contains the home directory');
	await userEvent.click(page.getByRole('button', { name: 'Use workspace default' }));
	expect(onUseWorkspaceDefault).toHaveBeenCalledOnce();
	await expect.element(page.getByRole('button', { name: 'Apply to this session' })).toBeVisible();
});

test('shows the sandbox mode as the same chip as the other mode indicators', async () => {
	applyTheme();
	await render(SandboxSettingsView, { selection: sandboxFixtures.unsandboxed });

	await expect.element(page.getByText('Sandbox off')).toBeVisible();
	expect(page.getByText('Sandbox off').element().closest('.pau-chip')).not.toBeNull();
});
