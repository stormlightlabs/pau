<script lang="ts">
	import { page } from '$app/state';

	import SessionRoute from '$lib/SessionRoute.svelte';

	function updateSessionRoute(workspaceId: string, sessionId: string): void {
		history.replaceState({}, '', `/workspaces/${workspaceId}/sessions/${sessionId}`);
	}
</script>

<svelte:head><title>Session · Pau</title></svelte:head>

<SessionRoute initialSessionId={page.params.sessionId} onSessionChange={updateSessionRoute} />
