<script lang="ts" module>
	import type { SandboxProfile } from './types/sandbox';
	import type { TerminalExit, TerminalTab } from './types/terminal';

	const PROFILE_LABELS: Record<SandboxProfile, string> = {
		'workspace-write': 'Workspace write',
		'read-only': 'Read only'
	};

	/** A tab's lifecycle as reported by its connection. */
	export type TerminalTabState = TerminalTab & {
		state: 'running' | 'exited' | 'disconnected';
		exit?: TerminalExit;
		hasSelection: boolean;
		/** Whether output arrived while another tab was showing. Showing the tab clears it. */
		activity: boolean;
	};

	/** Whether the tab ended in a way that needs attention. A clean exit does not. */
	export function terminalFailed(tab: TerminalTabState): boolean {
		return tab.state === 'disconnected' || Boolean(tab.exit?.signal) || (tab.exit?.exitCode ?? 0) !== 0;
	}

	/** Describes a tab's state in words, so the dot that marks it is never the only cue. */
	export function terminalStatus(tab: TerminalTabState): string {
		if (tab.state === 'disconnected') return 'Disconnected';
		if (tab.state === 'exited')
			return tab.exit?.signal ? `Ended by ${tab.exit.signal}` : `Exited with code ${tab.exit?.exitCode ?? 0}`;
		return tab.activity ? 'New output' : 'Running';
	}
</script>

