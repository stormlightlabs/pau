<script lang="ts">
	import '../styles/tokens.css';

	import type { ThemeName, UiFontName } from '../theme';
	import ApplicationShell, { type ShellNavItem, type ShellPaneWidths } from './ApplicationShell.svelte';
	import TerminalPanel, { terminalFailed, terminalStatus, type TerminalTabState } from './TerminalPanel.svelte';
	import type { TerminalFileLinks, TerminalSource } from './types/terminal';

	type Props = {
		source: TerminalSource;
		theme?: ThemeName;
		uiFont?: UiFontName;
		disconnected?: boolean;
		/** Turns workspace file paths in terminal output into links. */
		fileLinks?: TerminalFileLinks;
		/** Moves the terminals to the dock under the session. Without it, the view offers no move. */
		onMoveToDock?: () => void;
		/** Product rail destinations, supplied by the app that owns the routes. */
		productItems?: ShellNavItem[];
		/** Saved widths for the resizable panes. */
		paneWidths?: ShellPaneWidths;
		/** Called with the new widths after the operator resizes a pane. */
		onPaneResize?: (widths: ShellPaneWidths) => void;
	};

	const defaultProductItems: ShellNavItem[] = [
		{ id: 'sessions', label: 'Sessions', icon: 'agents' },
		{ id: 'files', label: 'Files', icon: 'files' },
		{ id: 'terminal', label: 'Terminal', icon: 'terminal', active: true },
		{ id: 'resources', label: 'Resources', icon: 'resources' },
		{ id: 'settings', label: 'Settings', icon: 'settings' }
	];

	let {
		source,
		theme = 'eldritch',
		uiFont = 'overpass',
		disconnected = false,
		fileLinks,
		onMoveToDock,
		productItems = defaultProductItems,
		paneWidths,
		onPaneResize
	}: Props = $props();

	let tabs = $state<TerminalTabState[]>([]);
	let activeId = $state<string>();
	/** The panel lists the open terminals once it mounts; the rail stays blank until then. */
	let listed = $state(false);
</script>

<ApplicationShell
	contextLabel="Terminals"
	{productItems}
	contextItems={[]}
	{disconnected}
	{theme}
	{uiFont}
	{paneWidths}
	onResize={onPaneResize}>
	{#snippet context()}
		{#if tabs.length === 0}
			{#if listed}<p class="terminal-surface__rail-empty">No terminals</p>{/if}
		{:else}
			<ul class="terminal-surface__list" aria-label="Terminal status">
				{#each tabs as tab (tab.id)}
					<li>
						<button
							type="button"
							class="pau-row"
							class:active={tab.id === activeId}
							aria-current={tab.id === activeId ? 'true' : undefined}
							onclick={() => (activeId = tab.id)}>
							<span
								class={['terminal-surface__dot', tab.state, { failed: terminalFailed(tab), activity: tab.activity }]}
								aria-hidden="true"></span>
							<span class="terminal-surface__title">{tab.title}</span>
							<small class:activity={tab.activity && tab.state === 'running'}>{terminalStatus(tab)}</small>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	{/snippet}

	<div class="terminal-surface">
		<TerminalPanel
			{source}
			{theme}
			{disconnected}
			{fileLinks}
			onMove={onMoveToDock}
			onlisted={() => (listed = true)}
			bind:tabs
			bind:activeId />
	</div>
</ApplicationShell>

<style>
	.terminal-surface {
		height: calc(100% + 2 * var(--pau-shell-padding));
		margin: calc(-1 * var(--pau-shell-padding));
	}

	.terminal-surface__list button {
		border: 0;
		font: inherit;
		cursor: pointer;
	}

	.terminal-surface__list button:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset-inset);
	}

	.terminal-surface__rail-empty {
		margin: 0;
		padding: var(--pau-space-3) var(--pau-space-4);
		color: var(--pau-text-muted);
	}

	.terminal-surface__list {
		margin: 0;
		padding: var(--pau-space-1) 0;
		list-style: none;
	}

	.terminal-surface__list button {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--pau-space-2);
		width: 100%;
		min-height: var(--pau-space-7);
		padding: var(--pau-space-1) var(--pau-space-3);
		text-align: left;
		box-shadow: inset 2px 0 0 transparent;
	}

	.terminal-surface__list button.active {
		color: var(--pau-text);
		background-color: var(--pau-surface);
		box-shadow: inset 2px 0 0 var(--pau-accent);
	}

	.terminal-surface__title {
		overflow: hidden;
		font-family: var(--pau-font-code);
		font-variant-ligatures: none;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.terminal-surface__list small {
		font-size: var(--pau-type-xs);
	}

	.terminal-surface__dot {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--pau-success);
	}

	/* A ring sets new output apart from a running dot in themes whose accent and success colors match. */
	.terminal-surface__dot.activity {
		background: var(--pau-accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--pau-accent) 35%, transparent);
	}

	.terminal-surface__list small.activity {
		color: var(--pau-accent);
	}

	.terminal-surface__dot.exited {
		background: var(--pau-text-muted);
	}

	.terminal-surface__dot.failed {
		background: var(--pau-danger);
	}
</style>
