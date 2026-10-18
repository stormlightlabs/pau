import { expect, test, vi } from 'vitest';

import { searchFileMentions } from './file-mentions';

type Entry = { path: string; kind: 'file' | 'directory'; size: number | null };

const tree: Record<string, Entry[]> = {
	'': [
		{ path: 'README.md', kind: 'file', size: 10 },
		{ path: 'src', kind: 'directory', size: null }
	],
	src: [
		{ path: 'src/App.svelte', kind: 'file', size: 10 },
		{ path: 'src/lib', kind: 'directory', size: null },
		{ path: 'src/my notes.md', kind: 'file', size: 10 }
	],
	'src/lib': [{ path: 'src/lib/api.ts', kind: 'file', size: 10 }]
};
const list = vi.fn(async (_id: string, path: string) => tree[path] ?? []);

test('lists the folder before the last slash and filters by the name after it', async () => {
	expect(await searchFileMentions('w', 'src/', list)).toEqual([
		{ path: 'src/lib/', directory: true },
		{ path: 'src/App.svelte', directory: false },
		{ path: 'src/my notes.md', directory: false }
	]);
	expect(await searchFileMentions('w', 'src/ap', list)).toEqual([{ path: 'src/App.svelte', directory: false }]);
	expect(list).toHaveBeenCalledWith('w', 'src', { includeHidden: false, includeIgnored: false });
});

test('finds a name below the root and ranks prefix matches first', async () => {
	expect(await searchFileMentions('w', 'api', list)).toEqual([{ path: 'src/lib/api.ts', directory: false }]);
	const app = await searchFileMentions('w', 'app', list);
	expect(app.map((file) => file.path)).toEqual(['src/App.svelte']);
	expect(await searchFileMentions('w', 'zzz', list)).toEqual([]);
});

test('includes hidden entries only for a dotted name and rejects when the folder cannot be read', async () => {
	await searchFileMentions('w', '.en', list);
	expect(list).toHaveBeenCalledWith('w', '', { includeHidden: true, includeIgnored: false });
	await expect(
		searchFileMentions('w', 'a', async () => {
			throw new Error('down');
		})
	).rejects.toThrow('down');
});
