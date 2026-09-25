<script lang="ts">
	import MockApp from '$lib/components/MockApp.svelte';
	import ProductRail from '$lib/components/ProductRail.svelte';
	import PrototypePage from '$lib/components/PrototypePage.svelte';

	type Harness = 'Pi' | 'Claude Code' | 'Codex';
	type RunStatus = 'running' | 'waiting' | 'queued' | 'idle';
	type Run = {
		id: string;
		task: string;
		workspace: string;
		branch: string;
		harness: Harness;
		model: string;
		profile: string;
		status: RunStatus;
		elapsed: string;
		changes: string;
		activity: string;
	};

	const runs: Run[] = [
		{
			id: 'claude-review',
			task: 'Review reconnect handling',
			workspace: 'pau',
			branch: 'reconnect-fix',
			harness: 'Claude Code',
			model: 'Sonnet 4.5',
			profile: 'review-with-checks',
			status: 'running',
			elapsed: '04:18',
			changes: '+42 −12',
			activity: 'Running focused reconnect checks'
		},
		{
			id: 'pi-shell',
			task: 'Refine session shell',
			workspace: 'pau',
			branch: 'session-shell',
			harness: 'Pi',
			model: 'Sonnet 4.5',
			profile: 'interactive',
			status: 'waiting',
			elapsed: '12:07',
			changes: '+18 −7',
			activity: 'Waiting for a layout decision'
		},
		{
			id: 'codex-tests',
			task: 'Add path boundary tests',
			workspace: 'pau',
			branch: 'file-access',
			harness: 'Codex',
			model: 'gpt-5.3-codex',
			profile: 'workspace-write',
			status: 'queued',
			elapsed: '—',
			changes: '—',
			activity: 'Waiting for a write slot'
		},
		{
			id: 'pi-docs',
			task: 'Check setup instructions',
			workspace: 'claude-bridge',
			branch: 'docs',
			harness: 'Pi',
			model: 'Haiku 4.5',
			profile: 'read-only',
			status: 'idle',
			elapsed: '02:41',
			changes: '—',
			activity: 'Review complete'
		}
	];

	let filter = $state<'All' | Harness>('All');
	let selectedId = $state('claude-review');
	let detailsOpen = $state(false);
	let eventsOpen = $state(false);
	let interrupted = $state(false);
	let delegationEnabled = $state(true);

	const visibleRuns = $derived(filter === 'All' ? runs : runs.filter((run) => run.harness === filter));
	const selectedRun = $derived(runs.find((run) => run.id === selectedId) ?? runs[0]);

	function selectRun(id: string) {
		selectedId = id;
		interrupted = false;
	}

	function statusTone(status: RunStatus) {
		if (status === 'waiting') return 'text-warning';
		if (status === 'running') return 'text-positive';
		return 'text-muted';
	}
</script>

