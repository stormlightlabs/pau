<script lang="ts">
	import { page } from '$app/state';
	import { productNavigation } from '$lib/app-navigation';
	import WorkspaceFilesRoute from '$lib/WorkspaceFilesRoute.svelte';
</script>

<svelte:head><title>Files · Pau</title></svelte:head>

<WorkspaceFilesRoute
	workspaceId={page.params.workspaceId ?? ''}
	productItems={productNavigation(page.route.id, page.params.workspaceId)} />
