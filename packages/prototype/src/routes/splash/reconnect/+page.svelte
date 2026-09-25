<script lang="ts">
	import PauMark from '$lib/components/PauMark.svelte';
	import PrototypePage from '$lib/components/PrototypePage.svelte';

	let state = $state<'offline' | 'trying' | 'restored'>('offline');

	function retry() {
		state = 'trying';
		setTimeout(() => (state = 'restored'), 900);
	}
</script>

<PrototypePage
	section="Splash state · 02"
	title="Reconnect"
	note="A lost connection does not imply lost work. This state says what remains running, offers a direct retry, and keeps diagnostics available without leading with an internal error code.">
	<section
		class="relative grid min-h-[min(760px,calc(100vh-12rem))] place-items-center overflow-hidden bg-canvas p-6"
		aria-label="Pau reconnect screen">
		<div class="absolute inset-x-0 top-0 flex h-12 items-center border-b border-line bg-surface px-4">
			<span class="grid size-7 place-items-center"><PauMark /></span>
			<span class="ml-3 text-sm font-600">Pau</span>
			<span class="ml-auto flex items-center gap-2 text-xs text-muted"
				><span class="status-dot text-warning"></span>Local service unavailable</span>
		</div>

		<div class="w-full max-w-lg border border-line bg-surface p-6 shadow-[var(--shadow-overlay)]" aria-live="polite">
			{#if state === 'restored'}
				<div class="mb-5 grid size-11 place-items-center border border-positive text-positive">
					<span class="i-tabler-check text-xl"></span>
				</div>
				<h2 class="mb-2 mt-0 text-xl font-600">Connection restored</h2>
				<p class="mb-6 mt-0 text-sm leading-6 text-muted">
					The workspace and both active sessions are available again.
				</p>
				<button class="app-button-primary" type="button" onclick={() => (state = 'offline')}
					>Return to workspace<span class="i-tabler-arrow-right"></span></button>
			{:else}
				<div class="mb-5 grid size-11 place-items-center border border-warning text-warning">
					<span
						class={state === 'trying' ? 'i-tabler-loader-2 animate-spin text-xl' : 'i-tabler-plug-connected-x text-xl'}
					></span>
				</div>
				<h2 class="mb-2 mt-0 text-xl font-600">
					{state === 'trying' ? 'Trying the local service…' : 'Pau lost its local connection'}
				</h2>
				<p class="mb-5 mt-0 text-sm leading-6 text-muted">
					{state === 'trying'
						? 'This usually takes a moment. Your sessions remain attached to their native processes.'
						: 'Agent and terminal processes may still be running. Reconnect before starting the same work again.'}
				</p>
				<div class="mb-6 grid gap-2 border-y border-line py-4 mock-code text-xs text-muted">
					<div class="flex justify-between"><span>Local API</span><span class="text-danger">not responding</span></div>
					<div class="flex justify-between"><span>Last event</span><span>12 seconds ago</span></div>
					<div class="flex justify-between"><span>Active sessions</span><span>2 before disconnect</span></div>
				</div>
				<div class="flex flex-wrap items-center gap-3">
					<button class="app-button-primary" type="button" disabled={state === 'trying'} onclick={retry}
						><span class="i-tabler-refresh"></span>{state === 'trying' ? 'Reconnecting…' : 'Try again'}</button>
					<button class="app-button" type="button">Open diagnostics</button>
				</div>
			{/if}
		</div>
	</section>
</PrototypePage>
