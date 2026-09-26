import type { WorkspaceFileEntry, WorkspaceSearchMatch } from '../lib/types/workspace-files';

/** Representative directory data for file-tree stories and component tests. */
export const workspaceFileFixtures: {
	tree: Record<string, WorkspaceFileEntry[]>;
	searchResults: WorkspaceSearchMatch[];
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
	searchResults: [
		{
			path: 'packages/ui/src/lib/SessionView.svelte',
			line: 42,
			preview: 'const sessions = $derived(workspaces.flatMap(...));'
		},
		{
			path: 'dev/SPEC.md',
			line: 78,
			preview: 'Browse workspace files with ignored and hidden files handled predictably.'
		}
	]
};
