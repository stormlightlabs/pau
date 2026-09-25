<script lang="ts">
	import MockApp from '$lib/components/MockApp.svelte';
	import ProductRail from '$lib/components/ProductRail.svelte';
	import PrototypePage from '$lib/components/PrototypePage.svelte';

	type WorkStatus = 'waiting' | 'running' | 'queued';
	type Work = {
		id: string;
		task: string;
		workspace: string;
		branch: string;
		harness: 'Pi' | 'Claude Code' | 'Codex';
		status: WorkStatus;
		elapsed: string;
		added: number;
		removed: number;
		detail: string;
	};

	const work: Work[] = [
		{
			id: 'session-shell',
			task: 'Refine session shell',
			workspace: 'pau',
			branch: 'session-shell',
			harness: 'Pi',
			status: 'waiting',
			elapsed: '02:14',
			added: 18,
			removed: 7,
			detail: 'Choose what compact tool activity should show.'
		},
		{
			id: 'reconnect',
			task: 'Review reconnect handling',
			workspace: 'pau',
			branch: 'reconnect-fix',
			harness: 'Claude Code',
			status: 'running',
			elapsed: '08:31',
			added: 42,
			removed: 12,
			detail: 'Running focused checks.'
		},
		{
			id: 'path-tests',
			task: 'Add path boundary tests',
			workspace: 'claude-bridge',
			branch: 'path-policy',
			harness: 'Codex',
			status: 'queued',
			elapsed: '—',
			added: 0,
			removed: 0,
			detail: 'Waiting for a write slot.'
		}
	];

	let workspace = $state('All workspaces');
	let status = $state<'All' | 'Needs you' | 'Running'>('All');
	let selectedId = $state(work[0].id);
	let activityOpen = $state(false);

	const visibleWork = $derived(
		work.filter((item) => {
			const inWorkspace = workspace === 'All workspaces' || item.workspace === workspace;
			const inStatus =
				status === 'All' ||
				(status === 'Needs you' && item.status === 'waiting') ||
				(status === 'Running' && item.status === 'running');
			return inWorkspace && inStatus;
		})
	);
	const selectedWork = $derived(work.find((item) => item.id === selectedId) ?? work[0]);

	function statusTone(value: WorkStatus) {
		if (value === 'waiting') return 'text-warning';
		if (value === 'running') return 'text-positive';
		return 'text-muted';
	}
</script>

