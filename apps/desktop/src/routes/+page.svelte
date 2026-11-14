<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	import { claimLaunchRoute, openFileInEditor, productNavigation, WORKSPACE_VIEW_ROUTES } from '$lib/app-navigation';
	import { interfacePreferences } from '$lib/interface-preferences.svelte';
	import SessionRoute from '$lib/SessionRoute.svelte';

	const restoreLastRoute = claimLaunchRoute();

	function updateSessionRoute(workspaceId: string, sessionId: string): void {
		history.replaceState({}, '', `/workspaces/${workspaceId}/sessions/${sessionId}`);
	}
</script>

<svelte:head><title>Sessions · Pau</title></svelte:head>

<SessionRoute
	{restoreLastRoute}
	onRouteChange={(route) => interfacePreferences.rememberRoute(route)}
	onOpenView={(view, workspaceId) =>
		void goto(resolve(WORKSPACE_VIEW_ROUTES[view], { workspaceId }), { replaceState: true })}
	onSessionChange={updateSessionRoute}
	onOpenTerminal={(workspaceId) => void goto(resolve('/workspaces/[workspaceId]/terminal', { workspaceId }))}
	onOpenFile={openFileInEditor}
	navigation={(workspaceId) => productNavigation(page.route.id, workspaceId)} />
