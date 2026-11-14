import { expect, test, vi } from 'vitest';

import { searchFileMentions } from './file-mentions';

const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
	Response.json({
		entries: [
			{ path: 'src/lib', kind: 'directory', size: null },
			{ path: 'src/App.svelte', kind: 'file', size: 10 }
		],
		truncated: true
	})
);

test('asks the name search, marks folders with a trailing slash, and passes the abort signal', async () => {
	const signal = new AbortController().signal;
	expect(await searchFileMentions('w', 'src/', signal, fetcher)).toEqual({
		files: [
			{ path: 'src/lib/', directory: true },
			{ path: 'src/App.svelte', directory: false }
		],
		truncated: true
	});
	expect(fetcher).toHaveBeenLastCalledWith('/api/workspaces/w/names?query=src%2F', { headers: undefined, signal });
});

test('includes hidden entries only for a dotted name', async () => {
	await searchFileMentions('w', 'src/.en', undefined, fetcher);
	expect(fetcher).toHaveBeenLastCalledWith('/api/workspaces/w/names?query=src%2F.en&include_hidden=true', {
		headers: undefined,
		signal: undefined
	});
	await searchFileMentions('w', '.github/wo', undefined, fetcher);
	expect(fetcher).toHaveBeenLastCalledWith('/api/workspaces/w/names?query=.github%2Fwo', {
		headers: undefined,
		signal: undefined
	});
});

test('rejects when the search fails', async () => {
	const failing = vi
		.fn<typeof fetch>()
		.mockResolvedValue(Response.json({ code: 'internal', message: 'down' }, { status: 500 }));
	await expect(searchFileMentions('w', 'a', undefined, failing)).rejects.toThrow('down');
});
