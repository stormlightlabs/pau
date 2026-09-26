<script lang="ts">
	let {
		active
	}: {
		active:
			| 'home'
			| 'sessions'
			| 'orchestration'
			| 'scratchpad'
			| 'editor'
			| 'neovim'
			| 'terminal'
			| 'processes'
			| 'resources'
			| 'settings';
	} = $props();

	const items = [
		{ name: 'home', label: 'Dashboard', icon: 'i-tabler-home' },
		{ name: 'sessions', label: 'Sessions', icon: 'i-tabler-layers-subtract' },
		{ name: 'orchestration', label: 'Harness control', icon: 'i-tabler-topology-star-3' },
		{ name: 'scratchpad', label: 'Scratchpad', icon: 'i-tabler-notebook' },
		{ name: 'editor', label: 'Editor', icon: 'i-tabler-code' },
		{ name: 'terminal', label: 'Terminal', icon: 'i-tabler-terminal-2' },
		{ name: 'processes', label: 'Processes', icon: 'i-tabler-activity-heartbeat' },
		{ name: 'resources', label: 'Resources', icon: 'i-tabler-plug-connected' }
	] as const;
</script>

<nav class="mock-product-rail" aria-label="Product areas">
	{#each items as item (item.name)}
		<button
			class="icon-button"
			type="button"
			title={item.label}
			aria-label={item.label}
			aria-pressed={active === item.name}>
			<span class={item.icon} aria-hidden="true"></span>
		</button>
	{/each}
	<button class="icon-button" type="button" title="Settings" aria-label="Settings" aria-pressed={active === 'settings'}>
		<span class="i-tabler-adjustments" aria-hidden="true"></span>
	</button>
</nav>
