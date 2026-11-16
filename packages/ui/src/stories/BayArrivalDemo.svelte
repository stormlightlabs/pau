<script lang="ts">
	import { bayFixtures } from '../fixtures/bay';
	import SessionViewDemo from './SessionViewDemo.svelte';

	/**
	 * The busy bay with a control that moves Diff gutter numbers from Running
	 * into Needs you, as the event stream would, so the arrival plays.
	 */
	let arrived = $state(false);
</script>

<SessionViewDemo workspaces={arrived ? bayFixtures.arrived : bayFixtures.busy} initialSessionId="sandbox-pi" />
<button type="button" class="pau-button pau-button--secondary arrival-trigger" onclick={() => (arrived = !arrived)}>
	{arrived ? 'Diff gutter numbers runs again' : 'Diff gutter numbers asks for you'}
</button>

<style>
	.arrival-trigger {
		position: fixed;
		right: var(--pau-space-4);
		bottom: var(--pau-space-4);
		z-index: 40;
	}
</style>
