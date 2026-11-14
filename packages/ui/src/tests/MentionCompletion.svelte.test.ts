import { page } from 'vitest/browser';
import { afterEach, expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import MentionCompletion from '../lib/MentionCompletion.svelte';

const props = { id: 'mentions', selected: 0, failed: false, onAccept: () => {} };
const deep = 'packages/desktop/src/routes/settings/appearance/components/preview/ThemePreview.svelte';

test('says a search that stopped early may have missed the name', async () => {
	const screen = await render(MentionCompletion, { ...props, files: [], truncated: true });
	await expect.element(page.getByText(/Search stopped early/)).toBeVisible();
	await expect.element(page.getByText('No matching files')).not.toBeInTheDocument();
	await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();

	await screen.rerender({ files: [{ path: 'src/App.svelte', directory: false }], truncated: true });
	await expect.element(page.getByRole('option', { name: /App\.svelte/ })).toBeVisible();
	await expect.element(page.getByText(/Search stopped early/)).toBeVisible();

	await screen.rerender({ files: [], truncated: false });
	await expect.element(page.getByText('No matching files')).toBeVisible();
});

afterEach(() => {
	document.body.style.width = '';
});

test('keeps the end of a long folder visible and shows the full path on hover', async () => {
	document.body.style.width = '360px';
	await render(MentionCompletion, { ...props, files: [{ path: deep, directory: false }] });
	const option = page.getByRole('option', { name: /ThemePreview\.svelte/ });
	await expect.element(option).toHaveAttribute('title', deep);

	const folder = option.element().querySelector('.mention-completion__folder') as HTMLElement;
	const text = folder.firstElementChild as HTMLElement;
	const outer = folder.getBoundingClientRect();
	const inner = text.getBoundingClientRect();
	expect(folder.scrollWidth).toBeGreaterThan(folder.clientWidth);
	// The folder's start overflows to the left; its last segment stays in view.
	expect(inner.left).toBeLessThan(outer.left);
	expect(inner.right).toBeLessThanOrEqual(outer.right + 0.5);
});
