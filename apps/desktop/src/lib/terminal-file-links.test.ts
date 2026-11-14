import type { FileEntry } from '@stormlightlabs/pau-protocol';
import { expect, test, vi } from 'vitest';

import { createTerminalFileLinks } from './terminal-file-links';

const entries: Record<string, FileEntry[]> = {
	'': [
		{ path: 'README.md', kind: 'file', size: 10 },
		{ path: 'src', kind: 'directory', size: null }
	],
	src: [
		{ path: 'src/main.rs', kind: 'file', size: 10 },
		{ path: 'src/lib.rs', kind: 'symlink', size: null },
		{ path: 'src/bin.rs', kind: 'directory', size: null }
	]
};

function fakeFetch() {
	return vi.fn<typeof fetch>(async (input) => {
		const url = new URL(String(input), 'https://pau.local');
		const body = entries[url.searchParams.get('path') ?? ''];
		return body ? Response.json(body) : Response.json({ error: 'not found' }, { status: 404 });
	});
}

test('lists only the regular files in a directory', async () => {
	const fetcher = fakeFetch();
	const links = createTerminalFileLinks('ws 1', () => {}, fetcher);

	await expect(links.files('')).resolves.toEqual(['README.md']);
	await expect(links.files('src')).resolves.toEqual(['src/main.rs']);
	await expect(links.files('docs')).rejects.toThrow();

	const [root, source] = fetcher.mock.calls.map(([input]) => new URL(String(input), 'https://pau.local'));
	expect(root?.pathname).toBe('/api/workspaces/ws%201/files');
	expect(root?.searchParams.get('path')).toBeNull();
	expect(source?.searchParams.get('path')).toBe('src');
	expect(source?.searchParams.get('include_hidden')).toBe('true');
	expect(source?.searchParams.get('include_ignored')).toBe('true');
});

test('hands opened paths to the app with their line', () => {
	const open = vi.fn();
	createTerminalFileLinks('ws', open).open('src/main.rs', 12);
	expect(open).toHaveBeenCalledWith('src/main.rs', 12);
});
