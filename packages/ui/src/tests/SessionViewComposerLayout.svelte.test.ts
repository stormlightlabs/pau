import { page, userEvent } from 'vitest/browser';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { commandFixtures } from '../fixtures/commands';
import { fileMentionFixtures } from '../fixtures/file-mentions';
import { sessionFixtures } from '../fixtures/sessions';
import SessionView from '../lib/SessionView.svelte';
import SessionViewDemo from '../stories/SessionViewDemo.svelte';

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

test.each([900, 1440])('keeps the field full width at %ipx', async (width) => {
	await page.viewport(width, 900);
	await render(SessionView, {
		workspaces: sessionFixtures.queued,
		activeSessionId: 'session-running',
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

test.each([
	['/', 'Commands'],
	['@', 'Files']
])('opens the %s completion list above the composer without moving the transcript', async (typed, list) => {
	await page.viewport(1440, 900);
	await render(SessionViewDemo, {
		workspaces: sessionFixtures.running,
		initialSessionId: 'session-running',
		commands: commandFixtures.populated,
		files: fileMentionFixtures.populated
	});
	await document.fonts.ready;
	const entry = document.querySelector<HTMLElement>('.session-view__transcript-content > *')!;
	const composer = document.querySelector<HTMLElement>('.session-composer')!;
	const entryTop = entry.getBoundingClientRect().top;
	const composerBox = composer.getBoundingClientRect();

	await userEvent.type(page.getByRole('textbox', { name: 'Prompt' }), typed);
	const listbox = page.getByRole('listbox', { name: list });
	await expect.element(listbox.getByRole('option').first()).toBeVisible();

	expect(entry.getBoundingClientRect().top).toBe(entryTop);
	expect(composer.getBoundingClientRect().top).toBe(composerBox.top);
	expect(composer.getBoundingClientRect().height).toBe(composerBox.height);
	// The popover holding the list shares the composer's leading edge and sits above it.
	const box = listbox.element().closest('.session-composer__completion')!.getBoundingClientRect();
	expect(box.bottom).toBeLessThanOrEqual(composerBox.top);
	expect(box.left).toBe(composerBox.left);
});

test('keeps Send prompt and the delivery mode inside the composer at the minimum window width', async () => {
	await page.viewport(900, 560);
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
