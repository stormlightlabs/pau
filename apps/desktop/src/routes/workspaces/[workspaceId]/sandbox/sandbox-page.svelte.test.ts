import { sandboxFixtures } from '@stormlightlabs/pau-ui';
import { page } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { selectionWire } from '$lib/sandbox-model';
import SandboxPage from './+page.svelte';

vi.mock('$app/state', () => ({
	page: { params: { workspaceId: 'pau' }, route: { id: '/workspaces/[workspaceId]/sandbox' } }
}));

vi.mock('$lib/api', () => ({
	listWorkspaces: async () => [],
	getWorkspaceSandbox: async () => ({ selection: selectionWire(sandboxFixtures.granted) }),
	previewSandbox: async () => null,
	updateWorkspaceSandbox: async () => ({ selection: selectionWire(sandboxFixtures.granted) })
}));

/** Resolves a theme color token inside the shell, where the theme defines it. */
function shellColor(name: string): string {
	const probe = document.createElement('span');
	probe.style.color = `var(${name})`;
	document.querySelector('#main-surface')!.append(probe);
	const value = getComputedStyle(probe).color;
	probe.remove();
	return value;
}

test('draws settings fields with the theme border and fits a minimum-size window', async () => {
	await page.viewport(800, 560);
	await render(SandboxPage);
	const field = page.getByRole('textbox', { name: /Network destinations/ });
	await expect.element(field).toBeVisible();

	expect(getComputedStyle(field.element()).borderTopColor).toBe(shellColor('--pau-border'));

	const main = document.querySelector<HTMLElement>('#main-surface')!;
	expect(main.scrollWidth).toBe(main.clientWidth);
	const chip = page.getByText('Sandbox on').element().getBoundingClientRect();
	expect(chip.right).toBeLessThanOrEqual(main.getBoundingClientRect().right);

	const checkbox = page.getByRole('checkbox', { name: /Block reads from the home directory/ }).element();
	const label = checkbox.nextElementSibling!.getBoundingClientRect();
	expect(label.left - checkbox.getBoundingClientRect().right).toBe(8);
});
