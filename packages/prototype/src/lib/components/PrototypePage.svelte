<script lang="ts">
	let {
		section,
		title,
		note,
		children
	}: { section: string; title: string; note: string; children: import('svelte').Snippet } = $props();
</script>

<svelte:head>
	<title>{title} · Pau prototype</title>
	<meta name="description" content={note} />
</svelte:head>

<article class="prototype-page" data-prototype-ready>
	<header class="prototype-page__header">
		<div>
			<div class="prototype-kicker">{section}</div>
			<h1>{title}</h1>
		</div>
		<p class="prototype-page__note">{note}</p>
	</header>
	<div class="prototype-canvas">{@render children()}</div>
</article>
