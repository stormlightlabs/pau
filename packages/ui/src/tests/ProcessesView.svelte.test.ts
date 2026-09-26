import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { resourceMonitoringFixtures } from '../fixtures/resource-monitoring';
import ProcessesView from '../lib/ProcessesView.svelte';
import SessionResourceSummary from '../lib/SessionResourceSummary.svelte';

const actions = Object.fromEntries(
	resourceMonitoringFixtures.active.map((process) => [process.processId, { interrupt: true, stop: true }])
);

test('shows aggregate metrics and expands the process breakdown', async () => {
	await render(ProcessesView, { workspaceName: 'Pau', processes: resourceMonitoringFixtures.active, actions });

	await expect.element(page.getByText('486 MiB')).toBeVisible();
	await expect.element(page.getByText('Unavailable')).toBeVisible();
	await userEvent.click(page.getByRole('button', { name: 'Expand Fix diff gutter process tree' }));
	await expect.element(page.getByText('PID 3834')).toBeVisible();
});

test('offers explicit interrupt and stop actions without acting automatically', async () => {
	const onInterrupt = vi.fn();
	const onStop = vi.fn();
	await render(ProcessesView, {
		workspaceName: 'Pau',
		processes: [resourceMonitoringFixtures.active[2]!],
		actions,
		onInterrupt,
		onStop
	});

	await expect.element(page.getByText('cpu pressure')).toBeVisible();
	expect(onInterrupt).not.toHaveBeenCalled();
	expect(onStop).not.toHaveBeenCalled();
	await userEvent.click(page.getByRole('button', { name: 'Interrupt' }));
	await userEvent.click(page.getByRole('button', { name: 'Stop' }));
	expect(onInterrupt).toHaveBeenCalledWith('registry-tests');
	expect(onStop).toHaveBeenCalledWith('registry-tests');
});

test('shows a compact session summary with a non-destructive pressure warning', async () => {
	const onStop = vi.fn();
	await render(SessionResourceSummary, {
		snapshot: resourceMonitoringFixtures.active[2]!,
		actions: { interrupt: true, stop: true },
		onStop
	});

	await expect.element(page.getByText('The session will keep running until you act.')).toBeVisible();
	expect(onStop).not.toHaveBeenCalled();
	await userEvent.click(page.getByRole('button', { name: 'Stop session' }));
	expect(onStop).toHaveBeenCalledWith('registry-tests');
});

test('shows empty and completed states', async () => {
	const empty = await render(ProcessesView, { workspaceName: 'Pau', processes: [] });
	await expect.element(page.getByRole('heading', { name: 'No managed processes' })).toBeVisible();
	await empty.unmount();

	await render(ProcessesView, { workspaceName: 'Pau', processes: [resourceMonitoringFixtures.completed] });
	await userEvent.click(page.getByRole('button', { name: 'Expand Update protocol types process tree' }));
	await expect.element(page.getByText(/Only its final summary remains/)).toBeVisible();
});
