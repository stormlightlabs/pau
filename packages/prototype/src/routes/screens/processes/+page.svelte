<script lang="ts">
	import MockApp from '$lib/components/MockApp.svelte';
	import ProductRail from '$lib/components/ProductRail.svelte';
	import PrototypePage from '$lib/components/PrototypePage.svelte';

	const processes = [
		{
			name: 'Fix diff gutter',
			agent: 'Pi',
			state: 'running',
			cpu: '38.4%',
			memory: '486 MiB',
			peak: '612 MiB',
			count: '3',
			elapsed: '12m 18s',
			io: '44 MiB ↓ · 18 MiB ↑'
		},
		{
			name: 'Review adapter fixtures',
			agent: 'Claude',
			state: 'waiting',
			cpu: '4.2%',
			memory: '734 MiB',
			peak: '1.2 GiB',
			count: '4',
			elapsed: '31m 4s',
			io: 'Unavailable'
		},
		{
			name: 'Run session registry tests',
			agent: 'Pi',
			state: 'CPU pressure',
			cpu: '287.5%',
			memory: '2.3 GiB',
			peak: '2.5 GiB',
			count: '6',
			elapsed: '8m 52s',
			io: '184 MiB ↓ · 620 MiB ↑'
		}
	] as const;

	let expanded = $state(0);
	let action = $state('No action requested');
</script>

<PrototypePage
	section="V1 screen · 09"
	title="Workspace processes"
	note="A task-oriented process view rather than a metrics dashboard. Current use leads, peaks stay adjacent, and pressure offers explicit session controls without acting automatically.">
	<MockApp context="pau / processes" branch="main">
		<div class="mock-layout" style="grid-template-columns: var(--rail-product) var(--rail-context) minmax(20rem, 1fr)">
			<ProductRail active="processes" />
			<aside class="mock-context-rail" aria-label="Workspace views">
				<p class="mock-section-label">Workspace</p>
				<div class="mock-list">
					<button type="button"><span class="i-tabler-messages"></span><span>Sessions</span><small>4</small></button>
					<button type="button" aria-pressed="true"
						><span class="i-tabler-activity-heartbeat"></span><span>Processes</span><small>3</small></button>
					<button type="button"><span class="i-tabler-terminal-2"></span><span>Terminals</span><small>2</small></button>
				</div>
			</aside>
			<section class="mock-main min-w-0 overflow-auto" aria-labelledby="processes-heading">
				<header class="flex min-h-15 items-end justify-between gap-4 border-b border-line px-5 pb-3">
					<div>
						<small class="text-muted">Pau</small>
						<h2 id="processes-heading" class="m-0 text-lg">Processes</h2>
					</div>
					<span class="text-xs text-muted">3 monitored trees</span>
				</header>
				<div class="min-w-0 p-5">
					<div
						class="grid grid-cols-[minmax(10rem,1.4fr)_4rem_5rem_2.5rem_3rem_5rem_9rem] gap-2 border-b border-line px-3 py-2 text-xs font-600 text-muted">
						<span>Process</span><span>CPU</span><span>Memory</span><span>Count</span><span>Elapsed</span><span
							>Disk I/O</span
						><span>Actions</span>
					</div>
					{#each processes as process, index (process.name)}
						<div
							class:border-l-3={process.state === 'CPU pressure'}
							class:border-warning={process.state === 'CPU pressure'}>
							<div
								class="grid min-h-16 grid-cols-[minmax(10rem,1.4fr)_4rem_5rem_2.5rem_3rem_5rem_9rem] items-center gap-2 border-b border-line px-3 text-xs tabular-nums">
								<button
									class="flex items-center gap-2 border-0 bg-transparent p-0 text-left text-text"
									type="button"
									onclick={() => (expanded = expanded === index ? -1 : index)}>
									<span class={expanded === index ? 'i-tabler-chevron-down' : 'i-tabler-chevron-right'}></span>
									<span
										><strong class="block">{process.name}</strong><small class="text-muted"
											>{process.agent} · {process.state}</small
										></span>
								</button>
								<span>{process.cpu}</span><span
									>{process.memory}<small class="block text-muted">peak {process.peak}</small></span
								><span>{process.count}</span><span>{process.elapsed}</span><span>{process.io}</span>
								<div class="flex gap-1">
									<button class="app-button" type="button" onclick={() => (action = `Interrupted ${process.name}`)}
										>Interrupt</button>
									<button
										class="app-button text-danger!"
										type="button"
										onclick={() => (action = `Stopped ${process.name}`)}>Stop</button>
								</div>
							</div>
							{#if expanded === index}
								<div class="border-b border-line bg-raised px-10 py-3 text-xs">
									<strong>Process tree</strong>
									<p class="mb-0 mt-2 text-muted">
										PID {3812 + index * 100} · {process.cpu} CPU · {process.memory} resident memory
									</p>
								</div>
							{/if}
						</div>
					{/each}
				</div>
				<p
					class="fixed bottom-4 right-4 m-0 border border-line bg-canvas px-3 py-2 text-xs text-muted"
					aria-live="polite">
					{action}
				</p>
			</section>
		</div>
	</MockApp>
</PrototypePage>
