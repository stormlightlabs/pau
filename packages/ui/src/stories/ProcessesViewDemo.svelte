<script lang="ts">
	import ProcessesView from '../lib/ProcessesView.svelte';
	import type { ProcessResourceSnapshot } from '../lib/types/resource-monitoring';

	let { processes }: { processes: ProcessResourceSnapshot[] } = $props();
	let lastAction = $state('No action requested');
</script>

<ProcessesView
	workspaceName="Pau"
	{processes}
	actions={Object.fromEntries(processes.map((process) => [process.processId, { interrupt: true, stop: true }]))}
	onInterrupt={(sessionId) => (lastAction = `Interrupted ${sessionId}`)}
	onStop={(sessionId) => (lastAction = `Stopped ${sessionId}`)} />
<p aria-live="polite" style="position: fixed; inset: auto 1rem 1rem auto; margin: 0; color: var(--pau-text-muted)">
	{lastAction}
</p>
