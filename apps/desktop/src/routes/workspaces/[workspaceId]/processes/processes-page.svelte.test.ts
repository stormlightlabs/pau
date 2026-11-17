import { page } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import ProcessesPage from './+page.svelte';

vi.mock('$app/state', () => ({
	page: { params: { workspaceId: 'pau' }, route: { id: '/workspaces/[workspaceId]/processes' } }
}));

test('shows processes inside the application shell without sample data', async () => {
	await page.viewport(900, 560);
	await render(ProcessesPage);

	await expect.element(page.getByRole('navigation', { name: 'Views' })).toBeVisible();
	await expect.element(page.getByRole('heading', { name: 'Processes', level: 1 })).toBeVisible();

	await expect.element(page.getByRole('heading', { name: "Process monitoring isn't available" })).toBeVisible();
	expect(page.getByRole('table').elements()).toHaveLength(0);

	const main = document.querySelector<HTMLElement>('#main-surface')!;
	expect(main.scrollWidth).toBe(main.clientWidth);
});
