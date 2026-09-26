<script lang="ts">
	import { resolve } from '$app/paths';

	const destinations = [
		{
			href: '/screens/dashboard',
			title: 'Agentic IDE dashboard',
			description: 'Surfaces active work, decisions, changed files, checks, and harness health across workspaces.'
		},
		{
			href: '/screens/session',
			title: 'Session workspace',
			description:
				'Tests the main operating view: active work, agent output, session switching, and a review inspector.'
		},
		{
			href: '/screens/orchestration',
			title: 'Harness control',
			description:
				'Supervises concurrent Pi, Claude Code, and Codex work while keeping every handoff under operator control.'
		},
		{
			href: '/screens/scratchpad',
			title: 'Scratchpad',
			description:
				'Turns rough workspace notes into explicit prompts, reusable instructions, or private working memory.'
		},
		{
			href: '/screens/editor',
			title: 'Editor and review',
			description: 'Pairs the CodeMirror surface with focused diff review without turning the app into a general IDE.'
		},
		{
			href: '/screens/neovim',
			title: 'Embedded editor study',
			description: 'Preserves the deferred Neovim embedding study without placing it in the first-release path.'
		},
		{
			href: '/screens/terminal',
			title: 'Terminal',
			description: 'Persistent PTY terminals with tabs, search, activity state, and exit reporting.'
		},
		{
			href: '/screens/resources',
			title: 'Resource browser',
			description: 'Explores trust, scope, connection state, and agent access for MCP servers and Pi resources.'
		},
		{
			href: '/screens/settings',
			title: 'Settings',
			description: 'Makes theme, font, agent discovery, and preferred-editor choices visible without hiding their scope.'
		},
		{
			href: '/docs',
			title: 'Documentation and product site',
			description: 'Combines the public overview, reading shell, and capability reference with light and dark themes.'
		},
		{
			href: '/splash/launch',
			title: 'Launch sequence',
			description: 'A short startup state that names the service being prepared and avoids pretending work is instant.'
		},
		{
			href: '/splash/reconnect',
			title: 'Reconnect',
			description: 'Keeps a recoverable connection problem distinct from a failed agent or stopped workspace.'
		}
	] as const;
</script>

<svelte:head>
	<title>Pau living prototype</title>
	<meta
		name="description"
		content="A static design sandbox for testing Pau screens, states, and product language before implementation." />
</svelte:head>

<article class="prototype-page" data-prototype-ready>
	<header class="prototype-page__header">
		<div>
			<div class="prototype-kicker">Interface studies</div>
			<h1>Pau product surfaces</h1>
		</div>
		<p class="prototype-page__note">
			Open a fixed fixture to inspect hierarchy, density, responsive behavior, and product language without connecting
			to a live agent. Durable decisions are recorded in <code>dev/design</code>.
		</p>
	</header>

	<div class="hub-grid">
		{#each destinations as destination, index (destination.href)}
			<a class="hub-card" href={resolve(destination.href)}>
				<span class="hub-card__number">{String(index + 1).padStart(2, '0')}</span>
				<h2>{destination.title}</h2>
				<p>{destination.description}</p>
			</a>
		{/each}
	</div>
</article>
