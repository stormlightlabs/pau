<script lang="ts">
	import { capabilities } from './docs-data';

	let referenceQuery = $state('');
	let filteredCapabilities = $derived(
		capabilities.filter((capability) =>
			`${capability.name} ${capability.area} ${capability.status}`.toLowerCase().includes(referenceQuery.toLowerCase())
		)
	);
</script>

<main
	class="mx-auto min-h-200 max-w-6xl px-[clamp(1.25rem,4vw,3rem)] py-[clamp(4rem,8vw,7rem)] max-md:px-4 max-md:py-14">
	<header
		class="mb-12 grid grid-cols-[minmax(0,1fr)_minmax(18rem,25rem)] items-end gap-x-16 gap-y-4 max-lg:grid-cols-1">
		<p class="site-eyebrow col-span-full max-lg:col-auto">Capability reference</p>
		<h1 class="site-heading m-0 text-[clamp(2.8rem,6vw,5rem)]! leading-none text-site-ink">What Pau can do</h1>
		<p class="m-0 leading-7 text-site-muted">
			Current behavior and first-release plans, separated so you can tell what is ready to use.
		</p>
		<label
			class="col-span-full mt-4 flex min-h-11 items-center gap-2 border border-site-line bg-site-raised px-3 max-lg:col-auto">
			<span class="i-tabler-search text-site-muted" aria-hidden="true"></span><span class="sr-only"
				>Filter capabilities</span
			><input
				class="min-w-0 flex-1 border-0 bg-transparent text-site-ink outline-none"
				bind:value={referenceQuery}
				type="search"
				placeholder="Filter by feature, area, or status" />
		</label>
	</header>

	<div class="border-t border-site-line" aria-live="polite">
		<div
			class="grid grid-cols-[minmax(0,1fr)_10rem_8rem] items-center gap-6 px-4 py-3 text-[0.68rem] font-700 tracking-[0.07em] uppercase text-site-muted max-md:hidden">
			<span>Capability</span><span>Area</span><span>Status</span>
		</div>
		{#each filteredCapabilities as capability (capability.name)}
			<article
				class="grid grid-cols-[minmax(0,1fr)_10rem_8rem] items-center gap-6 border-t border-site-line px-4 py-5 max-md:grid-cols-[1fr_auto] max-md:gap-3 max-md:px-0">
				<div class="max-md:col-span-full">
					<h2 class="m-0 font-heading text-[1.05rem]">{capability.name}</h2>
					<p class="mb-0 mt-1 max-w-[58ch] text-[0.82rem] leading-6 text-site-muted">{capability.description}</p>
				</div>
				<span class="text-[0.82rem] text-site-muted max-md:order-2">{capability.area}</span>
				<strong class="inline-flex items-center gap-2 text-[0.78rem]" data-status={capability.status.toLowerCase()}
					><i class={`size-2.25 rounded-full ${capability.status === 'Planned' ? 'bg-site-focus' : 'bg-site-accent'}`}
					></i
					>{capability.status}</strong>
			</article>
		{:else}
			<p class="px-4 py-12 text-site-muted">No capabilities match “{referenceQuery}”.</p>
		{/each}
	</div>
</main>
