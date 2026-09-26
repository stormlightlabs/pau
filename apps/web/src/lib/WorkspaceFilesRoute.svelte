<script lang="ts">
	import { WorkspaceFiles, type WorkspaceFileSource } from '@stormlightlabs/pau-ui';
	import { onMount } from 'svelte';

	import { listWorkspaceFiles, listWorkspaces, searchWorkspaceFiles } from './api';

	let { workspaceId }: { workspaceId: string } = $props();

	let resolvedWorkspaceName = $state<string>();
	let workspaceName = $derived(resolvedWorkspaceName ?? workspaceId);
	let disconnected = $state(false);
	const source: WorkspaceFileSource = {
		listDirectory: (path, options) => listWorkspaceFiles(location.search, workspaceId, path, options),
		search: (query, options) => searchWorkspaceFiles(location.search, workspaceId, query, options)
	};

	onMount(() => {
		void listWorkspaces(location.search)
			.then((workspaces) => {
				const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
				resolvedWorkspaceName = workspace?.name || workspace?.path.split(/[\\/]/).at(-1) || workspaceId;
			})
			.catch(() => {
				disconnected = true;
			});
	});
</script>

<WorkspaceFiles {workspaceId} {workspaceName} {source} {disconnected} />
