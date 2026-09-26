<script lang="ts">
	import DocsGuide from '$lib/docs/DocsGuide.svelte';
	import DocsLanding from '$lib/docs/DocsLanding.svelte';
	import DocsReference from '$lib/docs/DocsReference.svelte';
	import DocsSiteFooter from '$lib/docs/DocsSiteFooter.svelte';
	import DocsSiteHeader from '$lib/docs/DocsSiteHeader.svelte';
	import type { Theme, View } from '$lib/docs/docs-data';
	import '$lib/docs/docs-site.css';

	let activeView = $state<View>('landing');
	let theme = $state<Theme>('light');
</script>

<svelte:head>
	<title>Pau documentation site study</title>
	<meta
		name="description"
		content="A prototype for Pau's public landing page, documentation shell, and product reference." />
</svelte:head>

<article class="docs-study prototype-page max-md:px-0" data-prototype-ready>
	<header class="prototype-page__header max-md:px-3">
		<div>
			<div class="prototype-kicker">Website study</div>
			<h1>Documentation and product site</h1>
		</div>
		<p class="prototype-page__note">
			This fixture presents Pau as an IDE and orchestrator for developers using Pi and other coding agents. Product
			status stays explicit so planned work does not read as shipped.
		</p>
	</header>

	<div
		class="docs-frame mx-auto min-h-190 max-w-384 overflow-hidden border border-line bg-site-paper font-sans text-site-ink max-md:border-x-0"
		data-theme={theme}>
		<DocsSiteHeader
			{activeView}
			{theme}
			onViewChange={(view) => (activeView = view)}
			onThemeChange={(nextTheme) => (theme = nextTheme)} />

		{#if activeView === 'landing'}
			<DocsLanding onViewChange={(view) => (activeView = view)} />
		{:else if activeView === 'guide'}
			<DocsGuide />
		{:else}
			<DocsReference />
		{/if}

		<DocsSiteFooter onViewChange={(view) => (activeView = view)} />
	</div>
</article>
