<script lang="ts">
	import MockApp from '$lib/components/MockApp.svelte';
	import ProductRail from '$lib/components/ProductRail.svelte';
	import PrototypePage from '$lib/components/PrototypePage.svelte';

	type NvimLine = { rel: string; selected?: boolean; cursor?: boolean; tokens: { c: string; t: string }[] };

	/** Neovim draws relative line numbers, so `rel` is not a file line number. */
	const buffer: NvimLine[] = [
		{ rel: '4', tokens: [{ c: 'tok-comment', t: '/* Session shell layout. */' }] },
		{ rel: '3', tokens: [] },
		{
			rel: '2',
			tokens: [
				{ c: 'tok-entity', t: '.session-shell' },
				{ c: 'tok-punctuation', t: ' {' }
			]
		},
		{
			rel: '1',
			tokens: [
				{ c: 'tok-keyword', t: '  display' },
				{ c: 'tok-punctuation', t: ':' },
				{ c: 'tok-constant', t: ' grid' },
				{ c: 'tok-punctuation', t: ';' }
			]
		},
		{
			rel: '42',
			cursor: true,
			tokens: [
				{ c: 'tok-keyword', t: '  grid-template-columns' },
				{ c: 'tok-punctuation', t: ':' },
				{ c: 'tok-type', t: ' var' },
				{ c: 'tok-punctuation', t: '(' },
				{ c: 'tok-string', t: '--rail-context' },
				{ c: 'tok-punctuation', t: ')' },
				{ c: 'tok-type', t: ' minmax' },
				{ c: 'tok-punctuation', t: '(' },
				{ c: 'tok-constant', t: '0' },
				{ c: 'tok-punctuation', t: ', ' },
				{ c: 'tok-constant', t: '1fr' },
				{ c: 'tok-punctuation', t: ');' }
			]
		},
		{
			rel: '1',
			selected: true,
			tokens: [
				{ c: 'tok-keyword', t: '  min-width' },
				{ c: 'tok-punctuation', t: ':' },
				{ c: 'tok-constant', t: ' 0' },
				{ c: 'tok-punctuation', t: ';' }
			]
		},
		{
			rel: '2',
			selected: true,
			tokens: [
				{ c: 'tok-keyword', t: '  overflow' },
				{ c: 'tok-punctuation', t: ':' },
				{ c: 'tok-constant', t: ' auto' },
				{ c: 'tok-punctuation', t: ';' }
			]
		},
		{ rel: '3', selected: true, tokens: [{ c: 'tok-punctuation', t: '}' }] },
		{ rel: '4', tokens: [] },
		{
			rel: '5',
			tokens: [
				{ c: 'tok-entity', t: '.session-shell__main' },
				{ c: 'tok-punctuation', t: ' {' }
			]
		},
		{
			rel: '6',
			tokens: [
				{ c: 'tok-keyword', t: '  grid-area' },
				{ c: 'tok-punctuation', t: ':' },
				{ c: 'tok-constant', t: ' main' },
				{ c: 'tok-punctuation', t: ';' }
			]
		},
		{ rel: '7', tokens: [{ c: 'tok-punctuation', t: '}' }] }
	];

	const files = [
		{ name: 'SessionView.svelte', icon: 'i-catppuccin-svelte', state: 'M' },
		{ name: 'session-shell.css', icon: 'i-catppuccin-css', state: 'M' },
		{ name: 'state.ts', icon: 'i-catppuccin-typescript', state: '' }
	];

	let loadInit = $state(false);
	let applyTheme = $state(true);
</script>

