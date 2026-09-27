<script lang="ts">
	import { setContext } from 'svelte';

	import { createDesktopNativeCapabilities, desktopNativeCapabilitiesContext } from '$lib/native-capabilities';

	let { children } = $props();

	setContext(desktopNativeCapabilitiesContext, createDesktopNativeCapabilities());
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
