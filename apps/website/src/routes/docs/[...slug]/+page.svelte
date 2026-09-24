<script lang="ts">
	import { resolve } from '$app/paths';
	import { getDoc } from '$lib/content';

	let { data } = $props();
	const doc = $derived(getDoc(data.slug));
</script>

<svelte:head>
	<title>{doc.title} | Pau</title>
	<meta name="description" content={doc.description} />
	<meta property="og:title" content={`${doc.title} | Pau`} />
	<meta property="og:description" content={doc.description} />
	<meta property="og:image" content={`https://pau.stormlightlabs.org/og/${doc.slug}.svg`} />
</svelte:head>

<main data-pagefind-body>
	<article>
		<doc.component />
		<p class="raw-link">
			<a href={resolve('/raw/[...slug].md', { slug: doc.slug })}>View raw Markdown</a>
		</p>
	</article>
</main>
