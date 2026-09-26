<script lang="ts">
	import PauMark from './PauMark.svelte';

	let {
		context,
		branch,
		theme,
		actions,
		children
	}: {
		context: string;
		branch?: string;
		/** Renders the mock in one of the shipped themes. */
		theme?: 'eldritch' | 'nord' | 'iceberg' | 'catppuccin' | 'vitesse';
		/** Adds controls that change the visibility of shell regions. */
		actions?: import('svelte').Snippet;
		children: import('svelte').Snippet;
	} = $props();

	const activeTab = $derived(context.split('/').at(-1)?.trim() ?? context);
</script>

<section class="mock-app" data-theme={theme} aria-label={`${context} application mockup`}>
	<header class="mock-app__topbar">
		<span class="mock-app__logo"><PauMark /></span>
		<nav class="mock-app__history" aria-label="View history">
			<button type="button" aria-label="Go back"><span class="i-tabler-arrow-left" aria-hidden="true"></span></button>
			<button type="button" aria-label="Go forward" disabled
				><span class="i-tabler-arrow-right" aria-hidden="true"></span></button>
			<button type="button" aria-label="Go home"><span class="i-tabler-home" aria-hidden="true"></span></button>
		</nav>
		<div class="mock-app__crumbs">
			<strong>Pau</strong><span>/</span><span class="truncate">{context}</span>
			{#if branch}
				<span class="chip chip--code"><span class="i-octicon-git-branch-16" aria-hidden="true"></span>{branch}</span>
			{/if}
		</div>
		{#if actions}
			<div class="mock-app__view-actions">{@render actions()}</div>
		{/if}
		<button class="mock-app__command" type="button" aria-label="Open command menu">
			<span class="i-tabler-search" aria-hidden="true"></span>
			<span class="mock-app__command-label">Search or run a command</span>
			<kbd class="ml-auto">⌘K</kbd>
		</button>
	</header>
	<nav class="mock-app__tabs" aria-label="Open views">
		<button type="button"><span class="i-tabler-folder-code" aria-hidden="true"></span>pau</button>
		<button type="button" aria-current="page"
			><span class="i-tabler-layout-dashboard" aria-hidden="true"></span>{activeTab}<span
				class="i-tabler-x"
				aria-hidden="true"></span
			></button>
		<button type="button" aria-label="Open view"><span class="i-tabler-plus" aria-hidden="true"></span></button>
	</nav>
	{@render children()}
</section>
