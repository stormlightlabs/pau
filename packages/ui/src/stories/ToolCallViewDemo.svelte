<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';

	import ToolCallView from '../lib/ToolCallView.svelte';
	import type { TranscriptTool } from '../lib/types/session';

	let { tools, initiallyOpen = true }: { tools: TranscriptTool[]; initiallyOpen?: boolean } = $props();
	const disclosures = new SvelteMap<string, boolean>();
</script>

<div style="display: grid; gap: var(--pau-space-5); max-width: 60rem; padding: var(--pau-space-5)">
	{#each tools as tool (tool.id)}
		<ToolCallView
			{tool}
			open={disclosures.get(tool.id) ?? initiallyOpen}
			onToggle={(open) => disclosures.set(tool.id, open)} />
	{/each}
</div>
