<script lang="ts">
	import PauMark from '$lib/components/PauMark.svelte';
	import type { View } from './docs-data';

	let { onViewChange }: { onViewChange: (view: View) => void } = $props();
</script>

<footer
	class="grid grid-cols-[1fr_minmax(18rem,34rem)_1fr] items-center gap-8 border-t border-site-line bg-site-deep px-[clamp(1.25rem,4vw,3rem)] py-8 max-lg:grid-cols-[1fr_auto] max-md:px-4 max-md:py-6">
	<div class="flex items-center gap-2.5">
		<span class="size-7"><PauMark /></span>
		<span class="grid">
			<strong class="font-heading">Pau</strong>
			<small class="text-[0.72rem] text-site-muted">Agent IDE and orchestrator</small>
		</span>
	</div>
	<p class="m-0 text-center text-[0.72rem] text-site-muted max-lg:hidden">
		This prototype includes planned work. Check the capability reference before relying on a feature.
	</p>
	<nav class="flex justify-end gap-4" aria-label="Footer">
		<button
			class="border-0 bg-transparent p-0 text-[0.78rem] text-site-muted"
			type="button"
			onclick={() => onViewChange('guide')}>Docs</button>
		<button
			class="border-0 bg-transparent p-0 text-[0.78rem] text-site-muted"
			type="button"
			onclick={() => onViewChange('reference')}>Status</button>
		<a class="text-[0.78rem] text-site-muted no-underline" href="https://github.com/stormlightlabs">GitHub</a>
	</nav>
</footer>