{#snippet harnessMark(harness: Harness)}
	{#if harness === 'Pi'}
		<b class="text-accent">π</b>
	{:else if harness === 'Claude Code'}
		<span class="i-simple-icons-anthropic" aria-hidden="true"></span>
	{:else}
		<span class="i-simple-icons-openai" aria-hidden="true"></span>
	{/if}
{/snippet}

<PrototypePage
	section="Product surface · 03"
	title="Harness control"
	note="A session manager rather than a control-room dashboard. The left rail answers what is running, the center stays on one selected task, and process metadata remains optional.">
	<MockApp context="control / all sessions">
		<div class="orchestration-layout" class:orchestration-layout--details={detailsOpen}>
			<ProductRail active="orchestration" />

			<aside class="mock-context-rail flex min-h-0 flex-col p-0!" aria-label="Agent sessions">
				<div class="section-head">
					<span class="section-label">Sessions</span>
					<button class="icon-button ml-auto size-7!" type="button" aria-label="Start run"
						><span class="i-tabler-plus" aria-hidden="true"></span></button>
				</div>
				<div class="px-2 py-2">
					<label class="sr-only" for="harness-filter">Filter by harness</label>
					<select id="harness-filter" class="app-field" bind:value={filter}>
						<option>All</option><option>Pi</option><option>Claude Code</option><option>Codex</option>
					</select>
				</div>
				<div class="min-h-0 flex-1 overflow-auto">
					{#each visibleRuns as run (run.id)}
						<button
							class="row-button grid min-h-15 grid-cols-[auto_minmax(0,1fr)] items-start gap-2 border-b border-b-line px-2.5 py-2"
							type="button"
							aria-pressed={selectedId === run.id}
							onclick={() => selectRun(run.id)}>
							<span class={`status-dot mt-1.5 ${statusTone(run.status)}`}></span>
							<span class="min-w-0">
								<strong class="block truncate text-body font-600 text-text">{run.task}</strong>
								<span class="mt-1 flex min-w-0 items-center gap-1.5 text-micro text-muted">
									{@render harnessMark(run.harness)}<span class="truncate">{run.workspace}</span>
									<span class="ml-auto font-mono">{run.elapsed}</span>
								</span>
							</span>
						</button>
					{/each}
				</div>
				<div class="border-t border-line px-3 py-2 text-micro text-muted">2 running · 1 waiting · 1 queued</div>
			</aside>

			<section class="mock-main flex min-h-0 flex-col" aria-label="Selected run">
				<header class="flex min-h-13 items-center gap-3 border-b border-line px-4">
					<span class="flex size-7 items-center justify-center border border-line bg-surface text-text"
						>{@render harnessMark(selectedRun.harness)}</span>
					<div class="min-w-0">
						<h2 class="m-0 truncate text-body font-650 text-text">{selectedRun.task}</h2>
						<p class="m-0 mt-0.5 flex items-center gap-1.5 text-micro text-muted">
							<span>{selectedRun.workspace}</span><span class="i-octicon-git-branch-16" aria-hidden="true"></span><span
								class="truncate font-mono">{selectedRun.branch}</span>
						</p>
					</div>
					<div class="ml-auto flex items-center gap-1">
						<span class={`mr-2 text-meta ${statusTone(selectedRun.status)}`}
							><span class="status-dot mr-1.5"></span>{interrupted ? 'interrupted' : selectedRun.status}</span>
						<button class="app-button" type="button" onclick={() => (interrupted = !interrupted)}>
							<span class={interrupted ? 'i-tabler-player-play' : 'i-tabler-player-stop'} aria-hidden="true"></span
							>{interrupted ? 'Resume' : 'Interrupt'}
						</button>
						<button
							class="icon-button optional-panel-toggle"
							type="button"
							aria-label="Toggle run details"
							aria-pressed={detailsOpen}
							onclick={() => (detailsOpen = !detailsOpen)}>
							<span class="i-tabler-layout-sidebar-right" aria-hidden="true"></span>
						</button>
					</div>
				</header>

				<div class="min-h-0 flex-1 overflow-auto">
					<div class="border-b border-line px-5 py-5">
						<div class="mb-2 flex items-center gap-2 text-micro text-muted">
							<span class={`uppercase tracking-[0.06em] ${statusTone(selectedRun.status)}`}>{selectedRun.status}</span>
							<span>·</span><span>{selectedRun.elapsed}</span>
						</div>
						<h3 class="m-0 text-lg font-600 text-text">{selectedRun.activity}</h3>
						<p class="mb-0 mt-2 max-w-[62ch] text-body leading-relaxed text-muted">
							The session remains attached to its native process. Open the conversation to steer the work or inspect its
							full tool history.
						</p>
						<div class="mt-4 flex gap-2">
							<button class="app-button-primary" type="button"
								>Open conversation<span class="i-tabler-arrow-right" aria-hidden="true"></span></button>
							<button class="app-button" type="button"
								><span class="i-tabler-message-forward" aria-hidden="true"></span>Steer</button>
						</div>
					</div>

					{#if selectedRun.status === 'waiting'}
						<div
							class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-line bg-wash-warning px-5 py-3">
							<div>
								<strong class="block text-body text-text">Decision required</strong><span class="text-micro text-muted"
									>Keep file counts in compact tool activity?</span>
							</div>
							<button class="app-button-primary" type="button">Answer</button>
						</div>
					{/if}

					<div class="grid grid-cols-2 border-b border-line max-md:grid-cols-1">
						<section class="border-r border-line p-4 max-md:border-b max-md:border-r-0">
							<div class="mb-3 flex items-center">
								<span class="section-label">Changes</span><span class="diffstat ml-auto">{selectedRun.changes}</span>
							</div>
							<div class="grid gap-2 text-meta">
								<div class="flex justify-between gap-3">
									<span class="truncate font-mono">reconnect.rs</span><span class="text-added">+28</span>
								</div>
								<div class="flex justify-between gap-3">
									<span class="truncate font-mono">reconnect.test.ts</span><span class="diffstat"
										><span class="text-added">+14</span><span class="text-removed">−12</span></span>
								</div>
							</div>
							<button class="quiet-button mt-3" type="button">Review diff</button>
						</section>
						<section class="p-4">
							<div class="mb-3 flex items-center">
								<span class="section-label">Checks</span><span class="ml-auto text-micro text-positive">18 passed</span>
							</div>
							<div class="grid gap-2 text-meta">
								<div class="flex justify-between"><span>Unit tests</span><span class="text-positive">passed</span></div>
								<div class="flex justify-between">
									<span>Reconnect flow</span><span class="text-positive">passed</span>
								</div>
								<div class="flex justify-between">
									<span>Visual review</span><span class="text-warning">waiting</span>
								</div>
							</div>
							<button class="quiet-button mt-3" type="button">Open checks</button>
						</section>
					</div>

					<button
						class="flex min-h-10 w-full items-center gap-2 border-0 border-b border-line bg-surface px-4 text-left text-meta text-muted hover:text-text"
						type="button"
						aria-expanded={eventsOpen}
						onclick={() => (eventsOpen = !eventsOpen)}>
						<span class={eventsOpen ? 'i-tabler-chevron-down' : 'i-tabler-chevron-right'} aria-hidden="true"></span
						>Recent events<span class="ml-auto">3</span>
					</button>
					{#if eventsOpen}
						<div class="grid gap-2 px-5 py-3 font-mono text-micro text-muted">
							<div class="grid grid-cols-[4.5rem_1fr] gap-3">
								<span>10:42:18</span><span>Started review-with-checks</span>
							</div>
							<div class="grid grid-cols-[4.5rem_1fr] gap-3">
								<span>10:43:02</span><span>Read reconnect supervisor and fixtures</span>
							</div>
							<div class="grid grid-cols-[4.5rem_1fr] gap-3">
								<span>10:44:11</span><span>Completed 18 focused checks</span>
							</div>
						</div>
					{/if}
				</div>
			</section>

			{#if detailsOpen}
				<aside class="mock-inspector flex flex-col p-0!" aria-label="Run details">
					<div class="section-head">
						<span class="section-label">Run details</span>
						<button
							class="icon-button ml-auto size-7!"
							type="button"
							aria-label="Close run details"
							onclick={() => (detailsOpen = false)}><span class="i-tabler-x" aria-hidden="true"></span></button>
					</div>
					<div class="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2 border-b border-line p-4 font-mono text-micro">
						<span class="text-muted">Harness</span><span>{selectedRun.harness}</span>
						<span class="text-muted">Model</span><span>{selectedRun.model}</span>
						<span class="text-muted">Profile</span><span>{selectedRun.profile}</span>
						<span class="text-muted">Native ID</span><span class="truncate">ses_8f1c…42ba</span>
						<span class="text-muted">Process</span><span class={interrupted ? 'text-warning' : 'text-positive'}
							>{interrupted ? 'interrupted' : 'attached'}</span>
					</div>

					<div class="p-4">
						<p class="mock-section-label">Capabilities</p>
						<div class="flex flex-wrap gap-1.5">
							<span class="chip">prompt</span><span class="chip">interrupt</span><span class="chip">resume</span><span
								class="chip">native history</span>
						</div>
						<p class="mt-3 text-micro leading-relaxed text-muted">Branching is not reported by this harness.</p>
					</div>

					{#if selectedRun.harness === 'Claude Code'}
						<label class="mx-4 flex items-center justify-between gap-3 border-y border-line py-3 text-meta">
							<span
								><strong class="block text-text">Allow Pi delegation</strong><small class="text-muted"
									>Current Pi session only</small
								></span>
							<input class="accent-[var(--color-accent)]" type="checkbox" bind:checked={delegationEnabled} />
						</label>
					{/if}

					<button class="app-button mx-4 mt-auto mb-4 text-danger!" type="button"
						><span class="i-tabler-square-x" aria-hidden="true"></span>Stop native session</button>
				</aside>
			{/if}
		</div>
	</MockApp>
</PrototypePage>
