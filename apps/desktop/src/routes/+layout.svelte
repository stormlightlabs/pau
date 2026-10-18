<script lang="ts">
	import { onMount, setContext } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	import AppKeymap from '$lib/AppKeymap.svelte';
	import { createDesktopNativeCapabilities, desktopNativeCapabilitiesContext } from '$lib/native-capabilities';
	import { interfacePreferences } from '$lib/interface-preferences.svelte';

	let { children } = $props();

	const native = setContext(desktopNativeCapabilitiesContext, createDesktopNativeCapabilities());

	onMount(() => {
		interfacePreferences.connect();
		return () => interfacePreferences.stop();
	});
</script>

<AppKeymap {native} onOpenSessionView={() => void goto(resolve('/'))}>
	{@render children()}
</AppKeymap>

<style>
	:global(html) {
		color-scheme: dark;
		background: #171827;
	}

	:global(body) {
		margin: 0;
	}
</style>
