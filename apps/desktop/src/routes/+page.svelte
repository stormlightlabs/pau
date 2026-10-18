<script lang="ts">
	import { page } from '$app/state';

	import { productNavigation } from '$lib/app-navigation';
	import SessionRoute from '$lib/SessionRoute.svelte';

	function updateSessionRoute(workspaceId: string, sessionId: string): void {
		history.replaceState({}, '', `/workspaces/${workspaceId}/sessions/${sessionId}`);
	}
</script>

<svelte:head><title>Sessions · Pau</title></svelte:head>

<SessionRoute
	onSessionChange={updateSessionRoute}
	navigation={(workspaceId) => productNavigation(page.route.id, workspaceId)} />
