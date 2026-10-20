<script lang="ts">
	import { ApplicationShell, ProcessesView } from '@stormlightlabs/pau-ui';
	import { onMount } from 'svelte';
	import { page } from '$app/state';

	import { listWorkspaces } from '$lib/api';
	import { productNavigation } from '$lib/app-navigation';

	let workspaceId = $derived(page.params.workspaceId ?? '');
	let workspaceName = $state<string>();

	onMount(() => {
		void listWorkspaces()
			.then((workspaces) => {
				const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
				workspaceName = workspace?.name || workspace?.path.split(/[\\/]/).at(-1);
			})
			.catch(() => {});
	});
</script>

<svelte:head><title>Processes · Pau</title></svelte:head>

<!-- The server does not report process resource use yet, so the view says so instead of listing sample data. -->
<ApplicationShell
	workspaceName={workspaceName ?? workspaceId}
	contextLabel="Processes"
	productItems={productNavigation(page.route.id, workspaceId)}
	contextItems={[]}>
	<ProcessesView
		workspaceName={workspaceName ?? workspaceId}
		processes={[]}
		unavailable="Pau doesn't collect resource use for workspace processes yet. Sessions and terminals keep running as usual." />
</ApplicationShell>
