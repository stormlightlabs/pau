import type {
	WorkspaceFileEntry,
	WorkspaceGitDiff,
	WorkspaceGitStatus,
	WorkspaceSearchMatch
} from '../lib/types/workspace-files';

/** Representative directory data for file-tree stories and component tests. */
export const workspaceFileFixtures: {
	tree: Record<string, WorkspaceFileEntry[]>;
	searchResults: WorkspaceSearchMatch[];
	gitStatus: WorkspaceGitStatus;
	diffs: Record<string, WorkspaceGitDiff>;
} = {
	tree: {
		'': [
			{ path: 'dev', kind: 'directory', size: null },
			{ path: 'packages', kind: 'directory', size: null },
			{ path: 'Cargo.toml', kind: 'file', size: 2148 },
			{ path: 'README.md', kind: 'file', size: 4096 }
		],
		dev: [
			{ path: 'dev/design', kind: 'directory', size: null },
			{ path: 'dev/ROADMAP.md', kind: 'file', size: 18_420 }
		],
		'dev/design': [{ path: 'dev/design/surfaces.md', kind: 'file', size: 9804 }],
		packages: [{ path: 'packages/ui', kind: 'directory', size: null }],
		'packages/ui': [{ path: 'packages/ui/src', kind: 'directory', size: null }],
		'packages/ui/src': [{ path: 'packages/ui/src/lib', kind: 'directory', size: null }],
		'packages/ui/src/lib': [
			{
				path: 'packages/ui/src/lib/components/workspace/navigation/WorkspaceFileTreeWithAnIntentionallyLongName.svelte',
				kind: 'file',
				size: 12_880
			}
		]
	},
	gitStatus: {
		repository: true,
		branch: 'feature/git-status',
		head: '1234567890abcdef',
		detached: false,
		files: [
			{
				path: 'packages/ui/src/lib/WorkspaceFiles.svelte',
				previous_path: null,
				staged: null,
				worktree: 'modified',
				conflicted: false
			},
			{
				path: 'apps/web/src/lib/old-route.ts',
				previous_path: 'apps/web/src/lib/route.ts',
				staged: 'renamed',
				worktree: null,
				conflicted: false
			},
			{ path: 'notes.txt', previous_path: null, staged: null, worktree: 'untracked', conflicted: false },
			{ path: 'new-file.ts', previous_path: null, staged: 'added', worktree: null, conflicted: false },
			{ path: 'removed-file.ts', previous_path: null, staged: null, worktree: 'deleted', conflicted: false },
			{ path: 'dev/DECISIONS.md', previous_path: null, staged: null, worktree: null, conflicted: true }
		]
	},
	diffs: {
		'packages/ui/src/lib/WorkspaceFiles.svelte': {
			path: 'packages/ui/src/lib/WorkspaceFiles.svelte',
			previous_path: null,
			old_content:
				"const label = 'Files';\nconst path = selected.path;\n\nfunction open() {\n\treturn path;\n}\n\nconst longLine = 'This unchanged line is intentionally long enough to exercise horizontal scrolling before line wrapping is enabled in the diff toolbar.';\n",
			new_content:
				"const label = 'Workspace files';\nconst path = selected.path;\nconst review = true;\n\nfunction open() {\n\treturn review ? path : '';\n}\n\nconst longLine = 'This changed line is intentionally long enough to exercise horizontal scrolling before line wrapping is enabled in the diff toolbar and remains readable afterward.';\n",
			binary: false,
			too_large: false
		},
		'assets/screenshot.png': {
			path: 'assets/screenshot.png',
			previous_path: null,
			old_content: null,
			new_content: null,
			binary: true,
			too_large: false
		}
	},
	searchResults: [
		{
			path: 'packages/ui/src/lib/SessionView.svelte',
			line: 42,
			preview: 'const sessions = $derived(workspaces.flatMap(...));'
		},
		{
			path: 'dev/design/surfaces.md',
			line: 78,
			preview: 'Browse workspace files with ignored and hidden files handled predictably.'
		}
	]
};
