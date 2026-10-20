<script lang="ts">
	import { shellNavigationFixtures } from '../fixtures/application-shell';
	import ApplicationShell, { type ShellNavItem } from '../lib/ApplicationShell.svelte';
	import ProcessesView from '../lib/ProcessesView.svelte';
	import type { ProcessResourceSnapshot } from '../lib/types/resource-monitoring';

	let {
		processes,
		unavailable,
		inShell = false
	}: {
		processes: ProcessResourceSnapshot[];
		unavailable?: string;
		/** Shows the view in the application shell, as the desktop route does. */
		inShell?: boolean;
	} = $props();
	let lastAction = $state('No action requested');

	const productItems: ShellNavItem[] = [
		...shellNavigationFixtures.productItems.map((item) => ({ ...item, active: false })),
		{ id: 'processes', label: 'Processes', icon: 'processes', href: '#processes', active: true }
	];
</script>

{#snippet view()}
	<ProcessesView
		workspaceName="Pau"
		{processes}
		{unavailable}
		actions={Object.fromEntries(processes.map((process) => [process.processId, { interrupt: true, stop: true }]))}
		onInterrupt={(sessionId) => (lastAction = `Interrupted ${sessionId}`)}
		onStop={(sessionId) => (lastAction = `Stopped ${sessionId}`)} />
{/snippet}

{#if inShell}
	<ApplicationShell workspaceName="Pau" contextLabel="Processes" {productItems} contextItems={[]}>
		{@render view()}
	</ApplicationShell>
{:else}
	{@render view()}
{/if}
<p aria-live="polite" style="position: fixed; inset: auto 1rem 1rem auto; margin: 0; color: var(--pau-text-muted)">
	{lastAction}
</p>
