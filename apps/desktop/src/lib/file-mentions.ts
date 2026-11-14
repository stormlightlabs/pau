import type { FileMention } from '@stormlightlabs/pau-ui';

import { searchWorkspaceNames } from './api';

/**
 * Finds the workspace files and folders for the path typed after an `@`.
 *
 * The server's name search ranks the matches and leaves out ignored files.
 * Hidden entries appear only when the name after the last slash starts with a
 * dot. Folder paths end in a slash so accepting one keeps completion open.
 */
export async function searchFileMentions(
	workspaceId: string,
	query: string,
	fetcher: typeof fetch = fetch
): Promise<FileMention[]> {
	const name = query.slice(query.lastIndexOf('/') + 1);
	const options = { includeHidden: name.startsWith('.'), includeIgnored: false };
	const entries = await searchWorkspaceNames(workspaceId, query, options, fetcher);
	return entries.map((entry) =>
		entry.kind === 'directory' ? { path: `${entry.path}/`, directory: true } : { path: entry.path, directory: false }
	);
}
