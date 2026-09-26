<script lang="ts">
	import type { WorkspaceFileSource, WorkspaceSearchMatch } from '../lib/types/workspace-files';
	import { workspaceFileFixtures } from '../fixtures/workspace-files';
	import WorkspaceFiles from '../lib/WorkspaceFiles.svelte';

	type State = 'default' | 'empty' | 'loading' | 'permission-error' | 'large-results';

	let { state = 'default' }: { state?: State } = $props();

	const pending = new Promise<never>(() => {});
	const permissionError = Object.assign(new Error('Permission denied'), { code: 'permission_denied' });
	const largeResults: WorkspaceSearchMatch[] = Array.from({ length: 300 }, (_, index) => ({
		path: `packages/workspace-${String(Math.floor(index / 20)).padStart(2, '0')}/src/feature-${index}.ts`,
		line: index + 1,
		preview: `export const matchingValue${index} = 'workspace';`
	}));

	let source: WorkspaceFileSource = $derived.by(() => ({
		listDirectory: async (path) => {
			if (state === 'loading') return pending;
			if (state === 'permission-error') throw permissionError;
			if (state === 'empty') return [];
			return structuredClone(workspaceFileFixtures.tree[path] ?? []);
		},
		search: async () => structuredClone(state === 'large-results' ? largeResults : workspaceFileFixtures.searchResults)
	}));
</script>

<WorkspaceFiles workspaceId="pau" workspaceName="pau" {source} />
