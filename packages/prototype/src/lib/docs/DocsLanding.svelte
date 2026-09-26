<script lang="ts">
	import PauMark from '$lib/components/PauMark.svelte';
	import PiMark from '$lib/components/PiMark.svelte';
	import { featureDemos, type FeatureKey, type View } from './docs-data';
	import ProductPreview from './ProductPreview.svelte';

	let { onViewChange }: { onViewChange: (view: View) => void } = $props();
	let activeFeature = $state<FeatureKey>('sessions');
</script>

<main>
	<section
		class="grid min-h-148 max-w-7xl grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] items-center gap-[clamp(3rem,8vw,8rem)] px-[clamp(1.25rem,4vw,3rem)] py-[clamp(4rem,9vw,8rem)] mx-auto max-lg:grid-cols-1 max-lg:gap-16 max-md:min-h-0 max-md:pt-16"
		aria-labelledby="site-hero-title">
		<div>
			<p class="site-eyebrow">
				<span class="mr-1.5 inline-block size-2.25 rounded-full bg-site-highlight"></span> Agent IDE and orchestrator
			</p>
			<h2
				id="site-hero-title"
				class="site-heading m-0 max-w-[10ch] text-[clamp(3.5rem,6vw,6rem)] leading-[0.94] text-site-ink text-balance max-md:text-[clamp(3rem,15vw,4.2rem)]">
				The IDE for coding with agents.
			</h2>
			<p class="my-7 max-w-2xl text-[clamp(1.05rem,1.7vw,1.25rem)] leading-7 text-site-muted">
				Pau is built for developers using Pi, Claude Code, Codex, and Antigravity. Run concurrent sessions, direct their
				work, and use your editor and terminal from one local workspace.
			</p>
			<div class="flex flex-wrap gap-3">
				<button class="site-button-primary" type="button" onclick={() => onViewChange('guide')}
					>Explore Pau <span class="i-tabler-arrow-right" aria-hidden="true"></span></button>
				<button class="site-button" type="button" onclick={() => onViewChange('reference')}>See feature status</button>
			</div>
		</div>

		<div
			class="hero-orbit relative mx-auto aspect-square w-[min(100%,25rem)] max-lg:w-[min(80vw,23rem)]"
			aria-hidden="true">
			<div class="hero-orbit__path"></div>
			<div class="hero-orbit__core"><PauMark /></div>
			<span class="hero-orbit__node hero-orbit__node--pi"><PiMark class="size-8" /><small>Pi</small></span>
			<span class="hero-orbit__node hero-orbit__node--claude"
				><span class="i-logos-claude-code"></span><small>Claude Code</small></span>
			<span class="hero-orbit__node hero-orbit__node--codex"
				><span class="i-logos-codex"></span><small>Codex</small></span>
			<span class="hero-orbit__node hero-orbit__node--antigravity"
				><span class="i-logos-antigravity"></span><small>Antigravity</small></span>
		</div>
	</section>

	<section
		class="interactive-feature grid grid-cols-[minmax(16rem,0.72fr)_minmax(26rem,1.28fr)] gap-[clamp(2.5rem,6vw,6rem)] bg-site-deep px-[max(1.25rem,calc((100%_-_76rem)_/_2))] py-[clamp(4rem,8vw,7rem)] max-lg:grid-cols-1 max-md:px-4"
		aria-labelledby="feature-title">
		<div class="self-center max-lg:max-w-xl">
			<p class="site-eyebrow">Agent orchestration</p>
			<h2
				id="feature-title"
				class="site-heading m-0 text-[clamp(2rem,4vw,3.5rem)] leading-[1.05] text-site-ink text-balance">
				Direct every session from one workspace.
			</h2>
			<p class="leading-7 text-site-muted">
				Switch between active agents, inspect their files, and manage native tools without losing process state.
			</p>
			<div class="mt-7 flex flex-wrap gap-2" aria-label="Feature preview">
				{#each Object.entries(featureDemos) as [key, demo] (key)}
					<button
						class="min-h-11 border border-site-line bg-transparent px-3 py-2 font-650 text-site-muted hover:border-site-accent hover:text-site-ink aria-pressed:border-site-accent aria-pressed:bg-site-raised aria-pressed:text-site-ink"
						type="button"
						aria-pressed={activeFeature === key}
						onclick={() => (activeFeature = key as FeatureKey)}>{demo.label}</button>
				{/each}
			</div>
		</div>
		<ProductPreview {activeFeature} />
	</section>

	<section
		class="mx-auto max-w-7xl px-[clamp(1.25rem,4vw,3rem)] py-[clamp(4rem,8vw,7rem)] max-md:px-4"
		aria-labelledby="available-title">
		<div class="mb-12 grid grid-cols-[minmax(0,1fr)_minmax(16rem,28rem)] items-end gap-x-16 gap-y-4 max-lg:grid-cols-1">
			<p class="site-eyebrow col-span-full max-lg:col-auto">Feature status</p>
			<h2
				id="available-title"
				class="site-heading m-0 text-[clamp(2rem,4vw,3.5rem)] leading-[1.05] text-site-ink text-balance">
				What works now, and what comes next.
			</h2>
			<p class="m-0 leading-7 text-site-muted">
				Available features are implemented today. Planned features remain part of the first-release scope.
			</p>
		</div>
		<div class="grid grid-cols-2 border-l border-t border-site-line max-md:grid-cols-1">
			<div class="border-b border-r border-site-line p-[clamp(1.5rem,4vw,2.5rem)]">
				<h3 class="mb-6 mt-0 flex items-center gap-2 font-heading text-xl">
					<span class="size-2.5 rounded-full bg-site-accent"></span>Available
				</h3>
				<ul class="grid list-none gap-6 p-0">
					{#each [{ icon: 'i-tabler-messages', title: 'Session orchestration', text: 'Run Pi and Claude Code concurrently, steer work, and recover after reconnecting.' }, { icon: 'i-tabler-folders', title: 'Workspace inspection', text: 'Browse files, search content, and inspect Git status beside agent work.' }, { icon: 'i-tabler-plug-connected', title: 'Native MCP management', text: 'Edit and test Pi and Claude servers without taking over their credentials.' }] as item (item.title)}<li
							class="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3 text-[0.88rem] leading-6 text-site-muted">
							<span class={`${item.icon} mt-1 text-base text-site-accent`}></span><span class="grid gap-0.5"
								><strong class="text-[0.95rem] text-site-ink">{item.title}</strong>{item.text}</span>
						</li>{/each}
				</ul>
			</div>
			<div class="border-b border-r border-site-line p-[clamp(1.5rem,4vw,2.5rem)]">
				<h3 class="mb-6 mt-0 flex items-center gap-2 font-heading text-xl">
					<span class="size-2.5 rounded-full bg-site-focus"></span>Planned
				</h3>
				<ul class="grid list-none gap-6 p-0">
					{#each [{ icon: 'i-tabler-code', title: 'Editing and review', text: 'Edit files, navigate agent changes, and review diffs in the same workspace.' }, { icon: 'i-tabler-terminal-2', title: 'Terminal and external editors', text: 'Keep terminal editors alive and hand files to your preferred external editor.' }, { icon: 'i-tabler-shield-lock', title: 'Local execution controls', text: 'Inspect resource use and choose explicit sandbox and credential policies.' }] as item (item.title)}<li
							class="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3 text-[0.88rem] leading-6 text-site-muted">
							<span class={`${item.icon} mt-1 text-base text-site-accent`}></span><span class="grid gap-0.5"
								><strong class="text-[0.95rem] text-site-ink">{item.title}</strong>{item.text}</span>
						</li>{/each}
				</ul>
			</div>
		</div>
	</section>
</main>
