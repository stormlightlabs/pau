<script lang="ts">
	import '../styles/tokens.css';
	import type { ThemeName, UiFontName } from '../theme';
	import ApplicationShell, { type ShellNavItem } from './ApplicationShell.svelte';
	import Icon from './Icon.svelte';
	import TerminalView from './TerminalView.svelte';
	import type { TerminalExit, TerminalSource, TerminalTab } from './types/terminal';

	type Props = {
		workspaceName: string;
		source: TerminalSource;
		theme?: ThemeName;
		uiFont?: UiFontName;
		disconnected?: boolean;
		/** Product rail destinations, supplied by the app that owns the routes. */
		productItems?: ShellNavItem[];
	};

	const defaultProductItems: ShellNavItem[] = [
		{ id: 'sessions', label: 'Sessions', icon: 'agents' },
		{ id: 'files', label: 'Files', icon: 'files' },
		{ id: 'terminal', label: 'Terminal', icon: 'terminal', active: true },
		{ id: 'resources', label: 'Resources', icon: 'resources' },
		{ id: 'settings', label: 'Settings', icon: 'settings' }
	];

	/** A tab's lifecycle as reported by its connection. */
	type TabState = TerminalTab & {
		state: 'running' | 'exited' | 'disconnected';
		exit?: TerminalExit;
		hasSelection: boolean;
	};

	let {
		workspaceName,
		source,
		theme = 'eldritch',
		uiFont = 'inter',
		disconnected = false,
		productItems = defaultProductItems
	}: Props = $props();

	let tabs = $state<TabState[]>([]);
	let activeId = $state<string>();
	let creating = $state(false);
	let error = $state('');
	let views: Record<string, TerminalView | undefined> = $state({});
	let activeTab = $derived(tabs.find((tab) => tab.id === activeId));

	function message(cause: unknown): string {
		return cause instanceof Error ? cause.message : String(cause);
	}

	function update(id: string, change: Partial<TabState>): void {
		const tab = tabs.find((candidate) => candidate.id === id);
		if (tab) Object.assign(tab, change);
	}

	/** Whether the tab ended in a way that needs attention. A clean exit does not. */
	function failed(tab: TabState): boolean {
		return tab.state === 'disconnected' || Boolean(tab.exit?.signal) || (tab.exit?.exitCode ?? 0) !== 0;
	}

	function statusLabel(tab: TabState): string {
		if (tab.state === 'running') return 'Running';
		if (tab.state === 'disconnected') return 'Disconnected';
		if (tab.exit?.signal) return `Ended by ${tab.exit.signal}`;
		return `Exited with code ${tab.exit?.exitCode ?? 0}`;
	}

	async function openTerminal(): Promise<void> {
		creating = true;
		error = '';
		try {
			const tab = await source.create();
			tabs.push({ ...tab, state: 'running', hasSelection: false });
			activeId = tab.id;
		} catch (cause) {
			error = `Could not open a terminal. ${message(cause)}`;
		} finally {
			creating = false;
		}
	}

	async function closeTerminal(id: string): Promise<void> {
		error = '';
		try {
			await source.close(id);
		} catch (cause) {
			error = `Could not close the terminal. ${message(cause)}`;
			return;
		}
		const index = tabs.findIndex((tab) => tab.id === id);
		tabs.splice(index, 1);
		delete views[id];
		if (activeId === id) activeId = (tabs[index] ?? tabs[index - 1])?.id;
	}

	async function copySelection(): Promise<void> {
		if (!activeId) return;
		error = '';
		try {
			await views[activeId]?.copySelection();
		} catch {
			error = 'Pau could not write to the clipboard.';
		}
		views[activeId]?.focus();
	}

	async function paste(): Promise<void> {
		if (!activeId) return;
		error = '';
		try {
			await views[activeId]?.paste();
		} catch {
			error = 'Pau could not read the clipboard.';
		}
		views[activeId]?.focus();
	}

	/** Moves between tabs with the arrow, Home, and End keys. Delete closes the focused tab. */
	function handleTabKey(event: KeyboardEvent, index: number): void {
		const tab = tabs[index];
		if (tab && event.key === 'Delete') {
			event.preventDefault();
			void closeTerminal(tab.id);
			return;
		}
		const targets: Record<string, number> = {
			ArrowLeft: index - 1,
			ArrowRight: index + 1,
			Home: 0,
			End: tabs.length - 1
		};
		const target = targets[event.key];
		const next = target === undefined ? undefined : tabs[(target + tabs.length) % tabs.length];
		if (!next) return;
		event.preventDefault();
		activeId = next.id;
		document.getElementById(`terminal-tab-${next.id}`)?.focus();
	}
