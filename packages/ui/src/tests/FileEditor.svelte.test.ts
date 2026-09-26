import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import FileEditor from '../lib/FileEditor.svelte';
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

test('opens a read-only file without editable or save controls', async () => {
	const editorSource = source(file({ writable: false }));
	await render(FileEditor, { path: editorSource.current.path, source: editorSource, pollInterval: 60_000 });

	await expect.element(page.getByText('Read-only')).toBeInTheDocument();
	await expect.element(page.getByRole('textbox')).toHaveAttribute('contenteditable', 'false');
	await expect.element(page.getByRole('button', { name: 'Save' })).toBeDisabled();
});

test.each([
	['binary_file', 'contains binary data'],
	['file_too_large', 'larger than the 2 MiB'],
	['invalid_encoding', 'not valid UTF-8']
])('shows the explicit %s file state', async (code, message) => {
	const view = await render(FileEditor, {
		path: 'unsupported.dat',
		source: {
			read: async () => {
				throw Object.assign(new Error('open failed'), { code });
			},
			write: async () => file()
		},
		pollInterval: 60_000
	});

	await expect.element(page.getByRole('alert')).toHaveTextContent(message);
	view.unmount();
});
