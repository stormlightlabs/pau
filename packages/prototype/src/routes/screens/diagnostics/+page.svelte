<script lang="ts">
	import MockApp from '$lib/components/MockApp.svelte';
	import ProductRail from '$lib/components/ProductRail.svelte';
	import PrototypePage from '$lib/components/PrototypePage.svelte';

	let enabled = $state(true);
	let tracing = $state(false);
	let review = $state(false);

	const transports = [
		['WebSocket', 'connected', '842', '2', '4', '0 / 0'],
		['Pi RPC', 'ready', '184', '0', '0', '1 / 3']
	];
</script>

<PrototypePage
	section="V1 screen · 09"
	title="Release diagnostics"
	note="Diagnostics is an explicit observation mode. It keeps redacted records in memory and requires a review before export.">
	<MockApp context="diagnostics / transport">
		<div class="mock-layout grid-cols-[3.5rem_minmax(0,1fr)]!">
			<ProductRail active="diagnostics" />
			<section class="mock-main overflow-auto p-6" aria-label="Diagnostics">
				<div class="mx-auto max-w-6xl">
					<header class="mb-5 flex items-end justify-between gap-4">
						<div>
							<p class="m-0 text-xs text-muted">Support and troubleshooting</p>
							<h2 class="m-0 text-lg">Diagnostics</h2>
						</div>
						<span class="border border-accent px-2 py-1 text-xs text-accent"
							>Diagnostics mode {enabled ? 'on' : 'off'}</span>
					</header>

					<div class="grid grid-cols-[1fr_auto_auto] items-center gap-5 border-y border-line p-4">
						<div>
							<strong class="text-sm">Release diagnostics</strong>
							<p class="m-0 mt-1 text-xs text-muted">
								Observation only. Process limits, retries, permissions, and authentication do not change.
							</p>
						</div>
						<label class="text-xs"><input type="checkbox" bind:checked={enabled} /> Enable diagnostics</label>
						<select class="border border-line bg-canvas px-2 py-1 text-xs" aria-label="Minimum log level"
							><option>Info</option><option>Warning</option><option>Error</option></select>
					</div>

					<div class="grid grid-cols-5 border-b border-line mock-code text-xs">
						{#each [['Frontend', '0.1.0'], ['Backend', '0.1.0'], ['Pi', '0.52.0'], ['Axum', '0.8.8'], ['Tokio', '1.49.0']] as item (item[0])}
							<div class="border-r border-line p-3">
								<span class="block text-muted">{item[0]}</span><strong>{item[1]}</strong>
							</div>
						{/each}
					</div>

					<section class="border-b border-line py-5">
						<h3 class="m-0 text-sm">Adapter handshakes</h3>
						<div class="mt-3 grid grid-cols-[1fr_auto_2fr] items-center gap-4 border-t border-line px-3 py-3 text-xs">
							<strong>Pi · 0.52.0</strong><span class="text-positive">ready</span><span class="text-muted"
								>prompt · interrupt · resume · extension UI</span>
						</div>
						<div class="grid grid-cols-[1fr_auto_2fr] items-center gap-4 border-t border-line px-3 py-3 text-xs">
							<strong>Claude Code · 2.1.259</strong><span class="text-positive">ready</span><span class="text-muted"
								>prompt · interrupt · resume</span>
						</div>
					</section>

					<section class="border-b border-line py-5">
						<h3 class="m-0 text-sm">Transport and replay</h3>
						<div class="mt-3 grid grid-cols-6 gap-4 border-t border-line px-3 py-2 text-xs text-muted">
							<span>Transport</span><span>State</span><span>Sequence</span><span>Reconnects</span><span>Queue</span
							><span>Gaps / dropped</span>
						</div>
						{#each transports as row (row[0])}
							<div class="grid grid-cols-6 gap-4 border-t border-line px-3 py-3 mock-code text-xs">
								{#each row as value, index (index)}<span>{value}</span>{/each}
							</div>
						{/each}
					</section>

					<section class="border-b border-line py-5">
						<div class="flex items-center justify-between gap-4 bg-surface-raised p-3">
							<div>
								<strong class="text-sm">Temporary payload tracing</strong>
								<p class="m-0 text-xs text-muted">
									Records payload shapes for five minutes. Content and sensitive values remain excluded.
								</p>
							</div>
							<button class="app-button" type="button" disabled={tracing} onclick={() => (tracing = true)}
								>{tracing ? 'Tracing active' : 'Trace for 5 minutes'}</button>
						</div>
						<div
							class="mt-3 grid grid-cols-[10rem_4rem_7rem_1fr_1fr] gap-3 border-t border-line px-3 py-3 mock-code text-xs">
							<span>2026-04-01 12:10:42</span><span class="text-warning">warn</span><span>pau-server</span><strong
								>event.replay_gap</strong
							><span class="text-muted">diff-gutter</span>
						</div>
					</section>

					<section class="py-5">
						<h3 class="m-0 text-sm">Export bundle</h3>
						<label class="mt-3 grid grid-cols-[7rem_1fr] items-center gap-3 text-xs"
							><span>Destination</span><input
								class="border border-line bg-canvas px-2 py-2 mock-code"
								value="pau-diagnostics.json" /></label>
						<div class="mt-3 flex gap-2">
							<button class="app-button" type="button" onclick={() => (review = !review)}>Review bundle</button><button
								class="app-button"
								type="button"
								disabled={!review}>Export reviewed bundle</button>
						</div>
						{#if review}<p class="mt-3 border-l-3 border-accent bg-surface-raised p-3 text-xs text-muted">
								Includes versions, capabilities, process and transport metadata, and recent redacted records. Excludes
								credentials, prompts, file contents, tool arguments, transcript content, outside-workspace paths, and
								sensitive URL parts.
							</p>{/if}
					</section>
				</div>
			</section>
		</div>
	</MockApp>
</PrototypePage>
