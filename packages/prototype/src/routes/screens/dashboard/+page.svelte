<script lang="ts">
	import MockApp from '$lib/components/MockApp.svelte';
	import ProductRail from '$lib/components/ProductRail.svelte';
	import PrototypePage from '$lib/components/PrototypePage.svelte';

	const work = [
		{
			id: 'session-shell',
			task: 'Refine session shell',
			workspace: 'pau',
			harness: 'Pi',
			status: 'waiting',
			detail: 'Needs a layout decision'
		},
		{
			id: 'reconnect',
			task: 'Review reconnect handling',
			workspace: 'pau',
			harness: 'Claude Code',
			status: 'running',
			detail: 'Running focused checks'
		},
		{
			id: 'path-tests',
			task: 'Add path boundary tests',
			workspace: 'pau',
			harness: 'Codex',
			status: 'queued',
			detail: 'Waiting for a write slot'
		}
	];
	let selected = $state(work[0].id);
	const selectedWork = $derived(work.find((item) => item.id === selected) ?? work[0]);
</script>

<PrototypePage
	section="V1 screen · 01"
	title="Agentic IDE dashboard"
	note="The dashboard is a return point, not a launch detour. It shows active work, blocked decisions, and harness health so the operator can enter the session that needs attention.">
	<MockApp context="dashboard">
		<div class="mock-layout">
			<ProductRail active="home" />

			<aside class="mock-context-rail" aria-label="Workspace overview">
				<div class="flex items-center justify-between">
					<p class="mock-section-label mb-0!">Workspaces</p>
					<button class="icon-button size-8!" type="button" aria-label="Open workspace"
						><span class="i-tabler-plus"></span></button>
				</div>
				<div class="mock-list mt-3">
					<button type="button" aria-pressed="true"
						><span class="i-tabler-folder-code"></span><span
							><strong class="block text-text">pau</strong><small>3 active sessions</small></span
						><span class="status-dot text-warning"></span></button>
					<button type="button"
						><span class="i-tabler-folder-code"></span><span
							><strong class="block text-text">claude-bridge</strong><small>1 idle session</small></span
						><span></span></button>
					<button type="button"
						><span class="i-tabler-folder-code"></span><span
							><strong class="block text-text">website</strong><small>No active work</small></span
						><span></span></button>
				</div>

				<p class="mock-section-label mt-7">Saved views</p>
				<div class="mock-list">
					<button type="button"
						><span class="i-tabler-alert-circle"></span><span>Needs attention</span><span>1</span></button>
					<button type="button"><span class="i-tabler-player-play"></span><span>Running</span><span>1</span></button>
					<button type="button"><span class="i-tabler-clock"></span><span>Recent</span><span>8</span></button>
				</div>
			</aside>

			<section class="mock-main overflow-auto" aria-label="Dashboard">
				<header class="dashboard-toolbar border-b border-line">
					<div class="min-w-0">
						<h2 class="m-0 whitespace-nowrap text-lg font-600 leading-tight">Work in progress</h2>
						<p class="mb-0 mt-2 text-xs leading-5 text-muted">Continue a session or assign a new task.</p>
					</div>
					<div class="dashboard-toolbar__actions">
						<button class="app-button" type="button"><span class="i-tabler-folder-plus"></span>Open workspace</button>
						<button class="app-button-primary" type="button"><span class="i-tabler-plus"></span>New session</button>
					</div>
				</header>

				<div class="grid grid-cols-3 border-b border-line bg-surface">
					<div class="border-r border-line p-4">
						<span class="block text-xs leading-4 text-muted">Active sessions</span><strong
							class="mt-2 block text-xl font-600 leading-none tabular-nums">4</strong>
					</div>
					<div class="border-r border-line p-4">
						<span class="block text-xs leading-4 text-muted">Needs attention</span><strong
							class="mt-2 block text-xl font-600 leading-none tabular-nums text-warning">1</strong>
					</div>
					<div class="p-4">
						<span class="block text-xs leading-4 text-muted">Changed files</span><strong
							class="mt-2 block text-xl font-600 leading-none tabular-nums">12</strong>
					</div>
				</div>

				<div class="p-5">
					<div class="mb-3 flex items-center justify-between">
						<p class="mock-section-label mb-0!">Active work</p>
						<button class="border-0 bg-transparent text-xs text-muted" type="button">Open control room</button>
					</div>
					<div class="border-t border-line">
						{#each work as item (item.id)}
							<button
								class="dashboard-work-row grid min-h-17 w-full grid-cols-[minmax(10rem,1fr)_7rem_7rem] items-center border-0 border-b border-line bg-transparent px-3 text-left text-xs text-muted hover:bg-surface-raised"
								class:bg-surface-selected={selected === item.id}
								type="button"
								aria-pressed={selected === item.id}
								onclick={() => (selected = item.id)}>
								<span class="grid gap-0.5 leading-5"
									><strong class="block text-sm leading-5 text-text">{item.task}</strong><span
										>{item.workspace} · {item.detail}</span
									></span>
								<span class="text-text"
									>{#if item.harness === 'Pi'}<b class="mr-2 text-accent">π</b
										>{:else if item.harness === 'Claude Code'}<span class="i-simple-icons-anthropic mr-2"></span
										>{:else}<span class="i-simple-icons-openai mr-2"></span>{/if}{item.harness}</span>
								<span
									class={item.status === 'waiting'
										? 'text-warning'
										: item.status === 'running'
											? 'text-positive'
											: 'text-muted'}><span class="status-dot mr-2"></span>{item.status}</span>
							</button>
						{/each}
					</div>

					<div class="dashboard-support mt-8 grid grid-cols-2 gap-8">
						<section>
							<p class="mock-section-label">Changed recently</p>
							<div class="grid gap-3 mock-code text-xs">
								<div class="flex justify-between">
									<span>SessionView.svelte</span><span class="text-warning">M</span>
								</div>
								<div class="flex justify-between">
									<span>session-shell.css</span><span class="text-warning">M</span>
								</div>
								<div class="flex justify-between"><span>path-policy.rs</span><span class="text-positive">A</span></div>
							</div>
						</section>
						<section>
							<p class="mock-section-label">Recent checks</p>
							<div class="grid gap-3 text-xs">
								<div class="flex justify-between">
									<span>session components</span><span class="text-positive">42 passed</span>
								</div>
								<div class="flex justify-between">
									<span>path policy</span><span class="text-positive">18 passed</span>
								</div>
								<div class="flex justify-between">
									<span>visual review</span><span class="text-warning">waiting</span>
								</div>
							</div>
						</section>
					</div>
				</div>
			</section>

			<aside class="mock-inspector flex flex-col" aria-label="Selected work">
				<p class="mock-section-label">Selected work</p>
				<h2 class="mb-0 mt-0 text-base font-600 leading-5">{selectedWork.task}</h2>
				<p class="mb-0 mt-2 text-xs leading-4 text-muted">{selectedWork.workspace} · {selectedWork.harness}</p>
				<div class="mt-3 border-y border-line py-3 text-xs leading-5">
					<span class="text-warning">Decision required</span>
					<p class="mb-0 mt-2 text-muted">
						Choose whether compact tool activity should show file counts or the latest command.
					</p>
				</div>
				<div class="mt-3 grid gap-2">
					<button class="app-button-primary" type="button"
						>Open session<span class="i-tabler-arrow-right"></span></button
					><button class="app-button" type="button">Send follow-up</button>
				</div>

				<p class="mock-section-label mt-6">Harness health</p>
				<div class="grid gap-3 text-xs">
					<div class="flex justify-between"><span>Pi</span><span class="text-positive">ready</span></div>
					<div class="flex justify-between"><span>Claude Code</span><span class="text-positive">ready</span></div>
					<div class="flex justify-between"><span>Codex</span><span class="text-positive">ready</span></div>
				</div>
				<p class="mt-auto mb-0 text-xs leading-5 text-muted">
					Pau opens the most recent active surface on launch. Use Home when you need the cross-workspace view.
				</p>
			</aside>
		</div>
	</MockApp>
</PrototypePage>
