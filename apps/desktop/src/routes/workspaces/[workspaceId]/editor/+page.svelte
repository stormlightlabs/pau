<script lang="ts">
	import { page } from '$app/state';
	import { productNavigation } from '$lib/app-navigation';
	import WorkspaceFilesRoute from '$lib/WorkspaceFilesRoute.svelte';

	// A terminal link opens a file with `?path=src/main.rs&line=12`.
	const openPath = $derived(page.url.searchParams.get('path') ?? undefined);
	const openLine = $derived(Number(page.url.searchParams.get('line')) || undefined);
</script>

<svelte:head><title>Files · Pau</title></svelte:head>

<WorkspaceFilesRoute
	workspaceId={page.params.workspaceId ?? ''}
	{openPath}
	{openLine}
	productItems={productNavigation(page.route.id, page.params.workspaceId)} />
