<script lang="ts">
	import { sessionFixtures } from '@stormlightlabs/pau-ui';
	import { onMount } from 'svelte';

	import { getBackendVersion } from '$lib/api';
	import SessionRoute from '$lib/SessionRoute.svelte';

	let disconnected = $state(false);

	onMount(() => {
		void getBackendVersion(location.search).catch(() => {
			disconnected = true;
		});
	});

	function updateSessionRoute(workspaceId: string, sessionId: string): void {
		history.replaceState({}, '', `/workspaces/${workspaceId}/sessions/${sessionId}${location.search}`);
	}
</script>

<svelte:head><title>Sessions · Pau</title></svelte:head>

<SessionRoute
	initialWorkspaces={sessionFixtures.concurrent}
	initialSessionId="diff-gutter"
	{disconnected}
	onSessionChange={updateSessionRoute} />
