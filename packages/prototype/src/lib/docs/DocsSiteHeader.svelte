<script lang="ts">
	import PauMark from '$lib/components/PauMark.svelte';
	import { views, type Theme, type View } from './docs-data';

	let {
		activeView,
		theme,
		onViewChange,
		onThemeChange
	}: { activeView: View; theme: Theme; onViewChange: (view: View) => void; onThemeChange: (theme: Theme) => void } =
		$props();
</script>

<header
	class="site-header grid min-h-17 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-site-line bg-site-paper px-[clamp(1rem,3vw,2.5rem)] max-md:grid-cols-[auto_1fr_auto] max-md:min-h-15 max-md:px-3">
	<button
		class="inline-flex w-fit items-center gap-2.5 border-0 bg-transparent p-0 font-heading text-[1.1rem] font-650 text-site-ink"
		type="button"
		onclick={() => onViewChange('landing')}
		aria-label="Pau home">
		<span class="grid size-7 place-items-center text-site-accent"><PauMark /></span>
		<span class="max-md:hidden">Pau</span>
	</button>

	<nav class="flex h-17 items-stretch gap-6 overflow-x-auto max-md:h-15 max-md:gap-3" aria-label="Website views">
		{#each views as view (view.id)}
			<button
				type="button"
				class="site-tab relative border-0 bg-transparent px-0.5 text-[0.9rem] font-600 text-site-muted max-md:text-[0.78rem]"
				class:site-tab--active={activeView === view.id}
				aria-current={activeView === view.id ? 'page' : undefined}
				onclick={() => onViewChange(view.id)}>{view.label}</button>
		{/each}
	</nav>

	<div class="flex items-center justify-end gap-2 max-md:gap-0">
		<button
			class="grid size-11 place-items-center border-0 bg-transparent text-[1.1rem] text-site-ink hover:bg-site-deep"
			type="button"
			onclick={() => onThemeChange(theme === 'light' ? 'dark' : 'light')}
			aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} theme`}>
			<span class={theme === 'light' ? 'i-tabler-moon' : 'i-tabler-sun'} aria-hidden="true"></span>
		</button>
		<a
			class="inline-flex min-h-11 items-center gap-2 px-1 text-[0.86rem] font-600 text-site-ink no-underline"
			href="https://github.com/stormlightlabs"
			aria-label="Pau on GitHub">
			<span class="i-simple-icons-github" aria-hidden="true"></span>
			<span class="max-md:hidden">GitHub</span>
		</a>
	</div>
</header>
