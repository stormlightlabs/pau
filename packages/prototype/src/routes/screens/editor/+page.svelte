<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import MockApp from '$lib/components/MockApp.svelte';
	import ProductRail from '$lib/components/ProductRail.svelte';
	import PrototypePage from '$lib/components/PrototypePage.svelte';

	const files = [
		{ path: 'src/session/SessionView.svelte', state: 'M' },
		{ path: 'src/session/session-shell.css', state: 'M' },
		{ path: 'src/session/state.ts', state: '' }
	];
	let activeFile = $state(files[0].path);
	let showHidden = $state(false);
	let showIgnored = $state(false);
	const accepted = new SvelteSet<number>();

	type CodeLine = {
		n: number;
		state?: 'active' | 'added';
		diagnostic?: string;
		tokens: { c: string; t: string; bad?: boolean }[];
	};

	const lineTone: Record<string, string> = {
		active: 'bg-line-active',
		added: 'bg-added-wash shadow-[inset_2px_0_0_var(--diff-add-fg)]'
	};

	/** One entry per rendered line. Tokens carry a syntax class, not a color. */
	const lines: CodeLine[] = [
		{
			n: 1,
			tokens: [
				{ c: 'tok-keyword', t: '<script' },
				{ c: 'tok-entity', t: ' lang' },
				{ c: 'tok-punctuation', t: '=' },
				{ c: 'tok-string', t: '"ts"' },
				{ c: 'tok-keyword', t: '>' }
			]
		},
		{
			n: 2,
			tokens: [
				{ c: 'tok-keyword', t: '  import' },
				{ c: '', t: ' ToolSummary ' },
				{ c: 'tok-keyword', t: 'from' },
				{ c: 'tok-string', t: " './ToolSummary.svelte'" },
				{ c: 'tok-punctuation', t: ';' }
			]
		},
		{ n: 3, tokens: [] },
		{
			n: 4,
			tokens: [
				{ c: 'tok-keyword', t: '  let' },
				{ c: '', t: ' inspectorOpen ' },
				{ c: 'tok-punctuation', t: '=' },
				{ c: 'tok-entity', t: ' $state' },
				{ c: 'tok-punctuation', t: '(' },
				{ c: 'tok-constant', t: 'true' },
				{ c: 'tok-punctuation', t: ');' }
			]
		},
		{
			n: 5,
			tokens: [
				{ c: 'tok-keyword', t: '  let' },
				{ c: '', t: ' selectedTool ' },
				{ c: 'tok-punctuation', t: '=' },
				{ c: 'tok-entity', t: ' $state' },
				{ c: 'tok-punctuation', t: '<' },
				{ c: 'tok-type', t: 'ToolCall' },
				{ c: 'tok-punctuation', t: '>();' }
			]
		},
		{ n: 6, tokens: [] },
		{
			n: 7,
			state: 'active',
			tokens: [
				{ c: 'tok-keyword', t: '  function' },
				{ c: 'tok-entity', t: ' openTool' },
				{ c: 'tok-punctuation', t: '(' },
				{ c: '', t: 'tool' },
				{ c: 'tok-punctuation', t: ': ' },
				{ c: 'tok-type', t: 'ToolCall' },
				{ c: 'tok-punctuation', t: ') {' }
			]
		},
		{
			n: 8,
			tokens: [
				{ c: '', t: '    selectedTool ' },
				{ c: 'tok-punctuation', t: '=' },
				{ c: '', t: ' tool' },
				{ c: 'tok-punctuation', t: ';' }
			]
		},
		{
			n: 9,
			state: 'added',
			tokens: [
				{ c: '', t: '    inspectorOpen ' },
				{ c: 'tok-punctuation', t: '=' },
				{ c: 'tok-constant', t: ' true' },
				{ c: 'tok-punctuation', t: ';' }
			]
		},
		{ n: 10, tokens: [{ c: 'tok-punctuation', t: '  }' }] },
		{ n: 11, tokens: [] },
		{ n: 12, tokens: [{ c: 'tok-comment', t: '  // Narrow widths move the inspector to an overlay.' }] },
		{
			n: 13,
			state: 'added',
			diagnostic: 'width',
			tokens: [
				{ c: 'tok-keyword', t: '  const' },
				{ c: '', t: ' overlay ' },
				{ c: 'tok-punctuation', t: '=' },
				{ c: 'tok-entity', t: ' $derived' },
				{ c: 'tok-punctuation', t: '(' },
				{ c: '', t: 'width ', bad: true },
				{ c: 'tok-punctuation', t: '<' },
				{ c: 'tok-constant', t: ' 1100' },
				{ c: 'tok-punctuation', t: ');' }
			]
		},
		{ n: 14, tokens: [{ c: 'tok-keyword', t: '<\u{2F}script>' }] }
	];

	function toggleHunk(hunk: number) {
		if (accepted.has(hunk)) accepted.delete(hunk);
		else accepted.add(hunk);
	}
