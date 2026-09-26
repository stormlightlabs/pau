/** UTF-8 file content returned by the workspace file API. */
export type EditorFileContent = { path: string; content: string; revision: string; writable: boolean };

/** File operations supplied to the built-in editor by the application. */
export type FileEditorSource = {
	read: (path: string) => Promise<EditorFileContent>;
	write: (path: string, content: string, expectedRevision: string) => Promise<EditorFileContent>;
};
