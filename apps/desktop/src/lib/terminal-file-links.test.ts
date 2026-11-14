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

test('links a path only when its directory lists it as a regular file', async () => {
	const fetcher = fakeFetch();
	const links = createTerminalFileLinks('ws 1', () => {}, fetcher);

	await expect(links.exists('README.md')).resolves.toBe(true);
	await expect(links.exists('src/main.rs')).resolves.toBe(true);
	await expect(links.exists('src/lib.rs')).resolves.toBe(false);
	await expect(links.exists('src/bin.rs')).resolves.toBe(false);
	await expect(links.exists('src/other.rs')).resolves.toBe(false);
	await expect(links.exists('docs/guide.md')).rejects.toThrow();

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
