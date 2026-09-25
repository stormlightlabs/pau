<script lang="ts">
	import MockApp from '$lib/components/MockApp.svelte';
	import ProductRail from '$lib/components/ProductRail.svelte';
	import PrototypePage from '$lib/components/PrototypePage.svelte';

	const work = [
		{
			id: 'session-shell',
			task: 'Refine session shell',
			workspace: 'pau',
			branch: 'session-shell',
			harness: 'Pi',
			model: 'sonnet 4.5',
			status: 'waiting',
			tone: 'text-warning',
			elapsed: '02:14',
			added: 18,
			removed: 7,
			detail: 'Needs a layout decision'
		},
		{
			id: 'reconnect',
			task: 'Review reconnect handling',
			workspace: 'pau',
			branch: 'reconnect-fix',
			harness: 'Claude Code',
			model: 'opus 4.1',
			status: 'running',
			tone: 'text-positive',
			elapsed: '08:31',
			added: 42,
			removed: 12,
			detail: 'Running focused checks'
		},
		{
			id: 'path-tests',
			task: 'Add path boundary tests',
			workspace: 'claude-bridge',
			branch: 'path-policy',
			harness: 'Codex',
			model: 'gpt-5',
			status: 'queued',
			tone: 'text-muted',
			elapsed: '—',
			added: 0,
			removed: 0,
			detail: 'Waiting for a write slot'
		}
	];

	let selected = $state(work[0].id);
	const selectedWork = $derived(work.find((item) => item.id === selected) ?? work[0]);
	const blocked = $derived(work.filter((item) => item.status === 'waiting'));
</script>

