import type { FileMention } from '@stormlightlabs/pau-ui';

import { listWorkspaceFiles } from './api';

type Listing = typeof listWorkspaceFiles;

/** Most entries offered for one query. */
const resultLimit = 50;
/** Most folders read while looking for a name below the workspace root. */
const folderBudget = 60;

function rank(name: string, needle: string): number {
	const lower = name.toLowerCase();
	if (lower.startsWith(needle)) return 0;
	if (lower.includes(needle)) return 1;
	let at = 0;
	for (const char of lower) if (char === needle[at]) at += 1;
	return at === needle.length ? 2 : 3;
}

/**
 * Finds the workspace files and folders for the path typed after an `@`.
 *
 * A query with a slash lists the folder before the last slash and filters its
 * entries by the name after it, the way Pi completes paths. A plain name
 * searches the workspace folder by folder, nearest first, within a fixed
 * folder budget. Ignored files stay out, and hidden ones appear only when the
 * name starts with a dot. Matches are ordered as prefix, substring, then
 * letters in order, with folders ahead of files.
 */
export async function searchFileMentions(
	workspaceId: string,
	query: string,
	list: Listing = listWorkspaceFiles
): Promise<FileMention[]> {
	const slash = query.lastIndexOf('/');
	const needle = query.slice(slash + 1).toLowerCase();
	const options = { includeHidden: needle.startsWith('.'), includeIgnored: false };
	const found: { mention: FileMention; rank: number }[] = [];
	const collect = (entries: Awaited<ReturnType<Listing>>): string[] => {
		const folders: string[] = [];
		for (const entry of entries) {
			const directory = entry.kind === 'directory';
			const matched = rank(entry.path.slice(entry.path.lastIndexOf('/') + 1), needle);
			if (matched < 3) {
				found.push({ mention: { path: directory ? `${entry.path}/` : entry.path, directory }, rank: matched });
			}
			if (directory) folders.push(entry.path);
		}
		return folders;
	};

	let level = collect(await list(workspaceId, slash > 0 ? query.slice(0, slash) : '', options));
	if (slash === -1 && needle !== '') {
		let budget = folderBudget;
		while (level.length > 0 && budget > 0 && found.length < resultLimit) {
			const batch = level.slice(0, budget);
			budget -= batch.length;
			const listings = await Promise.allSettled(batch.map((folder) => list(workspaceId, folder, options)));
			level = listings.flatMap((outcome) => (outcome.status === 'fulfilled' ? collect(outcome.value) : []));
		}
	}

	return found
		.sort(
			(a, b) =>
				a.rank - b.rank ||
				Number(b.mention.directory) - Number(a.mention.directory) ||
				a.mention.path.length - b.mention.path.length ||
				a.mention.path.localeCompare(b.mention.path)
		)
		.slice(0, resultLimit)
		.map((entry) => entry.mention);
}
