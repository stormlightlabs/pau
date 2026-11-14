import { expect, test, vi } from 'vitest';

import { searchFileMentions } from './file-mentions';

const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
	Response.json([
		{ path: 'src/lib', kind: 'directory', size: null },
		{ path: 'src/App.svelte', kind: 'file', size: 10 }
	])
);

test('asks the name search and marks folders with a trailing slash', async () => {
	expect(await searchFileMentions('w', 'src/', fetcher)).toEqual([
		{ path: 'src/lib/', directory: true },
		{ path: 'src/App.svelte', directory: false }
	]);
	expect(fetcher).toHaveBeenLastCalledWith('/api/workspaces/w/names?query=src%2F', { headers: undefined });
});

test('includes hidden entries only for a dotted name', async () => {
	await searchFileMentions('w', 'src/.en', fetcher);
	expect(fetcher).toHaveBeenLastCalledWith('/api/workspaces/w/names?query=src%2F.en&include_hidden=true', {
		headers: undefined
	});
	await searchFileMentions('w', '.github/wo', fetcher);
	expect(fetcher).toHaveBeenLastCalledWith('/api/workspaces/w/names?query=.github%2Fwo', { headers: undefined });
});

test('rejects when the search fails', async () => {
	const failing = vi
		.fn<typeof fetch>()
		.mockResolvedValue(Response.json({ code: 'internal', message: 'down' }, { status: 500 }));
	await expect(searchFileMentions('w', 'a', failing)).rejects.toThrow('down');
});