{#snippet harnessMark(harness: Work['harness'])}
	{#if harness === 'Pi'}
		<b class="text-accent">π</b>
	{:else if harness === 'Claude Code'}
		<span class="i-simple-icons-anthropic" aria-hidden="true"></span>
	{:else}
		<span class="i-simple-icons-openai" aria-hidden="true"></span>
	{/if}
{/snippet}

<PrototypePage
	section="Product surface · 01"
	title="Agentic IDE dashboard"
	note="A quiet return point for active work. One attention item leads, session rows carry the operational detail, and changed files and checks stay in a panel until the operator asks for them.">
	<MockApp context="home">
		<div class="dashboard-layout" class:dashboard-layout--activity={activityOpen}>
			<ProductRail active="home" />

			<section class="mock-main flex min-h-0 flex-col" aria-label="Dashboard">
				<header class="dashboard-toolbar flex min-h-13 items-center gap-3 border-b border-line px-4">
					<div class="min-w-0">
						<h2 class="m-0 text-body font-650 text-text">Active work</h2>
						<p class="m-0 mt-0.5 text-micro text-muted">3 sessions · 1 needs you</p>
					</div>
					<div class="ml-auto flex items-center gap-1.5">
						<div class="dashboard-workspace-filter">
							<label class="sr-only" for="dashboard-workspace">Workspace</label>
							<select id="dashboard-workspace" class="app-field w-auto! min-w-36" bind:value={workspace}>
								<option>All workspaces</option>
								<option>pau</option>
								<option>claude-bridge</option>
							</select>
						</div>
						<button
							class="app-button optional-panel-toggle"
							type="button"
							aria-pressed={activityOpen}
							onclick={() => (activityOpen = !activityOpen)}>
							<span class="i-tabler-activity" aria-hidden="true"></span>Activity
						</button>
						<button class="app-button-primary dashboard-new-session" type="button" aria-label="New session">
							<span class="i-tabler-plus" aria-hidden="true"></span><span class="dashboard-new-label">New session</span>
						</button>
					</div>
				</header>

				<div
					class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-warning/50 bg-wash-warning px-4 py-3">
					<div class="flex min-w-0 items-start gap-3">
						<span class="i-tabler-alert-circle mt-0.5 text-warning" aria-hidden="true"></span>
						<div class="min-w-0">
							<strong class="block truncate text-body text-text">Refine session shell needs a decision</strong>
							<span class="text-micro text-muted">Choose what compact tool activity should show.</span>
						</div>
					</div>
					<button class="app-button-primary" type="button"
						>Review<span class="i-tabler-arrow-right" aria-hidden="true"></span></button>
				</div>

				<div class="flex min-h-11 items-end gap-1 border-b border-line px-4" role="tablist" aria-label="Filter work">
					{#each ['All', 'Needs you', 'Running'] as option (option)}
						<button
							class="mock-tab"
							type="button"
							role="tab"
							aria-selected={status === option}
							onclick={() => (status = option as typeof status)}>
							{option}
							<span class="ml-1 text-micro text-muted">
								{option === 'All' ? work.length : option === 'Needs you' ? 1 : 1}
							</span>
						</button>
					{/each}
				</div>

				<div class="min-h-0 flex-1 overflow-auto">
					<div
						class="dashboard-list-head grid grid-cols-[minmax(12rem,1fr)_8rem_6rem] border-b border-line px-4 py-2 text-micro font-650 uppercase tracking-[0.06em] text-muted">
						<span>Task</span><span>Agent</span><span>Status</span>
					</div>
					{#each visibleWork as item (item.id)}
						<button
							class="dashboard-work-row row-button grid min-h-15 grid-cols-[minmax(12rem,1fr)_8rem_6rem] items-center border-b border-b-line px-4 py-2"
							type="button"
							aria-pressed={selectedId === item.id}
							onclick={() => (selectedId = item.id)}>
							<span class="min-w-0">
								<strong class="block truncate text-body font-600 text-text">{item.task}</strong>
								<span class="mt-1 flex min-w-0 items-center gap-1.5 text-micro text-muted">
									<span>{item.workspace}</span>
									<span class="i-octicon-git-branch-16" aria-hidden="true"></span>
									<span class="truncate font-mono">{item.branch}</span>
									{#if item.added > 0}
										<span class="diffstat ml-1"
											><span class="text-added">+{item.added}</span><span class="text-removed">−{item.removed}</span
											></span>
									{/if}
									<span class={`dashboard-inline-status ${statusTone(item.status)}`}
										><span class="status-dot mr-1"></span>{item.status}</span>
								</span>
							</span>
							<span class="dashboard-agent flex items-center gap-2 text-meta text-text"
								>{@render harnessMark(item.harness)}{item.harness}</span>
							<span class={`dashboard-status grid gap-0.5 text-meta ${statusTone(item.status)}`}>
								<span><span class="status-dot mr-1.5"></span>{item.status}</span>
								<span class="font-mono text-micro text-muted">{item.elapsed}</span>
							</span>
						</button>
					{/each}
				</div>

				<footer class="flex min-h-10 items-center gap-2 border-t border-line bg-surface px-4 text-micro text-muted">
					<span class="flex items-center gap-1.5 text-text"
						>{@render harnessMark(selectedWork.harness)}{selectedWork.task}</span>
					<span class="dashboard-footer-detail">·</span><span class="dashboard-footer-detail"
						>{selectedWork.detail}</span>
					<button class="quiet-button ml-auto" type="button">Open session</button>
				</footer>
			</section>

			{#if activityOpen}
				<aside class="mock-inspector flex flex-col p-0!" aria-label="Workspace activity">
					<div class="section-head">
						<span class="section-label">Workspace activity</span>
						<button
							class="icon-button ml-auto size-7!"
							type="button"
							aria-label="Close activity panel"
							onclick={() => (activityOpen = false)}>
							<span class="i-tabler-x" aria-hidden="true"></span>
						</button>
					</div>
					<div class="section-head mt-2">
						<span class="section-label">Changed files</span><span class="diffstat ml-auto"
							><span class="text-added">+64</span><span class="text-removed">−19</span></span>
					</div>
					{#each [{ file: 'SessionView.svelte', state: 'M', tone: 'text-warning', stat: '+12 −3' }, { file: 'session-shell.css', state: 'M', tone: 'text-warning', stat: '+6 −7' }, { file: 'path-policy.rs', state: 'A', tone: 'text-positive', stat: '+46' }] as change (change.file)}
						<div class="data-row font-mono">
							<span class="flex min-w-0 items-center gap-2"
								><span class={`${change.tone} font-600`}>{change.state}</span><span class="truncate">{change.file}</span
								></span>
							<span class="text-micro text-muted">{change.stat}</span>
						</div>
					{/each}

					<div class="section-head mt-4"><span class="section-label">Checks</span></div>
					{#each [{ name: 'session components', result: '42 passed', tone: 'text-positive' }, { name: 'path policy', result: '18 passed', tone: 'text-positive' }, { name: 'visual review', result: 'waiting', tone: 'text-warning' }] as check (check.name)}
						<div class="data-row">
							<span class="truncate">{check.name}</span><span class={`text-micro ${check.tone}`}>{check.result}</span>
						</div>
					{/each}
				</aside>
			{/if}
		</div>
	</MockApp>
</PrototypePage>
