<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	import { openFileQuery, productNavigation } from '$lib/app-navigation';
	import { interfacePreferences } from '$lib/interface-preferences.svelte';
	import SessionRoute from '$lib/SessionRoute.svelte';

	function updateSessionRoute(workspaceId: string, sessionId: string): void {
		history.replaceState({}, '', `/workspaces/${workspaceId}/sessions/${sessionId}`);
	}
</script>

<svelte:head><title>Session · Pau</title></svelte:head>

<SessionRoute
	initialSessionId={page.params.sessionId}
	onRouteChange={(route) => interfacePreferences.rememberRoute(route)}
	onSessionChange={updateSessionRoute}
	onOpenTerminal={(workspaceId) => void goto(resolve('/workspaces/[workspaceId]/terminal', { workspaceId }))}
	onOpenFile={(workspaceId, path, line) =>
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- the route is resolved; only the query is added
		void goto(resolve('/workspaces/[workspaceId]/editor', { workspaceId }) + openFileQuery(path, line))}
	navigation={(workspaceId) => productNavigation(page.route.id, workspaceId)} />
