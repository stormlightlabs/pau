<script lang="ts">
	import { page } from '$app/state';
	import WorkspaceFilesRoute from '$lib/WorkspaceFilesRoute.svelte';
</script>

<svelte:head><title>Files · Pau</title></svelte:head>

<WorkspaceFilesRoute workspaceId={page.params.workspaceId ?? ''} />
