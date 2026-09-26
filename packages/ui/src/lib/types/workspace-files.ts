export type WorkspaceFileKind = 'file' | 'directory' | 'symlink';

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
};