<script lang="ts">
	import '../styles/tokens.css';
	import { onMount } from 'svelte';

	import type { ThemeName } from '../theme';
	import EmptyState from './EmptyState.svelte';
	import Icon from './Icon.svelte';
	import TerminalView from './TerminalView.svelte';
	import type { TerminalFileLinks, TerminalSandboxChoice, TerminalSource } from './types/terminal';

	type Props = {
		source: TerminalSource;
		theme?: ThemeName;
		disconnected?: boolean;
		/** Where the terminals sit: the whole main surface, or a dock below other content. */
		layout?: 'main' | 'dock';
		/** Turns workspace file paths in terminal output into links. */
		fileLinks?: TerminalFileLinks;
		/** Moves the terminals to the other layout. Without it, the panel offers no move. */
		onMove?: () => void;
		/** Hides the dock. Only the dock layout offers it. */
		onHide?: () => void;
		/** Called once the terminals left open by an earlier view have been listed. */
		onlisted?: () => void;
		/** Open terminals, kept by the panel. Bind to read them, as the terminal rail does. */
		tabs?: TerminalTabState[];
		/** The tab on show. Bind to change it from outside the tab bar. */
		activeId?: string;
	};

	let {
		source,
		theme = 'eldritch',
		disconnected = false,
		layout = 'main',
		fileLinks,
		onMove,
		onHide,
		onlisted,
		tabs = $bindable([]),
		activeId = $bindable()
	}: Props = $props();

	let creating = $state(false);
	/** True until the terminals left open by an earlier view have been listed. */
	let restoring = $state(true);
	let error = $state('');
	let views: Record<string, TerminalView | undefined> = $state({});
	let activeTab = $derived(tabs.find((tab) => tab.id === activeId));
	let sandbox = $state<TerminalSandboxChoice>();
	/** Why the last sandboxed terminal failed to start. The profile stays unavailable after it. */
	let sandboxFailure = $state('');
	/** Why a sandboxed terminal cannot open now, or an empty string when it can. */
	let sandboxBlocked = $derived(
		!sandbox
			? 'Checking the sandbox profile.'
			: sandboxFailure ||
					sandbox.unavailable ||
					(sandbox.profile ? '' : 'This workspace has no sandbox profile. Choose one in its sandbox settings.')
	);

	$effect(() => {
		if (activeTab?.activity) activeTab.activity = false;
	});

	function message(cause: unknown): string {
		return cause instanceof Error ? cause.message : String(cause);
	}

	function update(id: string, change: Partial<TerminalTabState>): void {
		const tab = tabs.find((candidate) => candidate.id === id);
		if (tab) Object.assign(tab, change);
	}

	function opened(tab: TerminalTab): TerminalTabState {
		return { ...tab, state: 'running', hasSelection: false, activity: false };
	}

	/**
	 * Reattaches the terminals that outlived an earlier view, such as one left
	 * by a route change or by moving between the main area and the dock. They
	 * keep running on the server, so their tabs come back ahead of any opened
	 * since.
	 */
	async function restoreTerminals(): Promise<void> {
		try {
			const open = await source.list();
			const restored = open.filter((tab) => tabs.every((candidate) => candidate.id !== tab.id));
			tabs.unshift(...restored.map((tab) => opened(tab)));
			activeId ??= tabs[0]?.id;
		} catch (cause) {
			error = `Could not reopen your terminals. ${message(cause)}`;
		} finally {
			restoring = false;
			onlisted?.();
		}
	}

	/** Counts profile reads, so a slow earlier read cannot replace a newer one. */
	let sandboxReads = 0;

	async function loadSandbox(): Promise<void> {
		if (!source.sandbox) return;
		const read = ++sandboxReads;
		let choice: TerminalSandboxChoice;
		try {
			choice = await source.sandbox();
		} catch (cause) {
			choice = { profile: null, unavailable: `Could not read the sandbox profile. ${message(cause)}` };
		}
		if (read === sandboxReads) sandbox = choice;
	}

	onMount(() => {
		void restoreTerminals();
		void loadSandbox();
		// A new selection may make a sandboxed terminal possible again.
		return source.watchSandbox?.(() => {
			sandboxFailure = '';
			void loadSandbox();
		});
	});

	/** Opens a terminal. A sandboxed one that fails never falls back to normal access. */
	async function openTerminal(sandboxed = false): Promise<void> {
		creating = true;
		error = '';
		try {
			const tab = await source.create(sandboxed ? { sandboxed } : undefined);
			tabs.push(opened(tab));
			activeId = tab.id;
		} catch (cause) {
			if (sandboxed) {
				sandboxFailure = message(cause);
				error = `Could not open a sandboxed terminal. ${sandboxFailure}`;
			} else {
				error = `Could not open a terminal. ${message(cause)}`;
			}
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

<section class={['terminal-panel', `terminal-panel--${layout}`]} aria-label="Terminal">
	<div class="terminal-panel__bar">
		<div class="terminal-panel__tabs" role="tablist" aria-label="Open terminals">
			{#each tabs as tab, index (tab.id)}
				<button
					type="button"
					role="tab"
					class={['terminal-panel__tab', 'pau-row', { active: tab.id === activeId }]}
					id={`terminal-tab-${tab.id}`}
					aria-selected={tab.id === activeId}
					aria-controls={`terminal-panel-${tab.id}`}
					tabindex={tab.id === activeId ? 0 : -1}
					onclick={() => (activeId = tab.id)}
					onkeydown={(event) => handleTabKey(event, index)}>
					<Icon name={tab.sandbox ? 'sandbox' : 'terminal'} size={14} />
					<span>{tab.title}</span>
					{#if tab.sandbox}
						<small class="terminal-panel__badge" title={`Sandboxed: ${PROFILE_LABELS[tab.sandbox]}`}>
							<span class="pau-visually-hidden">Sandboxed:</span>
							{PROFILE_LABELS[tab.sandbox].toLowerCase()}
						</small>
					{/if}
					{#if tab.state !== 'running'}
						<small class={['terminal-panel__badge', { failed: terminalFailed(tab) }]}>
							{tab.state === 'disconnected' ? 'offline' : tab.exit?.signal || `exit ${tab.exit?.exitCode}`}
						</small>
					{:else if tab.activity}
						<span class="terminal-panel__activity" title="New output">
							<span class="pau-visually-hidden">New output</span>
						</span>
					{/if}
				</button>
			{/each}
		</div>
		<button
			type="button"
			class="terminal-panel__icon-button pau-utility-button"
			aria-label="New terminal"
			disabled={creating || restoring || disconnected}
			onclick={() => void openTerminal()}>
			<Icon name="plus" size={16} />
		</button>
		{#if source.sandbox}
			{@const label = sandbox?.profile
				? `New sandboxed terminal (${PROFILE_LABELS[sandbox.profile]})`
				: 'New sandboxed terminal'}
			<button
				type="button"
				class="terminal-panel__icon-button pau-utility-button"
				aria-label={label}
				aria-describedby={sandboxBlocked ? 'terminal-panel-sandbox-reason' : undefined}
				title={sandboxBlocked || label}
				disabled={Boolean(sandboxBlocked) || creating || restoring || disconnected}
				onclick={() => void openTerminal(true)}>
				<Icon name="sandbox" size={16} />
			</button>
			{#if sandboxBlocked}
				<span id="terminal-panel-sandbox-reason" class="pau-visually-hidden">{sandboxBlocked}</span>
			{/if}
		{/if}
		<div class="terminal-panel__actions">
			<button
				type="button"
				class="terminal-panel__icon-button pau-utility-button"
				aria-label="Find in terminal"
				disabled={!activeTab}
				onclick={() => activeId && void views[activeId]?.openSearch()}>
				<Icon name="search" size={16} />
			</button>
			<button
				type="button"
				class="terminal-panel__icon-button pau-utility-button"
				aria-label="Copy selection"
				disabled={!activeTab?.hasSelection}
				onclick={() => void copySelection()}>
				<Icon name="copy" size={16} />
			</button>
			<button
				type="button"
				class="terminal-panel__icon-button pau-utility-button"
				aria-label="Paste"
				disabled={activeTab?.state !== 'running'}
				onclick={() => void paste()}>
				<Icon name="paste" size={16} />
			</button>
			<button
				type="button"
				class="terminal-panel__icon-button pau-utility-button"
				aria-label={activeTab ? `Close ${activeTab.title}` : 'Close terminal'}
				disabled={!activeTab}
				onclick={() => activeTab && void closeTerminal(activeTab.id)}>
				<Icon name="close" size={16} />
			</button>
			{#if onMove}
				{@const label = layout === 'main' ? 'Move to dock' : 'Move to main area'}
				<button
					type="button"
					class="terminal-panel__icon-button pau-utility-button"
					aria-label={label}
					title={label}
					onclick={onMove}>
					<Icon name={layout === 'main' ? 'dock' : 'maximize'} size={16} />
				</button>
			{/if}
			{#if layout === 'dock' && onHide}
				<button
					type="button"
					class="terminal-panel__icon-button pau-utility-button"
					aria-label="Hide terminal dock"
					title="Hide terminal dock"
					onclick={onHide}>
					<Icon name="chevronDown" size={16} />
				</button>
			{/if}
		</div>
	</div>

	{#if error}<p class="terminal-panel__error" role="alert">{error}</p>{/if}

	{#if tabs.length === 0 && !restoring}
		<EmptyState title="No terminals open">
			<p>Open a terminal to run commands in this workspace.</p>
			<button
				type="button"
				class="pau-button pau-button--primary terminal-panel__primary"
				disabled={creating || disconnected}
				onclick={() => void openTerminal()}>
				{creating ? 'Opening…' : 'Open a terminal'}
			</button>
		</EmptyState>
	{/if}

	{#each tabs as tab (tab.id)}
		<div
			class="terminal-panel__panel"
			role="tabpanel"
			id={`terminal-panel-${tab.id}`}
			aria-labelledby={`terminal-tab-${tab.id}`}
			hidden={tab.id !== activeId}>
			{#if tab.state !== 'running'}
				<p class="terminal-panel__exit" role="status">
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
				{fileLinks}
				active={tab.id === activeId}
				connect={(events) => source.connect(tab.id, events)}
				onoutput={() => tab.id !== activeId && update(tab.id, { activity: true })}
				onexit={(exit) => update(tab.id, { state: 'exited', exit })}
				ondisconnect={() => update(tab.id, { state: 'disconnected' })}
				onselectionchange={(hasSelection) => update(tab.id, { hasSelection })} />
		</div>
	{/each}
</section>

<style>
	/* The column never grows to fit the grid xterm last drew, so a narrower window can refit it. */
	.terminal-panel {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: auto auto minmax(0, 1fr);
		height: 100%;
		min-height: 0;
	}

	.terminal-panel__bar {
		display: flex;
		align-items: stretch;
		min-height: var(--pau-size-row-lg);
		border-bottom: 1px solid var(--shell-border);
		background: var(--shell-bg);
	}

	.terminal-panel__tabs {
		display: flex;
		min-width: 0;
		overflow-x: auto;
	}

	.terminal-panel__tab,
	.terminal-panel__icon-button {
		border: 0;
		font: inherit;
		cursor: pointer;
	}

	.terminal-panel__tab {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		padding: 0 var(--pau-space-3);
		border-right: 1px solid var(--shell-border);
		box-shadow: inset 0 -2px 0 transparent;
		font-family: var(--pau-font-code);
		font-variant-ligatures: none;
		font-size: var(--pau-type-xs);
		white-space: nowrap;
	}

	.terminal-panel__tab.active {
		color: var(--shell-text);
		background-color: var(--shell-surface);
		box-shadow: inset 0 -2px 0 var(--shell-accent);
	}

	.terminal-panel__badge {
		color: var(--shell-muted);
		font-size: var(--pau-type-xs);
	}

	.terminal-panel__badge.failed {
		color: var(--shell-danger);
	}

	/* The dot sits where an exit badge would, so a tab never carries both. */
	.terminal-panel__activity {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--shell-accent);
	}

	.terminal-panel__icon-button {
		display: grid;
		place-items: center;
		width: var(--pau-size-row-lg);
	}

	.terminal-panel__actions {
		display: flex;
		margin-left: auto;
		border-left: 1px solid var(--shell-border);
	}

	.terminal-panel__icon-button:disabled {
		cursor: default;
	}

	.terminal-panel button:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset-inset);
	}

	.terminal-panel__error,
	.terminal-panel__exit {
		margin: 0;
		padding: var(--pau-space-2) var(--pau-space-3);
		border-bottom: 1px solid var(--shell-border);
		font-size: var(--pau-type-xs);
	}

	.terminal-panel__error {
		color: var(--shell-danger);
	}

	.terminal-panel__exit {
		color: var(--shell-muted);
		background: var(--shell-bg);
	}

	.terminal-panel__panel {
		display: grid;
		grid-row: 3;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: auto minmax(0, 1fr);
		min-width: 0;
		min-height: 0;
	}

	.terminal-panel__panel > :global(.terminal-view) {
		grid-row: 2;
	}

	.terminal-panel__panel[hidden] {
		display: none;
	}

	.terminal-panel > :global(.empty-state) {
		grid-row: 3;
		--empty-state-inset: var(--pau-space-4);
	}

	.terminal-panel__primary {
		margin-top: var(--pau-space-3);
	}
</style>