{#snippet harnessMark(harness: string)}
	{#if harness === 'Pi'}<b class="text-accent">π</b>
	{:else if harness === 'Claude Code'}<span class="i-simple-icons-anthropic" aria-hidden="true"></span>
	{:else}<span class="i-simple-icons-openai" aria-hidden="true"></span>{/if}
{/snippet}

<PrototypePage
	section="V1 screen · 01"
	title="Agentic IDE dashboard"
	note="The dashboard is a return point, not a launch detour. Blocked decisions sit above running work, each row shows its branch and diff size, and the inspector answers the decision without opening the session.">
	<MockApp context="dashboard">
		<div class="mock-layout">
			<ProductRail active="home" />

			<aside class="mock-context-rail p-0!" aria-label="Workspace overview">
				<div class="section-head">
					<span class="section-label">Workspaces</span>
					<button class="icon-button ml-auto size-7!" type="button" aria-label="Open workspace"
						><span class="i-tabler-plus" aria-hidden="true"></span></button>
				</div>
				<div class="grid">
					{#each [{ name: 'pau', detail: '3 active sessions', attention: true }, { name: 'claude-bridge', detail: '1 idle session', attention: false }, { name: 'website', detail: 'No active work', attention: false }] as workspace, index (workspace.name)}
						<button
							class="row-button grid min-h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 py-2 pl-2 pr-3"
							type="button"
							aria-pressed={index === 0}>
							<span class="i-tabler-folder-code" aria-hidden="true"></span>
							<span class="min-w-0">
								<span class="block truncate text-body text-text">{workspace.name}</span>
								<span class="text-micro">{workspace.detail}</span>
							</span>
							{#if workspace.attention}<span class="status-dot text-warning"></span>{/if}
						</button>
					{/each}
				</div>

				<div class="section-head mt-4">
					<span class="section-label">Saved views</span>
				</div>
				<div class="grid">
					{#each [{ label: 'Needs attention', icon: 'i-tabler-alert-circle', count: 1 }, { label: 'Running', icon: 'i-tabler-player-play', count: 1 }, { label: 'Recent', icon: 'i-tabler-clock', count: 8 }] as view (view.label)}
						<button
							class="row-button grid min-h-9 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 pl-2 pr-3 text-meta"
							type="button">
							<span class={view.icon} aria-hidden="true"></span>
							<span class="truncate">{view.label}</span>
							<span class="font-mono text-micro">{view.count}</span>
						</button>
					{/each}
				</div>
			</aside>

			<section class="mock-main flex min-h-0 flex-col overflow-auto" aria-label="Dashboard">
				<header class="flex min-h-14 items-center gap-4 border-b border-line pl-4 pr-3">
					<div class="min-w-0">
						<h2 class="m-0 text-body font-650 leading-tight text-text">Work in progress</h2>
						<p class="m-0 mt-1 text-micro text-muted">3 sessions across 2 workspaces</p>
					</div>
					<div class="ml-auto flex items-center gap-2">
						<button class="app-button" type="button"
							><span class="i-tabler-folder-plus" aria-hidden="true"></span>Open workspace</button>
						<button class="app-button-primary" type="button"
							><span class="i-tabler-plus" aria-hidden="true"></span>New session</button>
					</div>
				</header>

				{#each blocked as item (item.id)}
					<div
						class="flex items-center gap-3 border-b border-line border-l-2 border-l-warning bg-wash-warning py-2.5 pl-4 pr-3">
						<span class="i-tabler-alert-circle text-warning" aria-hidden="true"></span>
						<div class="min-w-0">
							<strong class="block text-body text-text">{item.task} is waiting on you</strong>
							<span class="text-micro text-muted">{item.detail} · {item.workspace} · {item.branch}</span>
						</div>
						<div class="ml-auto flex items-center gap-2">
							<button class="app-button" type="button">Dismiss</button>
							<button class="app-button-primary" type="button"
								>Answer<span class="i-tabler-arrow-right" aria-hidden="true"></span></button>
						</div>
					</div>
				{/each}

				<div class="flex border-b border-line bg-surface">
					{#each [{ label: 'Active', value: '4', tone: 'text-text' }, { label: 'Needs you', value: '1', tone: 'text-warning' }, { label: 'Changed files', value: '12', tone: 'text-text' }] as metric (metric.label)}
						<div class="flex min-w-0 flex-1 items-baseline gap-2 border-r border-line px-4 py-2.5 last:border-r-0">
							<strong class={`text-base font-650 tabular-nums leading-none ${metric.tone}`}>{metric.value}</strong>
							<span class="truncate text-micro text-muted">{metric.label}</span>
						</div>
					{/each}
				</div>

				<div class="section-head">
					<span class="section-label">Active work</span>
					<button class="quiet-button ml-auto" type="button">Open control room</button>
				</div>
				<div class="grid">
					{#each work as item (item.id)}
						<button
							class="work-row grid-cols-[minmax(10rem,1fr)_6.5rem_5rem_5.5rem] max-md:grid-cols-[minmax(0,1fr)_5.5rem]"
							type="button"
							aria-pressed={selected === item.id}
							onclick={() => (selected = item.id)}>
							<span class="min-w-0">
								<strong class="block truncate text-prose font-600 leading-tight text-text">{item.task}</strong>
								<span class="mt-1 flex items-center gap-1.5 whitespace-nowrap text-micro">
									<span>{item.workspace}</span>
									<span class="i-octicon-git-branch-16" aria-hidden="true"></span>
									<span class="truncate font-mono">{item.branch}</span>
								</span>
							</span>
							<span class="flex items-center gap-1.5 text-text max-md:hidden">
								{@render harnessMark(item.harness)}{item.harness}
							</span>
							<span class="diffstat max-md:hidden">
								{#if item.added > 0}
									<span class="text-added">+{item.added}</span><span class="text-removed">−{item.removed}</span>
								{:else}<span class="text-muted">—</span>{/if}
							</span>
							<span class="grid gap-0.5 whitespace-nowrap">
								<span class={item.tone}><span class="status-dot mr-1.5"></span>{item.status}</span>
								<span class="font-mono text-micro">{item.elapsed}</span>
							</span>
						</button>
					{/each}
				</div>

				<div class="grid grid-cols-2 max-md:grid-cols-1">
					<section class="border-r border-line max-md:border-r-0">
						<div class="section-head">
							<span class="section-label">Changed recently</span>
							<span class="diffstat ml-auto"
								><span class="text-added">+64</span><span class="text-removed">−19</span></span>
						</div>
						<div class="grid">
							{#each [{ file: 'SessionView.svelte', state: 'M', tone: 'text-warning', stat: '+12 −3' }, { file: 'session-shell.css', state: 'M', tone: 'text-warning', stat: '+6 −7' }, { file: 'path-policy.rs', state: 'A', tone: 'text-positive', stat: '+46' }] as change (change.file)}
								<div class="data-row font-mono">
									<span class="flex min-w-0 items-center gap-2"
										><span class={`${change.tone} font-600`}>{change.state}</span><span class="truncate"
											>{change.file}</span
										></span>
									<span class="text-micro text-muted">{change.stat}</span>
								</div>
							{/each}
						</div>
					</section>
					<section>
						<div class="section-head">
							<span class="section-label">Recent checks</span>
							<button class="quiet-button ml-auto" type="button">Run all</button>
						</div>
						<div class="grid">
							{#each [{ name: 'session components', result: '42 passed', tone: 'text-positive' }, { name: 'path policy', result: '18 passed', tone: 'text-positive' }, { name: 'visual review', result: 'waiting', tone: 'text-warning' }] as check (check.name)}
								<div class="data-row">
									<span class="truncate">{check.name}</span>
									<span class={`text-micro ${check.tone}`}>{check.result}</span>
								</div>
							{/each}
						</div>
					</section>
				</div>
			</section>

			<aside class="mock-inspector flex flex-col p-0!" aria-label="Selected work">
				<div class="section-head">
					<span class="section-label">Selected work</span>
					<span class="chip ml-auto">{@render harnessMark(selectedWork.harness)}{selectedWork.harness}</span>
				</div>

				<div class="p-3">
					<h2 class="m-0 text-prose font-650 leading-snug text-text">{selectedWork.task}</h2>
					<div class="mt-2 flex flex-wrap items-center gap-1">
						<span class="chip">{selectedWork.workspace}</span>
						<span class="chip-code"
							><span class="i-octicon-git-branch-16" aria-hidden="true"></span>{selectedWork.branch}</span>
						<span class="chip-code">{selectedWork.model}</span>
					</div>

					<div class="mt-3 border-y border-line py-3">
						<span class="text-micro font-650 uppercase tracking-[0.06em] text-warning">Decision required</span>
						<p class="m-0 mt-1.5 text-meta leading-relaxed text-muted">
							Choose whether compact tool activity shows file counts or the latest command.
						</p>
					</div>

					<div class="mt-3 grid gap-1.5">
						<button class="app-button-primary" type="button"
							>Open session<span class="i-tabler-arrow-right" aria-hidden="true"></span></button>
						<div class="grid grid-cols-2 gap-1.5">
							<button class="app-button" type="button">Follow-up</button>
							<button class="app-button" type="button">Diff</button>
						</div>
					</div>
				</div>

				<div class="section-head">
					<span class="section-label">Harness health</span>
				</div>
				<div class="grid">
					{#each [{ name: 'Pi', state: 'ready · 2 attached' }, { name: 'Claude Code', state: 'ready · 1 running' }, { name: 'Codex', state: 'ready · 1 queued' }] as harness (harness.name)}
						<div class="data-row">
							<span class="flex items-center gap-2">{@render harnessMark(harness.name)}{harness.name}</span>
							<span class="text-micro text-positive">{harness.state}</span>
						</div>
					{/each}
				</div>

				<p class="mt-auto p-3 text-micro leading-relaxed text-muted">
					Pau opens the most recent active surface on launch. Use Home when you need the cross-workspace view.
				</p>
			</aside>
		</div>
	</MockApp>
</PrototypePage>
