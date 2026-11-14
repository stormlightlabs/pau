import { page } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import ResourcesPage from './+page.svelte';

const state = vi.hoisted(() => ({
	params: { workspaceId: 'pau', kind: 'prompts' as string | undefined },
	fail: false
}));

vi.mock('$app/state', () => ({
	page: { params: state.params, route: { id: '/workspaces/[workspaceId]/resources/[[kind]]' } }
}));

vi.mock('$lib/api', async (importOriginal) => ({
	...(await importOriginal<object>()),
	listWorkspaces: async () => [{ id: 'pau', name: 'Pau', path: '/src/pau' }],
	getWorkspaceResources: vi.fn(async (workspaceId: string) => {
		if (state.fail) throw new Error('The Pau backend returned HTTP 503.');
		expect(workspaceId).toBe('pau');
		return {
			project_trust: 'trusted',
			warnings: [],
			resources: [
				{
					id: '/src/pau/.pi/prompts/review.md',
					kind: 'prompt',
					name: 'review',
					description: 'Review the staged changes',
					path: '/src/pau/.pi/prompts/review.md',
					scope: 'project',
					source_kind: 'directory',
					source: '/src/pau/.pi/prompts',
					trust: 'trusted',
					status: 'ready',
					winner: null,
					warnings: []
				}
			]
		};
	})
}));

test('loads the prompts view from the resource index API inside the shell', async () => {
	await page.viewport(1440, 900);
	await render(ResourcesPage);

	const rail = page.getByRole('navigation', { name: 'Product' });
	await expect.element(rail.getByLabelText('Resources', { exact: true })).toHaveAttribute('aria-current', 'page');
	await expect.element(page.getByRole('heading', { name: 'Prompts', level: 1 })).toBeVisible();
	await expect.element(page.getByRole('option', { name: /^review/ })).toBeVisible();
	await expect
		.element(page.getByRole('complementary', { name: 'Resources' }).getByRole('link', { name: 'Skills 0' }))
		.toHaveAttribute('href', '/workspaces/pau/resources/skills');
});

test('reports a failed load with a retry', async () => {
	state.fail = true;
	state.params.kind = undefined;
	await page.viewport(1440, 900);
	await render(ResourcesPage);

	await expect.element(page.getByRole('heading', { name: 'Skills', level: 1 })).toBeVisible();
	await expect.element(page.getByRole('alert')).toHaveTextContent('The Pau backend returned HTTP 503.');
	state.fail = false;
	await page.getByRole('button', { name: 'Try again' }).click();
	await expect.element(page.getByRole('heading', { name: 'No skills found' })).toBeVisible();
});
