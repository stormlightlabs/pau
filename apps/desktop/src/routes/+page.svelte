<script lang="ts">
	import SessionRoute from '$lib/SessionRoute.svelte';

	function updateSessionRoute(workspaceId: string, sessionId: string): void {
		history.replaceState({}, '', `/workspaces/${workspaceId}/sessions/${sessionId}${location.search}`);
	}
</script>

<svelte:head><title>Sessions · Pau</title></svelte:head>

<SessionRoute search={location.search} onSessionChange={updateSessionRoute} />