</script>

<ApplicationShell
	{workspaceName}
	contextLabel="Terminals"
	{productItems}
	contextItems={[]}
	{disconnected}
	{theme}
	{uiFont}
	inspectorOpen={false}>
	{#snippet context()}
		{#if tabs.length === 0}
			<p class="terminal-surface__rail-empty">No terminals</p>
		{:else}
			<ul class="terminal-surface__list" aria-label="Terminal status">
				{#each tabs as tab (tab.id)}
					<li>
						<button
							type="button"
							class:active={tab.id === activeId}
							aria-current={tab.id === activeId ? 'true' : undefined}
							onclick={() => (activeId = tab.id)}>
							<span class={['terminal-surface__dot', tab.state, { failed: failed(tab) }]} aria-hidden="true"></span>
							<span class="terminal-surface__title">{tab.title}</span>
							<small>{statusLabel(tab)}</small>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	{/snippet}

	<section class="terminal-surface" aria-label="Terminal">
		<div class="terminal-surface__bar">
			<div class="terminal-surface__tabs" role="tablist" aria-label="Open terminals">
				{#each tabs as tab, index (tab.id)}
					<button
						type="button"
						role="tab"
						class={['terminal-surface__tab', { active: tab.id === activeId }]}
						id={`terminal-tab-${tab.id}`}
						aria-selected={tab.id === activeId}
						aria-controls={`terminal-panel-${tab.id}`}
						tabindex={tab.id === activeId ? 0 : -1}
						onclick={() => (activeId = tab.id)}
						onkeydown={(event) => handleTabKey(event, index)}>
						<Icon name="terminal" size={14} />
						<span>{tab.title}</span>
						{#if tab.state !== 'running'}
							<small class={['terminal-surface__badge', { failed: failed(tab) }]}>
								{tab.state === 'disconnected' ? 'offline' : tab.exit?.signal || `exit ${tab.exit?.exitCode}`}
							</small>
						{/if}
					</button>
				{/each}
			</div>
			<button
				type="button"
				class="terminal-surface__icon-button"
				aria-label="New terminal"
				disabled={creating || disconnected}
				onclick={() => void openTerminal()}>
				<Icon name="plus" size={16} />
			</button>
			<div class="terminal-surface__actions">
				<button
					type="button"
					class="terminal-surface__icon-button"
					aria-label="Copy selection"
					disabled={!activeTab?.hasSelection}
					onclick={() => void copySelection()}>
					<Icon name="copy" size={16} />
				</button>
				<button
					type="button"
					class="terminal-surface__icon-button"
					aria-label="Paste"
					disabled={activeTab?.state !== 'running'}
					onclick={() => void paste()}>
					<Icon name="paste" size={16} />
				</button>
				<button
					type="button"
					class="terminal-surface__icon-button"
					aria-label={activeTab ? `Close ${activeTab.title}` : 'Close terminal'}
					disabled={!activeTab}
					onclick={() => activeTab && void closeTerminal(activeTab.id)}>
					<Icon name="close" size={16} />
				</button>
			</div>
		</div>

		{#if error}<p class="terminal-surface__error" role="alert">{error}</p>{/if}

		{#if tabs.length === 0}
			<div class="terminal-surface__empty">
				<p>No terminals are open in this workspace.</p>
				<button
					type="button"
					class="terminal-surface__primary"
					disabled={creating || disconnected}
					onclick={() => void openTerminal()}>
					{creating ? 'Opening…' : 'Open a terminal'}
				</button>
			</div>
		{/if}

		{#each tabs as tab (tab.id)}
			<div
				class="terminal-surface__panel"
				role="tabpanel"
				id={`terminal-panel-${tab.id}`}
				aria-labelledby={`terminal-tab-${tab.id}`}
				hidden={tab.id !== activeId}>
				{#if tab.state !== 'running'}
					<p class="terminal-surface__exit" role="status">
						{tab.state === 'disconnected'
							? 'The connection to this terminal closed.'
							: tab.exit?.signal
								? `The process ended with ${tab.exit.signal}.`
								: `The process exited with code ${tab.exit?.exitCode}.`}
					</p>
				{/if}
				<TerminalView
					bind:this={views[tab.id]}
					label={`${tab.title} terminal`}
					{theme}
					active={tab.id === activeId}
					connect={(events) => source.connect(tab.id, events)}
					onexit={(exit) => update(tab.id, { state: 'exited', exit })}
					ondisconnect={() => update(tab.id, { state: 'disconnected' })}
					onselectionchange={(hasSelection) => update(tab.id, { hasSelection })} />
			</div>
		{/each}
	</section>
</ApplicationShell>

<style>
	.terminal-surface {
		display: grid;
		grid-template-rows: auto auto minmax(0, 1fr);
		height: calc(100% + 2 * clamp(var(--pau-space-4), 3vw, var(--pau-space-6)));
		margin: calc(-1 * clamp(var(--pau-space-4), 3vw, var(--pau-space-6)));
	}

	.terminal-surface__bar {
		display: flex;
		align-items: stretch;
		min-height: var(--pau-size-row-lg);
		border-bottom: 1px solid var(--shell-border);
		background: var(--shell-bg);
	}

	.terminal-surface__tabs {
		display: flex;
		min-width: 0;
		overflow-x: auto;
	}

	.terminal-surface__tab,
	.terminal-surface__icon-button,
	.terminal-surface__list button {
		color: var(--shell-muted);
		background: transparent;
		border: 0;
		font: inherit;
		cursor: pointer;
	}

	.terminal-surface__tab {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		padding: 0 var(--pau-space-3);
		border-right: 1px solid var(--shell-border);
		box-shadow: inset 0 -2px 0 transparent;
		font-family: var(--pau-font-code);
		font-size: var(--pau-type-xs);
		white-space: nowrap;
	}

	.terminal-surface__tab.active {
		color: var(--shell-text);
		background: var(--shell-surface);
		box-shadow: inset 0 -2px 0 var(--shell-accent);
	}

	.terminal-surface__badge {
		color: var(--shell-muted);
		font-size: var(--pau-type-xs);
	}

	.terminal-surface__badge.failed {
		color: var(--shell-danger);
	}

	.terminal-surface__icon-button {
		display: grid;
		place-items: center;
		width: var(--pau-size-row-lg);
	}

	.terminal-surface__actions {
		display: flex;
		margin-left: auto;
		border-left: 1px solid var(--shell-border);
	}

	.terminal-surface__icon-button:disabled {
		cursor: default;
		opacity: 0.45;
	}

	.terminal-surface button:hover:not(:disabled),
	.terminal-surface__list button:hover {
		color: var(--shell-text);
	}

	.terminal-surface button:focus-visible,
	.terminal-surface__list button:focus-visible {
		outline: 2px solid var(--shell-focus);
		outline-offset: -2px;
	}

	.terminal-surface__error,
	.terminal-surface__exit {
		margin: 0;
		padding: var(--pau-space-2) var(--pau-space-3);
		border-bottom: 1px solid var(--shell-border);
		font-size: var(--pau-type-xs);
	}

	.terminal-surface__error {
		color: var(--shell-danger);
	}

	.terminal-surface__exit {
		color: var(--shell-muted);
		background: var(--shell-bg);
	}

	.terminal-surface__panel {
		display: grid;
		grid-row: 3;
		grid-template-rows: auto minmax(0, 1fr);
		min-height: 0;
	}

	.terminal-surface__panel > :global(.terminal-view) {
		grid-row: 2;
	}

	.terminal-surface__panel[hidden] {
		display: none;
	}

	.terminal-surface__empty {
		grid-row: 3;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: var(--pau-space-3);
		color: var(--shell-muted);
	}

	.terminal-surface__empty p {
		margin: 0;
	}

	.terminal-surface__primary {
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-3);
		color: var(--shell-bg);
		background: var(--shell-accent);
		border: 0;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.terminal-surface__primary:disabled {
		cursor: default;
		opacity: 0.6;
	}

	.terminal-surface__rail-empty {
		margin: 0;
		padding: var(--pau-space-3) var(--pau-space-4);
		color: var(--shell-muted);
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
		min-height: var(--pau-size-row-lg);
		padding: var(--pau-space-1) var(--pau-space-3);
		text-align: left;
		box-shadow: inset 2px 0 0 transparent;
	}

	.terminal-surface__list button.active {
		color: var(--shell-text);
		background: var(--shell-surface);
		box-shadow: inset 2px 0 0 var(--shell-accent);
	}

	.terminal-surface__title {
		overflow: hidden;
		font-family: var(--pau-font-code);
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

	.terminal-surface__dot.exited {
		background: var(--shell-muted);
	}

	.terminal-surface__dot.failed {
		background: var(--shell-danger);
	}
</style>
