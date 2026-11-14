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

test('marks folders with a trailing slash and passes the abort signal', async () => {
	const signal = new AbortController().signal;
	expect(await searchFileMentions('w', 'src/', signal, fetcher)).toEqual({
		files: [
			{ path: 'src/lib/', directory: true },
			{ path: 'src/App.svelte', directory: false }
		],
		truncated: true
	});
	expect(fetcher).toHaveBeenLastCalledWith('/api/workspaces/w/search?query=src%2F&match=names', {
		headers: undefined,
		signal
	});
});

test('includes hidden entries only for a dotted name', async () => {
	await searchFileMentions('w', 'src/.en', undefined, fetcher);
	expect(String(fetcher.mock.lastCall?.[0])).toContain('include_hidden=true');
	await searchFileMentions('w', '.github/wo', undefined, fetcher);
	expect(String(fetcher.mock.lastCall?.[0])).not.toContain('include_hidden');
});
