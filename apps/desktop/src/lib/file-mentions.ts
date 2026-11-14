import type { FileMentionSearch } from '@stormlightlabs/pau-ui';

import { searchWorkspaceNames } from './api';

/**
 * Finds the workspace files and folders for the path typed after an `@`.
 *
 * Ignored files stay out, and hidden ones appear only when the name after the
 * last slash starts with a dot. Folder paths end in a slash so accepting one
 * keeps completion open.
 */
export async function searchFileMentions(
	workspaceId: string,
	query: string,
	signal?: AbortSignal,
	fetcher: typeof fetch = fetch
): Promise<FileMentionSearch> {
	const name = query.slice(query.lastIndexOf('/') + 1);
	const options = { includeHidden: name.startsWith('.'), includeIgnored: false, signal };
	const { entries, truncated } = await searchWorkspaceNames(workspaceId, query, options, fetcher);
	const files = entries.map((entry) =>
		entry.kind === 'directory' ? { path: `${entry.path}/`, directory: true } : { path: entry.path, directory: false }
	);
	return { files, truncated };
}
