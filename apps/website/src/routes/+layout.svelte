<script lang="ts">
	import { resolve } from '$app/paths';
	import { docs } from '$lib/content';
	import '@fontsource-variable/ibm-plex-sans/wght.css';
	import '../styles.css';

	let { children } = $props();
</script>

<header>
	<a class="brand" href={resolve('/')}>Pau</a>
	<nav aria-label="Documentation">
		{#each docs as doc (doc.slug)}
			<a href={resolve('/docs/[...slug]', { slug: doc.slug })}>{doc.title}</a>
		{/each}
	</nav>
</header>

{@render children()}
