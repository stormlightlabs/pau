export type WorkspaceFileKind = 'file' | 'directory' | 'symlink';

export type WorkspaceGitFileState =
	'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'type_changed' | 'untracked';

/** Git state for one changed workspace path. */
export type WorkspaceGitFileStatus = {
	path: string;
	previous_path: string | null;
	staged: WorkspaceGitFileState | null;
	worktree: WorkspaceGitFileState | null;
	conflicted: boolean;
};

/** Branch and changed-file state for a workspace. */
export type WorkspaceGitStatus = {
	repository: boolean;
	branch: string | null;
	head: string | null;
	detached: boolean;
	files: WorkspaceGitFileStatus[];
};

/** Text content for one changed file against Git `HEAD`. */
export type WorkspaceGitDiff = {
	path: string;
	previous_path: string | null;
	old_content: string | null;
	new_content: string | null;
	binary: boolean;
	too_large: boolean;
};

/** One file-system object returned by the workspace file API. */
export type WorkspaceFileEntry = { path: string; kind: WorkspaceFileKind; size: number | null };

/** One matching line returned by workspace content search. */
export type WorkspaceSearchMatch = { path: string; line: number; preview: string };

/** Visibility options shared by directory listing and content search. */
export type WorkspaceTraversalOptions = { includeHidden: boolean; includeIgnored: boolean };

/** Async file operations supplied by the application transport layer. */
export type WorkspaceFileSource = {
	listDirectory: (path: string, options: WorkspaceTraversalOptions) => Promise<WorkspaceFileEntry[]>;
	search: (query: string, options: WorkspaceTraversalOptions) => Promise<WorkspaceSearchMatch[]>;
	gitStatus: () => Promise<WorkspaceGitStatus>;
	gitDiff: (path: string) => Promise<WorkspaceGitDiff>;
};
