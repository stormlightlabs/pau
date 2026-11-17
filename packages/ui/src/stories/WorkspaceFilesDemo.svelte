<script lang="ts">
	import type { WorkspaceFileSource, WorkspaceSearchMatch } from '../lib/types/workspace-files';
	import { workspaceFileFixtures } from '../fixtures/workspace-files';
	import type { ThemeName, UiFontName } from '../theme';
	import WorkspaceFiles from '../lib/WorkspaceFiles.svelte';

	type State = 'default' | 'detached' | 'empty' | 'loading' | 'non-repository' | 'permission-error' | 'large-results';

	let { state: view = 'default', theme, uiFont }: { state?: State; theme?: ThemeName; uiFont?: UiFontName } = $props();
	/** The last action the view sent, shown in a corner once there is one. */
	let lastAction = $state('');

	const pending = new Promise<never>(() => {});
	const permissionError = Object.assign(new Error('Permission denied'), { code: 'permission_denied' });
	const largeResults: WorkspaceSearchMatch[] = Array.from({ length: 300 }, (_, index) => ({
		path: `packages/workspace-${String(Math.floor(index / 20)).padStart(2, '0')}/src/feature-${index}.ts`,
		line: index + 1,
		preview: `export const matchingValue${index} = 'workspace';`
	}));

	let source: WorkspaceFileSource = $derived.by(() => ({
		listDirectory: async (path) => {
			if (view === 'loading') return pending;
			if (view === 'permission-error') throw permissionError;
			if (view === 'empty') return [];
			return structuredClone(workspaceFileFixtures.tree[path] ?? []);
		},
		search: async () => structuredClone(view === 'large-results' ? largeResults : workspaceFileFixtures.searchResults),
		gitStatus: async () => {
			const status = structuredClone(workspaceFileFixtures.gitStatus);
			if (view === 'detached') return { ...status, branch: null, detached: true };
			if (view === 'non-repository') {
				return { repository: false, branch: null, head: null, detached: false, files: [] };
			}
			return status;
		},
		gitDiff: async (path) =>
			structuredClone(
				workspaceFileFixtures.diffs[path] ?? {
					path,
					previous_path: null,
					old_content: 'before\n',
					new_content: 'after\n',
					binary: false,
					too_large: false
				}
			)
	}));
</script>

<WorkspaceFiles
	workspaceId="pau"
	workspaceName="pau"
	workspacePath="/Users/operator/projects/pau"
	{source}
	{theme}
	{uiFont}
	revealPath={async (path) => {
		lastAction = `reveal ${path}`;
	}} />

<p class="action" aria-live="polite" hidden={!lastAction}>{lastAction}</p>

<style>
	.action {
		position: fixed;
		right: 0.75rem;
		bottom: 0.75rem;
		z-index: 10;
		margin: 0;
		padding: var(--pau-space-2);
		color: var(--pau-text-muted);
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border);
		font: var(--pau-type-xs) var(--pau-font-ui);
	}
</style>
