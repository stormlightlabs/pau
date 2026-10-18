<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	import { productNavigation } from '$lib/app-navigation';
	import SessionRoute from '$lib/SessionRoute.svelte';

	function updateSessionRoute(workspaceId: string, sessionId: string): void {
		history.replaceState({}, '', `/workspaces/${workspaceId}/sessions/${sessionId}`);
	}
</script>

<svelte:head><title>Session · Pau</title></svelte:head>

<SessionRoute
	initialSessionId={page.params.sessionId}
	onSessionChange={updateSessionRoute}
	onOpenTerminal={(workspaceId) => void goto(resolve('/workspaces/[workspaceId]/terminal', { workspaceId }))}
	navigation={(workspaceId) => productNavigation(page.route.id, workspaceId)} />
