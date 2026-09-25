<script lang="ts">
	import MockApp from '$lib/components/MockApp.svelte';
	import ProductRail from '$lib/components/ProductRail.svelte';
	import PrototypePage from '$lib/components/PrototypePage.svelte';

	const resources = [
		{
			id: 'github',
			name: 'GitHub',
			scope: 'User',
			detail: '26 tools',
			icon: 'i-simple-icons-github',
			state: 'connected'
		},
		{
			id: 'playwright',
			name: 'Playwright',
			scope: 'Project',
			detail: '21 tools',
			icon: 'i-simple-icons-playwright',
			state: 'connected'
		},
		{
			id: 'filesystem',
			name: 'Filesystem',
			scope: 'Workspace',
			detail: '11 tools',
			icon: 'i-tabler-folders',
			state: 'connected'
		},
		{
			id: 'postgres',
			name: 'Postgres',
			scope: 'Project',
			detail: '8 tools',
			icon: 'i-simple-icons-postgresql',
			state: 'error'
		}
	];
	let tab = $state<'MCP servers' | 'Skills' | 'Prompts'>('MCP servers');
	let selected = $state('github');
	let tested = $state(false);
	const current = $derived(resources.find((resource) => resource.id === selected) ?? resources[0]);

	function selectSection(section: string) {
		if (['MCP servers', 'Skills', 'Prompts'].includes(section)) tab = section as typeof tab;
	}
</script>

<PrototypePage
	section="V1 screen · 06"
	title="Resource browser"
	note="The list answers what is installed and where it came from. The inspector answers what it can do, which agents may use it, and what Pau will change.">
	<MockApp context="resources">
		<div class="mock-layout">
			<ProductRail active="resources" />

			<aside class="mock-context-rail" aria-label="Resource sections">
				<p class="mock-section-label">Resources</p>
				<div class="mock-list">
					{#each ['MCP servers', 'Skills', 'Prompts', 'Extensions', 'Packages'] as section (section)}
						<button type="button" aria-pressed={tab === section} onclick={() => selectSection(section)}>
							<span
								class={section === 'MCP servers'
									? 'i-tabler-plug-connected'
									: section === 'Skills'
										? 'i-tabler-sparkles'
										: section === 'Prompts'
											? 'i-tabler-file-text'
											: section === 'Extensions'
												? 'i-tabler-puzzle'
												: 'i-tabler-package'}
								aria-hidden="true"></span>
							<span>{section}</span>
							<span class="text-xs"
								>{section === 'MCP servers' ? 4 : section === 'Skills' ? 9 : section === 'Prompts' ? 6 : 3}</span>
						</button>
					{/each}
				</div>
			</aside>

			<section class="mock-main" aria-label={tab}>
				<header class="flex min-h-15 items-end justify-between gap-3 border-b border-line px-5">
					<div class="flex h-full items-end gap-1" role="tablist" aria-label="Resource types">
						{#each ['MCP servers', 'Skills', 'Prompts'] as item (item)}
							<button
								class="mock-tab"
								type="button"
								role="tab"
								aria-selected={tab === item}
								onclick={() => (tab = item as typeof tab)}>{item}</button>
						{/each}
					</div>
					<button class="app-button-primary mb-2" type="button"
						><span class="i-tabler-plus"></span>Add {tab === 'MCP servers'
							? 'server'
							: tab.slice(0, -1).toLowerCase()}</button>
				</header>

				{#if tab === 'MCP servers'}
					<div class="p-5">
						<div class="mock-list">
							{#each resources as resource (resource.id)}
								<button
									class="min-h-14!"
									type="button"
									aria-pressed={selected === resource.id}
									onclick={() => {
										selected = resource.id;
										tested = false;
									}}>
									<span class={`${resource.icon} text-lg`} aria-hidden="true"></span>
									<span
										><b class="block text-text">{resource.name}</b><small>{resource.scope} · {resource.detail}</small
										></span>
									<span class={resource.state === 'error' ? 'text-danger' : 'text-positive'}
										><span class="status-dot mr-1"></span>{resource.state}</span>
								</button>
							{/each}
						</div>
					</div>
				{:else}
					<div class="grid min-h-[28rem] place-items-center p-8 text-center">
						<div class="max-w-sm">
							<span
								class={tab === 'Skills'
									? 'i-tabler-sparkles text-3xl text-accent'
									: 'i-tabler-file-text text-3xl text-accent'}
								aria-hidden="true"></span>
							<h2 class="mb-2 mt-4 text-lg font-600">{tab} use the same browsing pattern</h2>
							<p class="m-0 text-sm text-muted">
								This state keeps the prototype focused on hierarchy. Add a dedicated fixture when editing or validation
								behavior needs design work.
							</p>
						</div>
					</div>
				{/if}
			</section>

			<aside class="mock-inspector flex flex-col" aria-label="Resource details">
				<div class="mb-5 flex items-start gap-3">
					<span class={`${current.icon} mt-1 text-xl`} aria-hidden="true"></span>
					<div>
						<strong>{current.name}</strong>
						<div class="text-xs text-muted">{current.scope} scope · stdio</div>
					</div>
				</div>
				<div class="border border-line bg-canvas p-3 mock-code text-xs leading-5">
					npx -y @modelcontextprotocol/server-{current.id}<br /><span class="text-muted">TOKEN = ••••••••</span>
				</div>
				<p class="mock-section-label mt-6">Agent access</p>
				<div class="flex flex-wrap gap-2">
					<button class="app-button border-accent!" type="button">Pi</button><button class="app-button" type="button"
						>Claude</button
					><button class="app-button" type="button" disabled>Codex</button>
				</div>
				<p class="mock-section-label mt-6">Trust</p>
				<p class="m-0 text-xs leading-5 text-muted">
					This server starts a local process and receives selected workspace context. Review its source before enabling
					it.
				</p>
				<div class="mt-auto flex items-center justify-between pt-6">
					<button class="app-button" type="button" onclick={() => (tested = true)}
						><span class="i-tabler-player-play"></span>{tested ? 'Connection works' : 'Test connection'}</button>
					<button class="border-0 bg-transparent text-xs text-danger" type="button">Remove</button>
				</div>
			</aside>
		</div>
	</MockApp>
</PrototypePage>
