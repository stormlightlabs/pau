<script lang="ts">
	import { ProcessesView, resourceMonitoringFixtures } from '@stormlightlabs/pau-ui';
</script>

<svelte:head><title>Processes · Pau</title></svelte:head>

<ProcessesView workspaceName="Pau" processes={resourceMonitoringFixtures.active} />
