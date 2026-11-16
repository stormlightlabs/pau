<script lang="ts">
	import '../styles/tokens.css';
	import type { Snippet } from 'svelte';

	/**
	 * Chip for a feature's on or off state, such as sandbox, MCP, and
	 * diagnostics. It is a neutral fact, so it takes the shared `pau-chip`
	 * look and never a state or accent color. On reads in text color and off
	 * in muted text, and the label says which.
	 */
	let { on, children }: { on: boolean; children: Snippet } = $props();
</script>

<span class="pau-chip state-chip" class:state-chip--on={on}><span>{@render children()}</span></span>

<style>
	.state-chip--on {
		color: var(--pau-text);
	}
</style>
