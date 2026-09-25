<script lang="ts">
	import MockApp from '$lib/components/MockApp.svelte';
	import ProductRail from '$lib/components/ProductRail.svelte';
	import PrototypePage from '$lib/components/PrototypePage.svelte';

	type Harness = 'Pi' | 'Claude Code' | 'Codex';
	type Run = {
		id: string;
		task: string;
		workspace: string;
		harness: Harness;
		model: string;
		profile: string;
		status: 'running' | 'waiting' | 'queued' | 'idle';
		elapsed: string;
	};

	const runs: Run[] = [
		{
			id: 'claude-review',
			task: 'Review reconnect handling',
			workspace: 'pau / reconnect-fix',
			harness: 'Claude Code',
			model: 'Sonnet 4.5',
			profile: 'review-with-checks',
			status: 'running',
			elapsed: '04:18'
		},
		{
			id: 'pi-shell',
			task: 'Refine session shell',
			workspace: 'pau / session-shell',
			harness: 'Pi',
			model: 'Sonnet 4.5',
			profile: 'interactive',
			status: 'waiting',
			elapsed: '12:07'
		},
		{
			id: 'codex-tests',
			task: 'Add path boundary tests',
			workspace: 'pau / file-access',
			harness: 'Codex',
			model: 'gpt-5.3-codex',
			profile: 'workspace-write',
			status: 'queued',
			elapsed: '—'
		},
		{
			id: 'pi-docs',
			task: 'Check setup instructions',
			workspace: 'claude-bridge / docs',
			harness: 'Pi',
			model: 'Haiku 4.5',
			profile: 'read-only',
			status: 'idle',
			elapsed: '02:41'
		}
	];

	let filter = $state<'All' | Harness>('All');
	let selectedId = $state('claude-review');
	let interrupted = $state(false);
	let delegationEnabled = $state(true);
	const visibleRuns = $derived(filter === 'All' ? runs : runs.filter((run) => run.harness === filter));
	const selectedRun = $derived(runs.find((run) => run.id === selectedId) ?? runs[0]);

	function selectRun(id: string) {
		selectedId = id;
		interrupted = false;
	}
</script>

