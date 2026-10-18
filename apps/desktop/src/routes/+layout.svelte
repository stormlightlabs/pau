<script lang="ts">
	import { onMount, setContext } from 'svelte';

	import { createDesktopNativeCapabilities, desktopNativeCapabilitiesContext } from '$lib/native-capabilities';
	import { panePreferences } from '$lib/pane-preferences.svelte';

	let { children } = $props();

	setContext(desktopNativeCapabilitiesContext, createDesktopNativeCapabilities());

	onMount(() => {
		panePreferences.connect();
		return () => panePreferences.stop();
	});
</script>

{@render children()}

<style>
	:global(html) {
		color-scheme: dark;
		background: #171827;
	}

	:global(body) {
		margin: 0;
	}
</style>
