import { page } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import DiagnosticsPage from './+page.svelte';

vi.mock('$app/state', () => ({ page: { params: {}, route: { id: '/diagnostics' } } }));

vi.mock('$lib/api', async (importOriginal) => ({
	...(await importOriginal<object>()),
	listWorkspaces: async () => [],
	getDiagnostics: () => new Promise(() => {}),
	updateDiagnosticSettings: async () => {},
	startPayloadTracing: async () => {},
	exportDiagnostics: async () => {}
}));

const left = (element: Element) => element.getBoundingClientRect().left;

test.each([1440, 900, 800])('starts the view on the shell content edge at %ipx', async (width) => {
	await page.viewport(width, 900);
	await render(DiagnosticsPage);

	const content = document.querySelector('.app-shell__main-content')!;
	const contentEdge = left(content) + Number(getComputedStyle(content).paddingLeft.replace('px', ''));
	const view = page.getByRole('region', { name: 'Diagnostics', exact: true }).element();
	expect(left(view)).toBe(contentEdge);
});
