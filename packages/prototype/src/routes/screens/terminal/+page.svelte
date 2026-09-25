<script lang="ts">
	import MockApp from '$lib/components/MockApp.svelte';
	import ProductRail from '$lib/components/ProductRail.svelte';
	import PrototypePage from '$lib/components/PrototypePage.svelte';

	const terminals = [
		{ id: 'shell', name: 'zsh', detail: 'pau · idle', tone: 'text-muted', badge: '' },
		{ id: 'dev', name: 'pnpm dev', detail: 'pau · running', tone: 'text-positive', badge: 'live' },
		{ id: 'test', name: 'pnpm test', detail: 'pau · exited', tone: 'text-danger', badge: 'exit 1' }
	];
	let selected = $state('dev');
	let findOpen = $state(true);
</script>

<PrototypePage
	section="V1 screen · 07"
	title="Terminal"
	note="Persistent PTY terminals with tabs, search, activity state, and exit reporting. Terminal output stays raw text and is never presented as structured tool state. Rendered in Nord so the ANSI palette can be checked against the application surfaces.">
	<MockApp context="pau / terminal" branch="session-shell" theme="nord">
		<div class="mock-layout session-layout--no-inspector">
			<ProductRail active="terminal" />

			<aside class="mock-context-rail p-0!" aria-label="Terminals">
				<div class="section-head">
					<span class="section-label">Terminals</span>
					<button class="icon-button ml-auto size-7!" type="button" aria-label="New terminal">
						<span class="i-tabler-plus" aria-hidden="true"></span>
					</button>
				</div>
				<div class="grid">
					{#each terminals as term (term.id)}
						<button
							class="row-button grid min-h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 py-2 pl-2 pr-3"
							type="button"
							aria-pressed={selected === term.id}
							onclick={() => (selected = term.id)}>
							<span class={`status-dot ${term.tone}`}></span>
							<span class="min-w-0">
								<span class="block truncate font-mono text-body text-text">{term.name}</span>
								<span class="text-micro">{term.detail}</span>
							</span>
							{#if term.badge}<span class={`font-mono text-micro ${term.tone}`}>{term.badge}</span>{/if}
						</button>
					{/each}
				</div>

				<div class="section-head mt-4">
					<span class="section-label">Shell</span>
				</div>
				<div class="grid">
					{#each [{ label: 'Program', value: 'zsh' }, { label: 'Directory', value: '~/code/pau' }, { label: 'Scrollback', value: '3.2k / 10k' }] as row (row.label)}
						<div class="data-row">
							<span>{row.label}</span><span class="font-mono text-micro text-text">{row.value}</span>
						</div>
					{/each}
				</div>

				<div class="m-3 border border-line p-2.5">
					<div class="flex items-center gap-2 text-meta text-text">
						<span class="i-tabler-shield-check text-positive" aria-hidden="true"></span>direnv trusted
					</div>
					<p class="m-0 mt-1.5 text-micro leading-relaxed text-muted">
						This workspace loads its <span class="font-mono">.envrc</span> because you trusted it. Untrusted workspaces start
						with a plain shell.
					</p>
				</div>
			</aside>

			<section class="mock-main flex min-h-0 flex-col" aria-label="Terminal">
				<div class="mock-tabs" role="tablist" aria-label="Open terminals">
					{#each terminals as term (term.id)}
						<button
							class="mock-tab flex items-center gap-2 font-mono"
							type="button"
							role="tab"
							aria-selected={selected === term.id}
							onclick={() => (selected = term.id)}>
							<span class="i-tabler-terminal-2" aria-hidden="true"></span>{term.name}
							{#if term.badge === 'live'}<span class="status-dot size-1.5! text-positive"></span>
							{:else if term.badge}<span class="status-dot size-1.5! text-danger"></span>{/if}
						</button>
					{/each}
					<button class="mock-tab" type="button" aria-label="New terminal"
						><span class="i-tabler-plus" aria-hidden="true"></span></button>
				</div>

				{#if findOpen}
					<div class="flex min-h-9 items-center gap-2 border-b border-line bg-surface pl-3 pr-2 text-micro text-muted">
						<span class="i-tabler-search" aria-hidden="true"></span>
						<input
							class="h-6.5 min-w-0 flex-1 border border-line bg-canvas px-1.5 font-mono text-micro text-text outline-none focus:border-accent"
							type="search"
							value="ready in"
							aria-label="Search scrollback" />
						<span class="font-mono">1 of 2</span>
						<button class="icon-button size-6!" type="button" aria-label="Previous match"
							><span class="i-tabler-chevron-up" aria-hidden="true"></span></button>
						<button class="icon-button size-6!" type="button" aria-label="Next match"
							><span class="i-tabler-chevron-down" aria-hidden="true"></span></button>
						<button
							class="icon-button size-6!"
							type="button"
							aria-label="Close search"
							onclick={() => (findOpen = false)}>
							<span class="i-tabler-x" aria-hidden="true"></span>
						</button>
					</div>
				{/if}

				<div class="term-surface">
					<div class="term-line">
						<span class="text-accent">➜</span> <span class="text-ansi-blue">pau</span>
						<span class="text-ansi-dim">git:(</span><span class="text-ansi-red">session-shell</span><span
							class="text-ansi-dim">)</span> pnpm dev
					</div>
					<div class="term-line"></div>
					<div class="term-line"><span class="text-ansi-dim">&gt;</span> @stormlightlabs/pau-prototype@0.1.0 dev</div>
					<div class="term-line"><span class="text-ansi-dim">&gt;</span> vite dev</div>
					<div class="term-line"></div>
					<div class="term-line">
						<span class="text-ansi-green">VITE</span> <span class="text-ansi-green">v7.3.1</span>
						<span class="text-ansi-dim">ready in</span> <span class="text-text">412 ms</span>
					</div>
					<div class="term-line"></div>
					<div class="term-line">
						<span class="text-ansi-green">➜</span> <span class="text-text">Local</span>:
						<span class="text-ansi-blue">http://localhost:5173/</span>
					</div>
					<div class="term-line">
						<span class="text-ansi-green">➜</span> <span class="text-text">Network</span>:
						<span class="text-ansi-dim">use --host to expose</span>
					</div>
					<div class="term-line"></div>
					<div class="term-line">
						<span class="text-ansi-yellow">11:02:41</span> <span class="text-ansi-dim">[vite]</span> hmr update
						<span class="text-text">/src/routes/screens/session/+page.svelte</span>
					</div>
					<div class="term-line">
						<span class="text-ansi-yellow">11:02:58</span> <span class="text-ansi-dim">[vite]</span> page reload
						<span class="text-text">uno.config.ts</span>
					</div>
					<div class="term-line"></div>
					<div class="term-line">
						<span class="text-ansi-red">error</span> <span class="text-ansi-dim">when starting dev server:</span>
					</div>
					<div class="term-line">
						<span class="text-ansi-red">Port 5173 is already in use.</span>
						<span class="text-ansi-dim">Trying 5174 instead.</span>
					</div>
					<div class="term-line"></div>
					<div class="term-line">
						<span class="text-accent">➜</span> <span class="text-ansi-blue">pau</span>
						<span class="animate-pulse text-text">▌</span>
					</div>
				</div>

				<footer class="statusbar">
					<span class="flex items-center gap-1.5"><span class="i-tabler-terminal-2" aria-hidden="true"></span>zsh</span>
					<span>~/code/pau</span>
					<span class="flex items-center gap-1.5"
						><span class="i-octicon-git-branch-16" aria-hidden="true"></span>session-shell</span>
					<span class="ml-auto flex items-center gap-3">
						<span>118×34</span>
						<span>3.2k lines</span>
						<span class="text-positive">running</span>
					</span>
				</footer>
			</section>
		</div>
	</MockApp>
</PrototypePage>
