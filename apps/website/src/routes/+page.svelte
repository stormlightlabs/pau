<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>Pau documentation</title>
	<meta name="description" content="Documentation for building and using Pau." />
</svelte:head>

<main>
	<h1>Pau documentation</h1>
	<p>Build and use Pau, a local application for coding-agent sessions.</p>
	<a href={resolve('/docs/[...slug]', { slug: 'getting-started' })}>Get started</a>
</main>
