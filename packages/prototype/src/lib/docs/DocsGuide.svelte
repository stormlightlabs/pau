<script lang="ts">
	import { resolve } from '$app/paths';

	let copied = $state<string>();

	const agentSections = [
		{ href: resolve('/docs#sessions'), label: 'Sessions' },
		{ href: resolve('/docs#mcp'), label: 'MCP configuration' },
		{ href: resolve('/docs#extensions'), label: 'Pi extensions' }
	];
	const projectSections = [
		{ href: resolve('/docs#security'), label: 'Security' },
		{ href: resolve('/docs#architecture'), label: 'Architecture' },
		{ href: resolve('/docs#contributing'), label: 'Contributing' }
	];
	const pageSections = [
		{ href: resolve('/docs#install'), label: 'Install the workspace' },
		{ href: resolve('/docs#sessions'), label: 'Start Pau' },
		{ href: resolve('/docs#workspace'), label: 'Open a workspace' }
	];

	async function copyCommand(command: string) {
		await navigator.clipboard.writeText(command);
		copied = command;
	}
</script>

<main
	class="grid min-h-200 grid-cols-[14rem_minmax(0,46rem)_12rem] justify-center gap-[clamp(2rem,5vw,4rem)] px-[clamp(1.25rem,4vw,3rem)] pb-24 pt-12 max-xl:grid-cols-[13rem_minmax(0,46rem)] max-lg:grid-cols-1 max-md:px-4 max-md:pb-16 max-md:pt-10">
	<aside class="sticky top-4 self-start max-lg:hidden" aria-label="Guide sections">
		<label class="flex min-h-11 items-center gap-2 border border-site-line bg-site-raised px-3 text-site-muted">
			<span class="i-tabler-search" aria-hidden="true"></span><span class="sr-only">Search documentation</span><input
				class="min-w-0 flex-1 border-0 bg-transparent text-site-ink outline-none"
				type="search"
				placeholder="Search docs" /><kbd class="font-sitecode text-[0.7rem]">/</kbd>
		</label>
		<p class="mb-2 mt-6 text-[0.68rem] font-700 tracking-[0.07em] uppercase text-site-muted">Start here</p>
		<a
			class="block border-l-2 border-site-accent bg-site-deep px-3 py-1.5 text-[0.82rem] text-site-ink no-underline"
			href={resolve('/docs#install')}
			aria-current="page">Getting started</a>
		<a
			class="block border-l-2 border-transparent px-3 py-1.5 text-[0.82rem] text-site-muted no-underline"
			href={resolve('/docs#workspace')}>Workspaces and files</a>
		<p class="mb-2 mt-6 text-[0.68rem] font-700 tracking-[0.07em] uppercase text-site-muted">Agents and resources</p>
		{#each agentSections as item (item.href)}<a
				class="block border-l-2 border-transparent px-3 py-1.5 text-[0.82rem] text-site-muted no-underline"
				href={item.href}>{item.label}</a
			>{/each}
		<p class="mb-2 mt-6 text-[0.68rem] font-700 tracking-[0.07em] uppercase text-site-muted">Project</p>
		{#each projectSections as item (item.href)}<a
				class="block border-l-2 border-transparent px-3 py-1.5 text-[0.82rem] text-site-muted no-underline"
				href={item.href}>{item.label}</a
			>{/each}
	</aside>

	<article class="min-w-0">
		<p class="mb-6 mt-0 text-[0.78rem] text-site-muted">
			Documentation <span class="px-1.5 text-site-line">/</span> Start here
		</p>
		<h1 class="site-heading m-0 text-[clamp(2.6rem,6vw,4.5rem)]! leading-none text-site-ink">Getting started</h1>
		<p class="mb-8 mt-5 text-[1.15rem] leading-7 text-site-muted">
			Run Pau from the repository, check the workspace, and open the local desktop application.
		</p>

		<div
			class="docs-callout grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-l-3 border-site-focus p-4 text-[0.88rem] text-site-muted">
			<span class="i-tabler-info-circle mt-1 text-site-focus" aria-hidden="true"></span>
			<p class="m-0">
				<strong class="block text-site-ink">Current release</strong>Pau is under active development. Build it from
				source to try the available features.
			</p>
		</div>

		<h2 id="install" class="site-heading mb-3 mt-12 text-3xl text-site-ink">Install the workspace</h2>
		<p class="leading-7">Install JavaScript dependencies, then check the TypeScript and Rust workspaces.</p>
		<div class="my-5 border border-site-code-line bg-site-code text-site-code-ink">
			<div
				class="flex min-h-10 items-center justify-between border-b border-site-code-line px-3.5 font-sitecode text-[0.68rem] op-60">
				<span>Shell</span><button
					class="min-h-8 border-0 bg-transparent text-inherit"
					type="button"
					onclick={() => copyCommand('pnpm install\npnpm check\ncargo check --workspace')}
					>{copied?.startsWith('pnpm install') ? 'Copied' : 'Copy'}</button>
			</div>
			<pre class="m-0 overflow-x-auto p-4 font-sitecode text-[0.8rem] leading-7"><code
					><span class="text-site-highlight">$</span> pnpm install
<span class="text-site-highlight">$</span> pnpm check
<span class="text-site-highlight">$</span> cargo check --workspace</code></pre>
		</div>

		<h2 id="sessions" class="site-heading mb-3 mt-12 text-3xl text-site-ink">Start Pau</h2>
		<p class="leading-7">
			The desktop shell starts the same local backend used by browser development. It creates a new local API token each
			time it starts.
		</p>
		<div class="my-5 border border-site-code-line bg-site-code text-site-code-ink">
			<div
				class="flex min-h-10 items-center justify-between border-b border-site-code-line px-3.5 font-sitecode text-[0.68rem] op-60">
				<span>Shell</span><button
					class="min-h-8 border-0 bg-transparent text-inherit"
					type="button"
					onclick={() => copyCommand('pnpm --filter @stormlightlabs/pau-desktop dev')}
					>{copied?.includes('pau-desktop') ? 'Copied' : 'Copy'}</button>
			</div>
			<pre class="m-0 overflow-x-auto p-4 font-sitecode text-[0.8rem] leading-7"><code
					><span class="text-site-highlight">$</span> pnpm --filter @stormlightlabs/pau-desktop dev</code></pre>
		</div>

		<h2 id="workspace" class="site-heading mb-3 mt-12 text-3xl text-site-ink">Open a workspace</h2>
		<p class="leading-7">
			Choose a local directory or Git worktree. Pau remembers its canonical path and confines general file requests to
			that root. Hidden and ignored files stay out of the tree until you include them.
		</p>
		<div class="mt-16 flex items-center justify-between border border-site-line p-5">
			<span class="grid"
				><small class="text-site-muted">Next</small><strong class="font-heading text-[1.05rem]"
					>Workspaces and files</strong
				></span
			><span class="i-tabler-arrow-right text-site-accent" aria-hidden="true"></span>
		</div>
	</article>

	<aside class="sticky top-4 self-start max-xl:hidden" aria-label="On this page">
		<p class="mb-2 mt-6 text-[0.68rem] font-700 tracking-[0.07em] uppercase text-site-muted">On this page</p>
		{#each pageSections as item (item.href)}<a
				class="block border-l-2 border-transparent px-3 py-1.5 text-[0.82rem] text-site-muted no-underline"
				href={item.href}>{item.label}</a
			>{/each}
	</aside>
</main>
