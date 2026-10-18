import { page } from 'vitest/browser';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { resourceMonitoringFixtures } from '../fixtures/resource-monitoring';
import { sessionFixtures } from '../fixtures/sessions';
import SessionView from '../lib/SessionView.svelte';

const snapshot = { ...resourceMonitoringFixtures.active[2]!, sessionId: 'session-running' };

/** Measures the placeholder on one line in the textarea's font. */
function placeholderWidth(field: HTMLTextAreaElement): number {
	const probe = document.createElement('span');
	probe.style.font = getComputedStyle(field).font;
	probe.style.whiteSpace = 'nowrap';
	probe.style.position = 'absolute';
	probe.textContent = field.placeholder;
	document.body.append(probe);
	const width = probe.getBoundingClientRect().width;
	probe.remove();
	return width;
}

test.each([
	[900, false],
	[1440, false],
	[1440, true]
])('keeps the field full width at %ipx (inspector open: %s)', async (width, inspector) => {
	await page.viewport(width, 900);
	await render(SessionView, {
		workspaces: sessionFixtures.queued,
		activeSessionId: 'session-running',
		resourceSnapshot: inspector ? snapshot : undefined,
		onInterrupt: async () => {}
	});
	await document.fonts.ready;

	const composer = document.querySelector<HTMLElement>('.session-composer')!.getBoundingClientRect();
	const field = document.querySelector<HTMLElement>('.session-composer__field')!.getBoundingClientRect();
	expect(composer.width - field.width).toBeLessThanOrEqual(2);

	const textarea = page.getByRole('textbox', { name: 'Prompt' }).element() as HTMLTextAreaElement;
	const style = getComputedStyle(textarea);
	const textWidth =
		textarea.clientWidth - Number(style.paddingLeft.replace('px', '')) - Number(style.paddingRight.replace('px', ''));
	expect(placeholderWidth(textarea)).toBeLessThan(textWidth);

	// Delivery mode and the actions share one row below the field.
	const send = page
		.getByRole('button', { name: /Send prompt/ })
		.element()
		.getBoundingClientRect();
	const mode = page.getByRole('combobox', { name: 'Send as' }).element().getBoundingClientRect();
	expect(send.top).toBeGreaterThanOrEqual(field.bottom);
	expect(Math.abs(send.top + send.height / 2 - (mode.top + mode.height / 2))).toBeLessThan(2);
	expect(send.right).toBeLessThanOrEqual(composer.right);
});

test('keeps Send prompt and the delivery mode inside a 360px composer', async () => {
	await page.viewport(360, 800);
	await render(SessionView, {
		workspaces: sessionFixtures.queued,
		activeSessionId: 'session-running',
		onInterrupt: async () => {}
	});

	const composer = document.querySelector<HTMLElement>('.session-composer')!.getBoundingClientRect();
	for (const control of [
		page.getByRole('button', { name: /Send prompt/ }),
		page.getByRole('combobox', { name: 'Send as' })
	]) {
		await expect.element(control).toBeVisible();
		const box = control.element().getBoundingClientRect();
		expect(box.left).toBeGreaterThanOrEqual(composer.left);
		expect(box.right).toBeLessThanOrEqual(composer.right);
	}
});
