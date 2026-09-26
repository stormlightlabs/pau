<script lang="ts">
	import '@fontsource-variable/atkinson-hyperlegible-next/wght.css';
	import '@fontsource-variable/google-sans/wght.css';
	import '@fontsource-variable/google-sans-code/wght.css';
	import '@fontsource-variable/ibm-plex-sans/wght.css';
	import '@fontsource-variable/inter/wght.css';
	import '$lib/design/tokens.css';
	import '$lib/design/base.css';
	import '$lib/design/prototype.css';
	import 'virtual:uno.css';
	import PrototypeShell from '$lib/components/PrototypeShell.svelte';

	let { children } = $props();
</script>

<PrototypeShell>{@render children()}</PrototypeShell>
