import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import FileEditor from '../lib/FileEditor.svelte';
import { themeCssProperties } from '../theme';
import type { EditorFileContent, FileEditorSource } from '../lib/types/file-editor';

function file(overrides: Partial<EditorFileContent> = {}): EditorFileContent {
	return {
		path: 'src/example.ts',
		content: 'const value = 1;\n',
		revision: 'revision-1',
		writable: true,
		...overrides
	};
}

function source(initial = file()): FileEditorSource & { current: EditorFileContent } {
	const editorSource = {
		current: initial,
		read: vi.fn(async () => structuredClone(editorSource.current)),
		write: vi.fn(async (path: string, content: string, expectedRevision: string) => {
			expect(path).toBe(initial.path);
			expect(expectedRevision).toBe(editorSource.current.revision);
			editorSource.current = { path, content, revision: 'revision-saved', writable: true };
			return structuredClone(editorSource.current);
		})
	};
	return editorSource;
}

async function editorText(): Promise<string> {
	return page.getByRole('textbox').element().textContent ?? '';
}

test('opens, edits, reverts, and saves a text file', async () => {
	const editorSource = source();
	await render(FileEditor, { path: editorSource.current.path, source: editorSource, pollInterval: 60_000 });

	await expect.element(page.getByRole('textbox')).toHaveTextContent('const value = 1;');
	await userEvent.click(page.getByRole('textbox'));
	await userEvent.keyboard('{Control>}a{/Control}const value = 2;');
	await expect.element(page.getByText('Unsaved changes')).toBeInTheDocument();

	await userEvent.click(page.getByRole('button', { name: 'Revert' }));
	await expect.poll(editorText).toContain('const value = 1;');

	await userEvent.click(page.getByRole('textbox'));
	await userEvent.keyboard('{Control>}a{/Control}const value = 3;');
	await userEvent.click(page.getByRole('button', { name: 'Save' }));
	await expect.poll(() => editorSource.write).toHaveBeenCalledOnce();
	expect(editorSource.current.content).toContain('const value = 3;');
	await expect.element(page.getByText('Saved')).toBeInTheDocument();
});

test('detects an external modification without discarding unsaved work', async () => {
	const editorSource = source();
	await render(FileEditor, { path: editorSource.current.path, source: editorSource, pollInterval: 60_000 });
	await userEvent.click(page.getByRole('textbox'));
	await userEvent.keyboard('{End} // mine');
	editorSource.current = file({ content: 'const value = 9;\n', revision: 'revision-external' });

	await userEvent.click(page.getByRole('button', { name: 'Check for changes' }));
	const alert = page.getByRole('alert');
	await expect.element(alert).toHaveTextContent('File changed on disk');
	await expect.element(alert).toHaveTextContent('Your unsaved changes are still in the editor.');
	await expect.element(page.getByRole('textbox')).toHaveTextContent('// mine');

	await userEvent.click(page.getByRole('button', { name: 'Reload from disk' }));
	await expect.poll(editorText).toContain('const value = 9;');
	await expect.element(page.getByText('Unsaved changes')).not.toBeInTheDocument();
});

test.each([
	['script.py', 'print("hello")\n', 'python'],
	['main.go', 'package main\n', 'go'],
	['Panel.svelte', '<p>Hello</p>\n', 'html']
])('loads syntax support for %s from the language catalog', async (path, content, language) => {
	const editorSource = source(file({ path, content }));
	const view = await render(FileEditor, { path, source: editorSource, pollInterval: 60_000 });

	await expect.element(page.getByRole('textbox')).toHaveAttribute('data-language', language);
	view.unmount();
});

test('fills the pane height for a short file, with the gutter spanning it', async () => {
	const editorSource = source();
	await render(FileEditor, { path: editorSource.current.path, source: editorSource, pollInterval: 60_000 });
	await expect.element(page.getByRole('textbox')).toBeInTheDocument();
	const section = document.querySelector<HTMLElement>('.file-editor')!;
	section.parentElement!.style.height = '480px';
	const height = (selector: string): number => section.querySelector(selector)!.getBoundingClientRect().height;
	await expect.poll(() => Math.abs(height('.cm-editor') - height('.file-editor__code'))).toBeLessThanOrEqual(1);
	expect(height('.file-editor__code')).toBeGreaterThan(300);
	expect(Math.abs(height('.cm-gutters') - height('.cm-editor'))).toBeLessThanOrEqual(1);
});

