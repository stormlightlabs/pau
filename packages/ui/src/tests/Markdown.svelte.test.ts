import { page } from 'vitest/browser';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import '../styles/tokens.css';
import { markdownFixtures } from '../fixtures/markdown';
import Markdown from '../lib/Markdown.svelte';
import { parseMarkdown, safeHref } from '../lib/markdown';

test('renders headings, lists, and tables', async () => {
	await render(Markdown, {
		text: `${markdownFixtures.headings}\n\n${markdownFixtures.lists}\n\n${markdownFixtures.table}`
	});

	await expect.element(page.getByRole('heading', { level: 2, name: 'Cause' })).toBeVisible();
	await expect.element(page.getByRole('listitem').first()).toBeVisible();
	await expect.element(page.getByRole('cell', { name: '12' })).toBeVisible();
});

test('renders fenced code with and without a language in the code font', async () => {
	const { container } = await render(Markdown, { text: markdownFixtures.code });
	const blocks = container.querySelectorAll('pre');

	expect(blocks).toHaveLength(2);
	expect(blocks[0]!.dataset.language).toBe('ts');
	expect(blocks[1]!.dataset.language).toBeUndefined();
	expect(getComputedStyle(blocks[0]!.querySelector('code')!).fontFamily).toContain('Overpass Mono');
});

test('keeps raw HTML and images as text', async () => {
	const { container } = await render(Markdown, { text: markdownFixtures.html });

	expect(container.querySelector('script, b, img, [onclick]')).toBeNull();
	expect(container.textContent).toContain('<b>bold</b>');
	expect(container.textContent).toContain('<div onclick="alert(1)">block</div>');
});

test('links only to absolute web and mail addresses', async () => {
	const { container } = await render(Markdown, { text: markdownFixtures.links });
	const links = container.querySelectorAll('a');

	expect(links).toHaveLength(1);
	expect(links[0]!.getAttribute('rel')).toBe('noopener noreferrer');
	expect(container.textContent).toContain('run this');
	expect(safeHref('javascript:alert(1)')).toBeUndefined();
	expect(safeHref('./file.md')).toBeUndefined();
	expect(safeHref('mailto:a@example.com')).toBe('mailto:a@example.com');
});

test('reuses unchanged blocks while text streams in', () => {
	const first = parseMarkdown('First paragraph.\n\nSecond');
	const second = parseMarkdown('First paragraph.\n\nSecond paragraph grows', first);

	expect(second[0]).toBe(first[0]);
	expect(second[1]).not.toBe(first[1]);
});

test('updates the rendered tail as text grows', async () => {
	const screen = await render(Markdown, { text: markdownFixtures.streaming });
	await expect.element(page.getByText('const width = measure(')).toBeVisible();

	await screen.rerender({ text: `${markdownFixtures.streaming}height);\n\`\`\`` });
	await expect.element(page.getByText('const width = measure(height);')).toBeVisible();
});
