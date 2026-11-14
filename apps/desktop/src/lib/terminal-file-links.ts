import type { TerminalFileLinks } from '@stormlightlabs/pau-ui';

import { listWorkspaceFiles } from './api';

/**
 * Links workspace file paths in terminal output to the built-in editor. A
 * path counts only when its directory listing holds it as a regular file, so
 * a symlink, a directory, or a path outside the workspace stays plain text.
 *
 * @param open Shows a file in the editor, at `line` when the output named one.
 */
export function createTerminalFileLinks(
	workspaceId: string,
	open: (path: string, line?: number) => void,
	fetcher: typeof fetch = fetch
): TerminalFileLinks {
	return {
		exists: async (path) => {
			const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
			const entries = await listWorkspaceFiles(
				workspaceId,
				directory,
				{ includeHidden: true, includeIgnored: true },
				fetcher
			);
			return entries.some((entry) => entry.path === path && entry.kind === 'file');
		},
		open
	};
}