test('scrolls a long file inside the editor instead of growing the pane', async () => {
	const editorSource = source(file({ content: Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n') }));
	await render(FileEditor, { path: editorSource.current.path, source: editorSource, pollInterval: 60_000 });
	await expect.element(page.getByRole('textbox')).toBeInTheDocument();
	const section = document.querySelector<HTMLElement>('.file-editor')!;
	section.parentElement!.style.height = '480px';
	const scroller = section.querySelector<HTMLElement>('.cm-scroller')!;
	await expect.poll(() => section.getBoundingClientRect().height).toBe(480);
	expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
	expect(getComputedStyle(scroller).overflowY).toBe('auto');
});

test('centers the file name with the header actions', async () => {
	await page.viewport(1024, 768);
	const editorSource = source();
	await render(FileEditor, { path: editorSource.current.path, source: editorSource, pollInterval: 60_000 });
	const name = document.querySelector<HTMLElement>('.file-editor__header p')!.getBoundingClientRect();
	const actions = document.querySelector<HTMLElement>('.file-editor__actions')!.getBoundingClientRect();
	expect(Math.abs(name.top + name.height / 2 - (actions.top + actions.height / 2))).toBeLessThanOrEqual(1);
});

function styledSpan(text: string): HTMLElement | undefined {
	const spans = [...document.querySelectorAll<HTMLElement>('.cm-line span')];
	return spans.find((node) => node.textContent?.trim() === text);
}

function colorOf(text: string): string {
	const node = styledSpan(text);
	return node ? getComputedStyle(node).color : '';
}

test('highlights Markdown headings and inline code', async () => {
	const properties = Object.entries(themeCssProperties('eldritch', 'overpass'));
	for (const [name, value] of properties) document.documentElement.style.setProperty(name, value);
	const editorSource = source(file({ path: 'TODO.md', content: '# Study plan\n\nRun `miss::` cards\n' }));
	await render(FileEditor, { path: 'TODO.md', source: editorSource, pollInterval: 60_000 });
	await expect.element(page.getByRole('textbox')).toBeInTheDocument();
	const plain = getComputedStyle(document.querySelector('.cm-content')!).color;
	await expect.poll(() => colorOf('Study plan')).not.toBe('');
	expect(colorOf('Study plan')).not.toBe(plain);
	expect(colorOf('miss::')).not.toBe(plain);
	const heading = getComputedStyle(styledSpan('Study plan')!);
	expect(Number(heading.fontWeight)).toBeGreaterThanOrEqual(600);
});

test('opens a read-only file without editable or save controls', async () => {
	const editorSource = source(file({ writable: false }));
	await render(FileEditor, { path: editorSource.current.path, source: editorSource, pollInterval: 60_000 });

	await expect.element(page.getByText('Read-only')).toBeInTheDocument();
	await expect.element(page.getByRole('textbox')).toHaveAttribute('contenteditable', 'false');
	await expect.element(page.getByRole('button', { name: 'Save' })).toBeDisabled();
});

function failingSource(code: string): FileEditorSource {
	return {
		read: vi.fn(async () => {
			throw Object.assign(new Error('open failed'), { code });
		}),
		write: async () => file()
	};
}

test.each([
	['binary_file', 'found binary data'],
	['file_too_large', 'larger than 2 MiB'],
	['invalid_encoding', 'not valid UTF-8']
])('offers to reveal the file for %s and no retry', async (code, message) => {
	const onReveal = vi.fn(async () => {});
	await render(FileEditor, { path: 'unsupported.dat', source: failingSource(code), pollInterval: 60_000, onReveal });

	await expect.element(page.getByRole('alert')).toHaveTextContent(message);
	await expect.element(page.getByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
	await userEvent.click(page.getByRole('button', { name: /Reveal in Finder|Show in folder/ }));
	expect(onReveal).toHaveBeenCalledOnce();
});

test('shows no action for an unopenable file when the app cannot reveal paths', async () => {
	await render(FileEditor, { path: 'a.bin', source: failingSource('binary_file'), pollInterval: 60_000 });

	await expect.element(page.getByRole('alert')).toHaveTextContent('found binary data');
	await expect.element(page.getByRole('button', { name: /Reveal|Show in folder|Try again/ })).not.toBeInTheDocument();
});

test('keeps the retry for a read that can succeed later', async () => {
	const source = failingSource('permission_denied');
	await render(FileEditor, { path: 'a.txt', source, pollInterval: 60_000, onReveal: async () => {} });

	await userEvent.click(page.getByRole('button', { name: 'Try again' }));
	await expect.poll(() => source.read).toHaveBeenCalledTimes(2);
	await expect.element(page.getByRole('button', { name: /Reveal in Finder|Show in folder/ })).not.toBeInTheDocument();
});

test('shows Markdown fold markers on sections but not on paragraphs', async () => {
	const content = ['# Notes', '', 'A paragraph that', 'spans two lines.', '', '## Next', '', '- One', '- Two', ''].join(
		'\n'
	);
	const editorSource = source(file({ path: 'notes.md', content }));
	const { container } = await render(FileEditor, { path: 'notes.md', source: editorSource, pollInterval: 60_000 });
	await expect.element(page.getByRole('textbox')).toHaveTextContent('Notes');

	const lines = [...container.querySelectorAll('.cm-line')];
	const foldedLines = () =>
		// The gutter keeps a hidden marker to measure its width.
		[...container.querySelectorAll(':scope .cm-foldGutter [title]')]
			.filter((marker) => getComputedStyle(marker).visibility !== 'hidden')
			.map((marker) => {
				const top = marker.getBoundingClientRect().top;
				return lines.find((line) => Math.abs(line.getBoundingClientRect().top - top) < 4)?.textContent;
			});
	await expect.poll(foldedLines).toEqual(['# Notes', '## Next']);
});
