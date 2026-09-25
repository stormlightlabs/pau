<script lang="ts">
	import PauMark from '$lib/components/PauMark.svelte';
	import PrototypePage from '$lib/components/PrototypePage.svelte';

	const stages = [
		{ label: 'Starting local service', detail: 'Opening Pau on this machine.', progress: 28 },
		{ label: 'Restoring workspaces', detail: 'Reconnecting to 3 saved workspaces.', progress: 62 },
		{ label: 'Checking active sessions', detail: 'Two Pi sessions are still running.', progress: 86 },
		{ label: 'Ready', detail: 'Your last workspace is available.', progress: 100 }
	];
	let stage = $state(0);
	const current = $derived(stages[stage]);
</script>

<PrototypePage
	section="Splash state · 01"
	title="Launch sequence"
	note="Startup copy names the current operation and keeps the product mark secondary. The sequence should disappear as soon as the workspace can render; it is not an introduction screen.">
	<section
		class="relative grid min-h-[min(760px,calc(100vh-12rem))] place-items-center overflow-hidden bg-canvas p-6"
		aria-label="Pau launch screen">
		<div class="absolute inset-y-0 left-0 w-14 border-r border-line bg-surface" aria-hidden="true"></div>
		<div class="absolute left-4 top-4 grid size-6 place-items-center" aria-hidden="true">
			<PauMark />
		</div>
		<div class="relative w-full max-w-md">
			<div class="mb-10 flex items-center gap-3">
				<div class="grid size-11 place-items-center"><PauMark /></div>
				<div>
					<strong class="block text-lg">Pau</strong><span class="text-sm text-muted">Local coding workspace</span>
				</div>
			</div>

			<div aria-live="polite">
				<p class="mb-2 text-xs font-650 uppercase tracking-[0.12em] text-accent">
					Launch {stage + 1} / {stages.length}
				</p>
				<h2 class="mb-2 mt-0 text-2xl font-600">{current.label}</h2>
				<p class="mb-6 mt-0 text-sm text-muted">{current.detail}</p>
			</div>

			<div
				class="h-px bg-line"
				role="progressbar"
				aria-label="Launch progress"
				aria-valuenow={current.progress}
				aria-valuemin="0"
				aria-valuemax="100">
				<div class="h-px bg-accent transition-[width] duration-300" style:width={`${current.progress}%`}></div>
			</div>

			<div class="mt-6 flex items-center justify-between gap-4">
				<span class="mock-code text-xs text-muted">local service · 127.0.0.1</span>
				<button class="app-button" type="button" onclick={() => (stage = (stage + 1) % stages.length)}>
					{stage === stages.length - 1 ? 'Replay sequence' : 'Advance state'}<span class="i-tabler-arrow-right"></span>
				</button>
			</div>
		</div>
	</section>
</PrototypePage>
