<script lang="ts">
	import type { StartupProgress } from '@stormlightlabs/pau-protocol';
	import { onMount, setContext, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	import AppKeymap from '$lib/AppKeymap.svelte';
	import StartupStatus from '$lib/StartupStatus.svelte';
	import { createDesktopNativeCapabilities, desktopNativeCapabilitiesContext } from '$lib/native-capabilities';
	import { interfacePreferences } from '$lib/interface-preferences.svelte';
	import { followStartup, isDesktopHost } from '$lib/startup';

	let { children } = $props();

	const native = setContext(desktopNativeCapabilitiesContext, createDesktopNativeCapabilities());

	// The browser development server has no startup to follow: its backend is
	// already running behind the Vite proxy.
	let progress = $state<StartupProgress>();
	let startupError = $state<string>();
	const ready = $derived(!isDesktopHost() || progress?.phase === 'ready');

	onMount(() => {
		if (!isDesktopHost()) return;
		let stop: (() => void) | undefined;
		let unmounted = false;
		void (async () => {
			try {
				const unlisten = await followStartup((next) => (progress = next));
				if (unmounted) unlisten();
				else stop = unlisten;
			} catch (error) {
				startupError = error instanceof Error ? error.message : String(error);
			}
		})();
		return () => {
			unmounted = true;
			stop?.();
		};
	});

	function stopPreferences() {
		interfacePreferences.stop();
	}

	$effect(() => {
		if (!ready) return;
		untrack(() => interfacePreferences.connect());
		return stopPreferences;
	});
</script>

{#if ready}
	<AppKeymap {native} onOpenSessionView={() => void goto(resolve('/'))}>
		{@render children()}
	</AppKeymap>
{:else}
	<StartupStatus {progress} error={startupError} />
{/if}

<style>
	:global(html) {
		color-scheme: dark;
		background: #171827;
	}

	:global(body) {
		margin: 0;
	}
</style>
