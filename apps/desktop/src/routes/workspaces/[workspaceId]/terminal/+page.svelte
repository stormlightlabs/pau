<script lang="ts">
	import { page } from '$app/state';
	import { TerminalSurface } from '@stormlightlabs/pau-ui';
	import { onMount } from 'svelte';

	import { listWorkspaces } from '$lib/api';
	import { createTerminalSource } from '$lib/terminal-source';

	const workspaceId = page.params.workspaceId ?? '';
	const source = createTerminalSource(location.origin, workspaceId);

	let workspaceName = $state(workspaceId);
	let disconnected = $state(false);

	onMount(() => {
		void listWorkspaces()
			.then((workspaces) => {
				const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
				workspaceName = workspace?.name || workspace?.path.split(/[\\/]/).at(-1) || workspaceId;
			})
			.catch(() => {
				disconnected = true;
			});
	});
</script>

<svelte:head><title>Terminal · Pau</title></svelte:head>

<TerminalSurface {workspaceName} {source} {disconnected} />
