import { page, userEvent } from 'vitest/browser';
import { beforeEach, expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import ApplicationShellDemo from '../stories/ApplicationShellDemo.svelte';

const contextRail = () => document.querySelector<HTMLElement>('#shell-bay')!.getBoundingClientRect().width;
const inspectorPane = () => document.querySelector<HTMLElement>('#shell-workspace')!.getBoundingClientRect().width;
// The resize handles exist only where the columns dock beside the main surface.
beforeEach(async () => {
	await page.viewport(1440, 900);
});

const saved = () => page.getByLabelText('Saved pane widths');

test('resizes the context rail by keyboard and reports the kept width', async () => {
	await render(ApplicationShellDemo);

	const separator = page.getByRole('separator', { name: 'Resize the session bay' });
	const before = contextRail();
	await expect.element(separator).toHaveAttribute('aria-valuenow', String(before));
	await expect.element(separator).toHaveAttribute('aria-valuemin', '288');

	(separator.element() as HTMLElement).focus();
	await userEvent.keyboard('{ArrowRight}');
	await expect.element(separator).toHaveAttribute('aria-valuenow', String(before + 16));
	await expect.element(saved()).toHaveTextContent(String(before + 16));
	await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
	await expect.element(separator).toHaveAttribute('aria-valuenow', String(before - 48));
});

test('resizes the inspector from its left edge and clamps to the minimum', async () => {
	await render(ApplicationShellDemo);

	const separator = page.getByRole('separator', { name: 'Resize the checks column' });
	const before = inspectorPane();
	(separator.element() as HTMLElement).focus();
	await userEvent.keyboard('{ArrowLeft}');
	await expect.element(separator).toHaveAttribute('aria-valuenow', String(before + 16));
	for (let press = 0; press < 12; press += 1) await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
	await expect.element(separator).toHaveAttribute('aria-valuenow', '240');
});

test('dragging a separator widens the pane and keeps the width on release', async () => {
	await render(ApplicationShellDemo);

	const separator = page.getByRole('separator', { name: 'Resize the session bay' });
	const before = contextRail();
	await userEvent.dragAndDrop(separator, page.getByRole('heading', { level: 1 }));

	await expect.poll(contextRail).toBeGreaterThan(before);
	const width = String(Math.round(contextRail()));
	await expect.element(saved()).toHaveTextContent(width);
});

test('Home and End jump to the limits and double click restores the default', async () => {
	await render(ApplicationShellDemo, { paneWidths: { contextRail: 400, inspector: 320 } });

	const separator = page.getByRole('separator', { name: 'Resize the session bay' });
	await expect.element(separator).toHaveAttribute('aria-valuenow', '400');
	const min = separator.element().getAttribute('aria-valuemin');
	const max = separator.element().getAttribute('aria-valuemax');
	(separator.element() as HTMLElement).focus();
	await userEvent.keyboard('{Home}');
	await expect.element(saved()).toHaveTextContent(`"contextRail":${min}`);
	await userEvent.keyboard('{End}');
	await expect.element(saved()).toHaveTextContent(`"contextRail":${max}`);

	await userEvent.dblClick(separator);
	await expect.element(saved()).toHaveTextContent('"contextRail":null');
});

test('keeps the main surface at its minimum width', async () => {
	await render(ApplicationShellDemo, { paneWidths: { contextRail: 2000, inspector: 2000 } });

	await expect
		.poll(() => document.querySelector<HTMLElement>('#main-surface')!.getBoundingClientRect().width)
		.toBeGreaterThanOrEqual(383);
});

test('applies a restored width', async () => {
	await render(ApplicationShellDemo, { paneWidths: { contextRail: 320, inspector: null } });

	await expect.poll(contextRail).toBe(320);
});
