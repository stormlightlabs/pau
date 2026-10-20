import { page } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import ProcessesPage from './+page.svelte';

vi.mock('$app/state', () => ({
	page: { params: { workspaceId: 'pau' }, route: { id: '/workspaces/[workspaceId]/processes' } }
}));

vi.mock('$lib/api', () => ({ listWorkspaces: async () => [{ id: 'pau', name: 'Pau', path: '/src/pau' }] }));

test('shows processes inside the application shell without sample data', async () => {
	await page.viewport(800, 560);
	await render(ProcessesPage);

	const rail = page.getByRole('navigation', { name: 'Product' });
	await expect.element(rail).toBeVisible();
	await expect.element(page.getByRole('banner')).toBeVisible();
	await expect.element(rail.getByLabelText('Processes', { exact: true })).toHaveAttribute('aria-current', 'page');

	await expect.element(page.getByRole('heading', { name: "Process monitoring isn't available" })).toBeVisible();
	expect(page.getByRole('table').elements()).toHaveLength(0);

	const main = document.querySelector<HTMLElement>('#main-surface')!;
	expect(main.scrollWidth).toBe(main.clientWidth);
});
