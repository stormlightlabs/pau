<script lang="ts">
	import '../styles/tokens.css';
	import type { Snippet } from 'svelte';

	/**
	 * Outlined chip for a feature's on or off state, such as sandbox, MCP, and
	 * diagnostics. An off state uses muted text because it is neutral, not an
	 * error.
	 */
	let { on, children }: { on: boolean; children: Snippet } = $props();
</script>

<span class="state-chip" class:state-chip--on={on}>{@render children()}</span>

<style>
	.state-chip {
		flex: none;
		padding: var(--pau-space-1) var(--pau-space-2);
		color: var(--pau-text-muted);
		border: 1px solid var(--pau-border);
		font-size: var(--pau-type-xs);
	}

	.state-chip--on {
		color: var(--pau-accent);
		border-color: var(--pau-accent);
	}
</style>