</script>

<PrototypePage
	section="V1 screen · 05"
	title="Editor and review"
	note="CodeMirror is Pau’s primary built-in editor for quick changes and review. Files can open in a preferred external editor while Pau keeps dirty and external-change state visible.">
	<MockApp context="pau / editor" branch="session-shell" theme="catppuccin">
		<div class="mock-layout">
			<ProductRail active="editor" />

			<aside class="mock-context-rail p-0!" aria-label="Files">
				<div class="section-head">
					<span class="section-label">Files</span>
					<span class="chip ml-auto">pau</span>
				</div>
				<form class="grid gap-1.5 border-b border-line px-2 pb-2" role="search">
					<label class="section-label" for="prototype-file-search">Search files</label>
					<div class="flex h-7 items-center gap-1.5 border border-line bg-canvas px-2 text-muted">
						<span class="i-tabler-search" aria-hidden="true"></span>
						<input
							id="prototype-file-search"
							class="min-w-0 flex-1 bg-transparent font-mono text-micro text-text outline-none"
							type="search"
							placeholder="Text in files" />
					</div>
				</form>
				<fieldset class="flex flex-wrap gap-x-3 border-0 border-b border-line px-2 py-1.5 text-micro text-muted">
					<legend class="sr-only">File visibility</legend>
					<label class="flex min-h-7 items-center gap-1.5">
						<input type="checkbox" bind:checked={showHidden} /> Hidden
					</label>
					<label class="flex min-h-7 items-center gap-1.5">
						<input type="checkbox" bind:checked={showIgnored} /> Ignored
					</label>
				</fieldset>
				<div class="grid py-1">
					<div class="flex min-h-7 items-center gap-1.5 pl-2 font-mono text-meta text-muted">
						<span class="i-tabler-chevron-down" aria-hidden="true"></span><span
							class="i-tabler-folder"
							aria-hidden="true"></span
						>src/session
					</div>
					{#each files as file (file.path)}
						<button
							class="row-button grid min-h-7.5 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 pl-6 pr-3 font-mono text-meta"
							type="button"
							aria-pressed={activeFile === file.path}
							onclick={() => (activeFile = file.path)}>
							<span
								class={file.path.endsWith('.svelte')
									? 'i-catppuccin-svelte'
									: file.path.endsWith('.css')
										? 'i-catppuccin-css'
										: 'i-catppuccin-typescript'}
								aria-hidden="true"></span>
							<span class="truncate">{file.path.split('/').at(-1)}</span>
							{#if file.state}<span class="text-warning">{file.state}</span>{/if}
						</button>
					{/each}
				</div>

				<div class="section-head mt-3">
					<span class="section-label">Outline</span>
				</div>
				<div class="grid py-1">
					{#each [{ icon: 'i-tabler-square-letter-v', name: 'SessionView' }, { icon: 'i-tabler-square-letter-f', name: 'openTool' }, { icon: 'i-tabler-square-letter-f', name: 'submitFollowUp' }, { icon: 'i-tabler-square-letter-c', name: 'overlay' }] as symbol (symbol.name)}
						<button
							class="row-button grid min-h-7 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 pl-4 pr-3 font-mono text-micro"
							type="button">
							<span class={`${symbol.icon} text-accent`} aria-hidden="true"></span><span class="truncate"
								>{symbol.name}</span>
						</button>
					{/each}
				</div>
			</aside>

			<section class="mock-main flex min-h-0 flex-col" aria-label="Editor">
				<div class="mock-tabs" role="tablist" aria-label="Open files">
					{#each files.slice(0, 2) as file (file.path)}
						<button
							class="mock-tab flex items-center gap-2 font-mono"
							type="button"
							role="tab"
							aria-selected={activeFile === file.path}
							onclick={() => (activeFile = file.path)}>
							<span class={file.path.endsWith('.css') ? 'i-catppuccin-css' : 'i-catppuccin-svelte'} aria-hidden="true"
							></span>
							{file.path.split('/').at(-1)}
							{#if file.state}<span class="status-dot size-1.5! text-warning"></span>{/if}
						</button>
					{/each}
				</div>

				<div class="flex min-h-8 items-center gap-1 border-b border-line px-3 text-micro text-muted">
					<span>src</span><span class="i-tabler-chevron-right" aria-hidden="true"></span>
					<span>session</span><span class="i-tabler-chevron-right" aria-hidden="true"></span>
					<span class="text-text">SessionView.svelte</span><span class="i-tabler-chevron-right" aria-hidden="true"
					></span>
					<span class="font-mono text-text">openTool</span>
					<button class="app-button ml-auto min-h-6! px-2! text-micro!" type="button" aria-label="Open in Neovim">
						<span class="i-tabler-external-link" aria-hidden="true"></span><span class="hidden xl:inline"
							>Open in Neovim</span>
					</button>
					<span class="chip-warning"><span class="i-tabler-alert-triangle" aria-hidden="true"></span>1 problem</span>
				</div>

				<div class="flex min-h-9 items-center gap-2 border-b border-line bg-surface pl-3 pr-2 text-micro text-muted">
					<span class="i-tabler-search" aria-hidden="true"></span>
					<input
						class="h-6.5 min-w-0 flex-1 border border-line bg-canvas px-1.5 font-mono text-micro text-text outline-none focus:border-accent"
						type="search"
						value="inspectorOpen"
						aria-label="Find in file" />
					<span class="font-mono">2 of 3</span>
					<button class="icon-button size-6!" type="button" aria-label="Previous match"
						><span class="i-tabler-chevron-up" aria-hidden="true"></span></button>
					<button class="icon-button size-6!" type="button" aria-label="Next match"
						><span class="i-tabler-chevron-down" aria-hidden="true"></span></button>
					<button class="icon-button size-6!" type="button" aria-label="Close find"
						><span class="i-tabler-x" aria-hidden="true"></span></button>
				</div>

				<div class="code-surface">
					{#each lines as line (line.n)}
						<div class={`code-line ${line.state ? lineTone[line.state] : ''}`}>
							<span class={`code-gutter ${line.state === 'active' ? 'text-text' : ''}`}>{line.n}</span>
							<span class="code-text"
								>{#each line.tokens as token, index (index)}<span
										class={token.bad ? `${token.c} underline decoration-wavy decoration-danger` : token.c}
										>{token.t}</span
									>{/each}</span>
						</div>
						{#if line.diagnostic}
							<div class="code-line">
								<span class="code-gutter"></span>
								<span class="code-text flex items-center gap-1.5 text-micro text-danger"
									><span class="i-tabler-alert-circle" aria-hidden="true"></span>Cannot find name '{line.diagnostic}'.
									ts(2304)</span>
							</div>
						{/if}
					{/each}
				</div>

				<footer class="statusbar">
					<span class="flex items-center gap-1.5"
						><span class="i-octicon-git-branch-16" aria-hidden="true"></span>session-shell</span>
					<span class="text-danger">1 problem</span>
					<span class="ml-auto flex items-center gap-3">
						<span>Ln 7, Col 1</span>
						<span class="hidden xl:inline">Spaces: 2</span>
						<span class="hidden xl:inline">UTF-8</span>
						<span>Svelte</span>
						<span class="hidden 2xl:inline">CodeMirror · LSP off</span>
					</span>
				</footer>
			</section>

			<aside class="mock-inspector p-0!" aria-label="Review">
				<div class="section-head">
					<span class="section-label">Review</span>
					<span class="ml-auto text-micro text-muted">{accepted.size} of 2 accepted</span>
				</div>

				<div class="grid">
					{#each [{ file: 'SessionView.svelte', stat: '+18', del: '' }, { file: 'session-shell.css', stat: '+9', del: '−3' }] as change, index (change.file)}
						<button
							class="row-button grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-line pl-3 pr-3 font-mono text-meta"
							type="button"
							aria-pressed={index === 0}>
							<span class="truncate">{change.file}</span>
							<span class="diffstat"
								><span class="text-added">{change.stat}</span>{#if change.del}<span class="text-removed"
										>{change.del}</span
									>{/if}</span>
						</button>
					{/each}
				</div>

				<div class="grid gap-2 p-3">
					{#each [1, 2] as hunk (hunk)}
						<section class="border border-line" aria-label={`Diff hunk ${hunk}`}>
							<header
								class="flex min-h-7 items-center gap-2 bg-surface-raised pl-2 pr-1 font-mono text-micro text-muted">
								<span>@@ −{hunk * 8},5 +{hunk * 8},7 @@</span>
								<button
									class="icon-button ml-auto size-6!"
									type="button"
									aria-pressed={accepted.has(hunk)}
									aria-label={`${accepted.has(hunk) ? 'Undo acceptance of' : 'Accept'} hunk ${hunk}`}
									onclick={() => toggleHunk(hunk)}>
									<span
										class={accepted.has(hunk) ? 'i-tabler-check text-positive' : 'i-tabler-check'}
										aria-hidden="true"></span>
								</button>
							</header>
							<div class="bg-removed-wash px-2 py-0.5 font-mono text-micro text-text">− overflow: hidden;</div>
							<div class="bg-added-wash px-2 py-0.5 font-mono text-micro text-text">+ min-width: 0;</div>
							<div class="bg-added-wash px-2 py-0.5 font-mono text-micro text-text">+ overflow: auto;</div>
						</section>
					{/each}
				</div>
			</aside>
		</div>
	</MockApp>
</PrototypePage>