<PrototypePage
	section="V1 screen · 06"
	title="Neovim surface"
	note="Neovim runs as an embedded external UI. Pau forwards redraw, input, clipboard, and resize, and draws nothing over the buffer. The mode line, command line, and messages belong to Neovim. The tabs, rails, and inspector around them belong to Pau.">
	<MockApp context="pau / neovim" branch="session-shell">
		<div class="mock-layout">
			<ProductRail active="neovim" />

			<aside class="mock-context-rail p-0!" aria-label="Files">
				<div class="section-head">
					<span class="section-label">Files</span>
					<span class="chip ml-auto">pau</span>
				</div>
				<div class="grid py-1">
					<div class="flex min-h-7 items-center gap-1.5 pl-2 font-mono text-meta text-muted">
						<span class="i-tabler-chevron-down" aria-hidden="true"></span><span
							class="i-tabler-folder"
							aria-hidden="true"></span
						>src/session
					</div>
					{#each files as file, index (file.name)}
						<button
							class="row-button grid min-h-7.5 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 pl-6 pr-3 font-mono text-meta"
							type="button"
							aria-pressed={index === 1}>
							<span class={file.icon} aria-hidden="true"></span>
							<span class="truncate">{file.name}</span>
							{#if file.state}<span class="text-warning">{file.state}</span>{/if}
						</button>
					{/each}
				</div>

				<div class="section-head mt-3">
					<span class="section-label">Buffers</span>
				</div>
				<div class="grid py-1">
					{#each [{ id: 1, name: 'session-shell.css', flag: '%a' }, { id: 2, name: 'SessionView.svelte', flag: '#' }] as buf (buf.id)}
						<button
							class="row-button grid min-h-7 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 pl-4 pr-3 font-mono text-micro"
							type="button"
							aria-pressed={buf.flag === '%a'}>
							<span class="text-accent">{buf.id}</span><span class="truncate">{buf.name}</span><span>{buf.flag}</span>
						</button>
					{/each}
				</div>
			</aside>

			<section class="mock-main flex min-h-0 flex-col" aria-label="Neovim">
				<div class="mock-tabs" role="tablist" aria-label="Open files">
					<button class="mock-tab flex items-center gap-2 font-mono" type="button" role="tab" aria-selected="false">
						<span class="i-catppuccin-svelte" aria-hidden="true"></span>SessionView.svelte
					</button>
					<button class="mock-tab flex items-center gap-2 font-mono" type="button" role="tab" aria-selected="true">
						<span class="i-catppuccin-css" aria-hidden="true"></span>session-shell.css
						<span class="status-dot size-1.5! text-warning"></span>
					</button>
					<span class="ml-auto flex items-center gap-1.5 self-center pr-1 text-micro text-muted">
						<span class="i-simple-icons-neovim text-positive" aria-hidden="true"></span>attached
					</span>
				</div>

				<div class="flex min-h-8 items-center gap-2 border-b border-line px-3 text-micro text-muted">
					<span class="chip">nvim 0.11.4</span>
					<span class="chip">{loadInit ? 'init.lua loaded' : 'clean config'}</span>
					{#if applyTheme}<span class="chip-accent">Pau theme applied</span>{/if}
					<span class="ml-auto font-mono">grid 118×34</span>
				</div>

				<div class="code-surface flex flex-col">
					{#each buffer as line, index (index)}
						<div class={`code-line ${line.cursor ? 'bg-line-active' : ''}`}>
							<span class={`code-gutter ${line.cursor ? 'text-text' : ''}`}>{line.rel}</span>
							<span class={`code-text ${line.selected ? 'bg-selection' : ''}`}
								>{#each line.tokens as token, tokenIndex (tokenIndex)}<span class={token.c}>{token.t}</span
									>{/each}{#if line.cursor}<span
										class="inline-block h-4 w-2 translate-y-0.5 bg-accent"
										aria-hidden="true"></span
									>{/if}</span>
						</div>
					{/each}
					{#each [1, 2, 3, 4, 5, 6] as filler (filler)}
						<div class="code-line">
							<span class="code-gutter text-muted opacity-50">~</span><span></span>
						</div>
					{/each}
				</div>

				<div
					class="flex min-h-8 items-stretch whitespace-nowrap border-t border-line bg-surface-raised font-mono text-micro">
					<span class="flex shrink-0 items-center bg-warning px-2.5 font-700 tracking-[0.08em] text-canvas"
						>VISUAL</span>
					<span class="hidden shrink-0 items-center gap-1.5 px-2.5 text-muted lg:flex">
						<span class="i-octicon-git-branch-16" aria-hidden="true"></span>session-shell
					</span>
					<span class="flex min-w-0 items-center gap-1.5 truncate px-2.5 text-text">session-shell.css</span>
					<span class="flex shrink-0 items-center gap-1.5 px-2.5 text-warning">+2 ~1</span>
					<span class="ml-auto flex shrink-0 items-center gap-3 px-2.5 text-muted">
						<span class="hidden lg:inline">css</span><span class="hidden xl:inline">utf-8[unix]</span><span>42:3</span
						><span>48%</span>
					</span>
				</div>

				<div class="flex min-h-8 items-center gap-2 bg-canvas px-3 font-mono text-meta text-muted">
					<span class="text-text">:w</span>
					<span>"session-shell.css" 84L, 1.9K written</span>
					<span class="ml-auto">3 lines yanked</span>
				</div>
			</section>

			<aside class="mock-inspector p-0!" aria-label="Neovim session">
				<div class="section-head">
					<span class="section-label">Neovim</span>
					<span class="chip ml-auto text-positive"><span class="status-dot"></span>rpc attached</span>
				</div>

				<div class="grid">
					{#each [{ label: 'Process', value: 'nvim --embed' }, { label: 'Started', value: 'clean (-u NONE)' }, { label: 'Channel', value: 'ch 3' }, { label: 'Clipboard', value: 'forwarded' }] as row (row.label)}
						<div class="data-row">
							<span>{row.label}</span><span class="font-mono text-micro text-text">{row.value}</span>
						</div>
					{/each}
				</div>

				<div class="section-head mt-3">
					<span class="section-label">Configuration</span>
				</div>
				<div class="grid gap-3 p-3">
					<label class="flex items-start gap-2.5 text-meta">
						<input class="mt-0.5 accent-[var(--color-accent)]" type="checkbox" bind:checked={loadInit} />
						<span>
							<span class="block text-text">Load my init.lua</span>
							<span class="text-micro text-muted"
								>Off by default. Pau starts Neovim clean so a broken config cannot block editing.</span>
						</span>
					</label>
					<label class="flex items-start gap-2.5 text-meta">
						<input class="mt-0.5 accent-[var(--color-accent)]" type="checkbox" bind:checked={applyTheme} />
						<span>
							<span class="block text-text">Apply Pau theme to Neovim</span>
							<span class="text-micro text-muted"
								>Maps the active theme onto Neovim highlights. It never rewrites your colorscheme files.</span>
						</span>
					</label>
				</div>

				<div class="section-head mt-3">
					<span class="section-label">Diagnostics</span>
				</div>
				<div class="grid">
					<div class="data-row">
						<span class="truncate">No language server attached</span><span class="text-micro text-muted">—</span>
					</div>
					<div class="data-row">
						<span class="truncate font-mono">stylelint</span><span class="text-micro text-positive">clean</span>
					</div>
				</div>

				<p class="mt-auto p-3 text-micro leading-relaxed text-muted">
					Keys go straight to Neovim while this surface has focus. Pau keeps only the command bar shortcut.
				</p>
			</aside>
		</div>
	</MockApp>
</PrototypePage>