<PrototypePage
	section="V1 screen · 03"
	title="Harness control"
	note="This view supervises concurrent native sessions without implying that the agents form an autonomous team. The operator assigns work, sees each harness’s real controls, and decides when results move between sessions.">
	<MockApp context="control / all workspaces">
		<div class="mock-layout">
			<ProductRail active="orchestration" />

			<aside class="mock-context-rail" aria-label="Orchestration scope">
				<div class="flex items-center justify-between">
					<p class="mock-section-label mb-0!">Control room</p>
					<span class="flex items-center gap-1 text-xs text-positive"><span class="status-dot"></span>local</span>
				</div>

				<p class="mock-section-label mt-6">Workspaces</p>
				<div class="mock-list">
					<button type="button" aria-pressed="true">
						<span class="i-tabler-stack-2"></span><span>All workspaces</span><span>4</span>
					</button>
					<button type="button">
						<span class="i-tabler-folder"></span><span>pau</span><span>3</span>
					</button>
					<button type="button">
						<span class="i-tabler-folder"></span><span>claude-bridge</span><span>1</span>
					</button>
				</div>

				<p class="mock-section-label mt-7">Needs attention</p>
				<div class="border-l-2 border-warning bg-surface-raised p-3 text-xs leading-5">
					<strong class="block text-text">Pi is waiting</strong>
					<span class="text-muted">Choose whether to keep the compact tool rows.</span>
				</div>

				<p class="mock-section-label mt-7">Harnesses</p>
				<div class="grid gap-3 text-xs">
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-2"><b class="text-accent">π</b>Pi</span><span class="text-positive"
							>2 attached</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-2"><span class="i-simple-icons-anthropic"></span>Claude Code</span><span
							class="text-positive">1 running</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-2"><span class="i-simple-icons-openai"></span>Codex</span><span
							class="text-muted">1 queued</span>
					</div>
				</div>
			</aside>

			<section class="mock-main flex min-h-0 flex-col" aria-label="Harness runs">
				<header class="orchestration-toolbar flex min-h-15 items-center gap-4 border-b border-line px-4">
					<div class="min-w-0 flex-1">
						<strong class="block text-sm">Runs</strong>
						<span class="text-xs text-muted">Four native sessions across two workspaces</span>
					</div>
					<button class="app-button" type="button"><span class="i-tabler-player-pause"></span>Pause queue</button>
					<button class="app-button-primary" type="button"><span class="i-tabler-plus"></span>Start run</button>
				</header>

				<div
					class="flex min-h-12 items-end gap-1 border-b border-line px-4"
					role="tablist"
					aria-label="Filter by harness">
					{#each ['All', 'Pi', 'Claude Code', 'Codex'] as harness (harness)}
						<button
							class="mock-tab"
							type="button"
							role="tab"
							aria-selected={filter === harness}
							onclick={() => (filter = harness as typeof filter)}>{harness}</button>
					{/each}
				</div>

				<div class="overflow-auto">
					<div
						class="grid grid-cols-[minmax(10rem,1fr)_6.5rem_6.5rem_5rem] border-b border-line px-4 py-2 text-[0.68rem] font-700 uppercase tracking-[0.08em] text-muted">
						<span>Task and workspace</span><span>Harness</span><span>Profile</span><span>Status</span>
					</div>
					<div>
						{#each visibleRuns as run (run.id)}
							<button
								class="grid min-h-16 w-full grid-cols-[minmax(10rem,1fr)_6.5rem_6.5rem_5rem] items-center border-0 border-b border-line bg-transparent px-4 text-left text-xs text-muted hover:bg-surface-raised"
								class:bg-surface-selected={selectedId === run.id}
								type="button"
								aria-pressed={selectedId === run.id}
								onclick={() => selectRun(run.id)}>
								<span class="min-w-0 pr-4"
									><strong class="block truncate text-sm text-text">{run.task}</strong><span class="block truncate"
										>{run.workspace}</span
									></span>
								<span class="flex items-center gap-2 text-text">
									{#if run.harness === 'Pi'}<b class="text-accent">π</b>{:else if run.harness === 'Claude Code'}<span
											class="i-simple-icons-anthropic"></span
										>{:else}<span class="i-simple-icons-openai"></span>{/if}
									{run.harness}
								</span>
								<span>{run.profile}</span>
								<span
									class={run.status === 'waiting'
										? 'text-warning'
										: run.status === 'running'
											? 'text-positive'
											: 'text-muted'}
									><span class="status-dot mr-2"></span>{run.status}<small class="mt-1 block pl-4 text-muted"
										>{run.elapsed}</small
									></span>
							</button>
						{/each}
					</div>
				</div>

				<div class="mt-auto border-t border-line bg-surface p-4">
					<div class="mb-3 flex items-center justify-between">
						<p class="mock-section-label mb-0!">Recent orchestration events</p>
						<button class="border-0 bg-transparent text-xs text-muted" type="button">View event log</button>
					</div>
					<div class="orchestration-events grid gap-2 mock-code text-xs text-muted">
						<div class="grid grid-cols-[4.5rem_5rem_1fr] gap-3">
							<span>10:42:18</span><span class="text-text">Claude</span><span
								>Started review-with-checks in reconnect-fix</span>
						</div>
						<div class="grid grid-cols-[4.5rem_5rem_1fr] gap-3">
							<span>10:43:02</span><span class="text-text">Pi</span><span>Requested a decision in session-shell</span>
						</div>
						<div class="grid grid-cols-[4.5rem_5rem_1fr] gap-3">
							<span>10:44:11</span><span class="text-text">Queue</span><span
								>Held Codex until one write slot is free</span>
						</div>
					</div>
				</div>
			</section>

			<aside class="mock-inspector flex flex-col" aria-label="Selected harness controls">
				<div class="mb-1 flex items-center gap-2 text-xs text-accent">
					{#if selectedRun.harness === 'Pi'}<b>π</b>{:else if selectedRun.harness === 'Claude Code'}<span
							class="i-simple-icons-anthropic"></span
						>{:else}<span class="i-simple-icons-openai"></span>{/if}
					{selectedRun.harness}
				</div>
				<h2 class="mb-1 mt-0 text-base font-600">{selectedRun.task}</h2>
				<p class="m-0 text-xs text-muted">{selectedRun.workspace}</p>

				<div class="mt-5 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 border-y border-line py-4 mock-code text-xs">
					<span class="text-muted">Model</span><span>{selectedRun.model}</span>
					<span class="text-muted">Profile</span><span>{selectedRun.profile}</span>
					<span class="text-muted">Native ID</span><span class="truncate">ses_8f1c…42ba</span>
					<span class="text-muted">Process</span><span class={interrupted ? 'text-warning' : 'text-positive'}
						>{interrupted ? 'interrupted' : 'attached'}</span>
				</div>

				<p class="mock-section-label mt-6">Available controls</p>
				<div class="grid grid-cols-2 gap-2">
					<button class="app-button" type="button"><span class="i-tabler-message-forward"></span>Steer</button>
					<button class="app-button" type="button" onclick={() => (interrupted = !interrupted)}
						><span class={interrupted ? 'i-tabler-player-play' : 'i-tabler-player-stop'}></span>{interrupted
							? 'Resume'
							: 'Interrupt'}</button>
					<button class="app-button col-span-2 text-danger!" type="button"
						><span class="i-tabler-square-x"></span>Stop native session</button>
				</div>

				{#if selectedRun.harness === 'Claude Code'}
					<div class="mt-6 border border-line bg-canvas p-3">
						<label class="flex items-center justify-between gap-3 text-sm"
							><span>Allow Pi delegation</span><input
								class="accent-[var(--color-accent)]"
								type="checkbox"
								bind:checked={delegationEnabled} /></label>
						<p class="mb-0 mt-2 text-xs leading-5 text-muted">
							Pi may send bounded work to this Claude session. Detailed tool activity stays visible here.
						</p>
					</div>
				{/if}

				<div class="mt-auto pt-6 text-xs leading-5 text-muted">
					<strong class="text-text">Capability boundary</strong><br />Prompt, interrupt, resume, and native history are
					available. Branching is not reported by this harness.
				</div>
			</aside>
		</div>
	</MockApp>
</PrototypePage>
