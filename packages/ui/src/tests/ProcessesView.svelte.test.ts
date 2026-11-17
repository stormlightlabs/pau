import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { resourceMonitoringFixtures } from '../fixtures/resource-monitoring';
import ProcessesView from '../lib/ProcessesView.svelte';
import SessionResourceSummary from '../lib/SessionResourceSummary.svelte';
import ProcessesViewDemo from '../stories/ProcessesViewDemo.svelte';
import { themeCssProperties } from '../theme';

const actions = Object.fromEntries(
	resourceMonitoringFixtures.active.map((process) => [process.processId, { interrupt: true, stop: true }])
);

test('shows aggregate metrics and expands the process breakdown', async () => {
	await render(ProcessesView, { processes: resourceMonitoringFixtures.active, actions });

	await expect.element(page.getByText('486 MiB')).toBeVisible();
	await expect.element(page.getByText('Unavailable')).toBeVisible();
	await userEvent.click(page.getByRole('button', { name: 'Expand Fix diff gutter process tree' }));
	await expect.element(page.getByText('PID 3834')).toBeVisible();
});

test('offers explicit interrupt and stop actions without acting automatically', async () => {
	const onInterrupt = vi.fn();
	const onStop = vi.fn();
	await render(ProcessesView, { processes: [resourceMonitoringFixtures.active[2]!], actions, onInterrupt, onStop });

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

test('styles the pressure Stop like the Processes Stop button and Interrupt as a secondary button', async () => {
	const properties = Object.entries(themeCssProperties('eldritch', 'overpass'));
	for (const [name, value] of properties) {
		document.documentElement.style.setProperty(name, value);
	}
	await render(ProcessesView, { processes: [resourceMonitoringFixtures.active[2]!], actions });
	const processStop = getComputedStyle(page.getByRole('button', { name: 'Stop', exact: true }).element());
	await render(SessionResourceSummary, {
		snapshot: resourceMonitoringFixtures.active[2]!,
		actions: { interrupt: true, stop: true }
	});
	const interrupt = getComputedStyle(page.getByRole('button', { name: 'Interrupt work' }).element());
	const stop = getComputedStyle(page.getByRole('button', { name: 'Stop session' }).element());

	expect(stop.backgroundColor).toBe(processStop.backgroundColor);
	expect(stop.borderTopColor).toBe(processStop.borderTopColor);
	expect(stop.color).toBe(processStop.color);
	expect(interrupt.borderTopWidth).toBe(processStop.borderTopWidth);
	expect(interrupt.fontWeight).toBe(processStop.fontWeight);
	expect(interrupt.color).not.toBe(stop.color);
	expect(interrupt.borderTopColor).not.toBe(stop.borderTopColor);
});

test('shows empty and completed states', async () => {
	const empty = await render(ProcessesView, { processes: [] });
	await expect.element(page.getByRole('heading', { name: 'No managed processes' })).toBeVisible();
	await empty.unmount();

	await render(ProcessesView, { processes: [resourceMonitoringFixtures.completed] });
	await userEvent.click(page.getByRole('button', { name: 'Expand Update protocol types process tree' }));
	await expect.element(page.getByText(/Only its final summary remains/)).toBeVisible();
});

test('insets the header by the same padding as the process rows', async () => {
	const { container } = await render(ProcessesView, { processes: resourceMonitoringFixtures.active, actions });

	const header = container.querySelector('header')!;
	const heading = container.querySelector('.processes-view__table-heading')!;
	expect(getComputedStyle(header).paddingLeft).toBe(getComputedStyle(heading).paddingLeft);
	expect(getComputedStyle(header).paddingLeft).not.toBe('0px');
	expect(getComputedStyle(header).paddingRight).toBe(getComputedStyle(header).paddingLeft);
});

test('explains unavailable monitoring instead of claiming nothing runs', async () => {
	await render(ProcessesView, { processes: [], unavailable: 'Not collected yet.' });

	await expect.element(page.getByRole('heading', { name: "Process monitoring isn't available" })).toBeVisible();
	await expect.element(page.getByText('Not collected yet.')).toBeVisible();
	expect(page.getByText(/monitored tree/).elements()).toHaveLength(0);
	expect(page.getByRole('heading', { name: 'No managed processes' }).elements()).toHaveLength(0);
});

test('recomposes rows inside the shell at the minimum window size', async () => {
	await page.viewport(900, 560);
	await render(ProcessesViewDemo, { processes: resourceMonitoringFixtures.active, inShell: true });
	await expect.element(page.getByRole('navigation', { name: 'Views' })).toBeVisible();

	const main = document.querySelector<HTMLElement>('#main-surface')!;
	const surface = main.getBoundingClientRect();
	expect(main.scrollWidth).toBe(main.clientWidth);
	const stops = page.getByRole('button', { name: 'Stop', exact: true }).elements();
	expect(stops.length).toBeGreaterThan(0);
	for (const stop of stops) {
		const box = stop.getBoundingClientRect();
		expect(box.left).toBeGreaterThanOrEqual(surface.left);
		expect(box.right).toBeLessThanOrEqual(surface.right);
	}
});
