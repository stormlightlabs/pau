<script lang="ts">
	import '../styles/tokens.css';
	import { tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';

	import { captureBay, playArrival, type BayPositions } from './bay-arrival';
	import { BusyIndicator } from './busy-indicator.svelte';
	import { withoutCodeMarks } from './code-spans';
	import {
		contextMenuRequest,
		isContextMenuKey,
		keyboardAnchor,
		type ContextMenuItem,
		type ContextMenuRequest
	} from './context-menu';
	import ContextMenu from './ContextMenu.svelte';
	import Icon from './Icon.svelte';
	import { useKeyActions } from './keymap.svelte';
	import {
		baySection,
		bayStateLine,
		displayStatus,
		markerKind,
		matchesBayFilter,
		needsOperator,
		nextAttentionSession,
		sessionMenuItems,
		sessionStatusLabel,
		type BaySection
	} from './session-bay';
	import { getSessionBayState, SessionBayState } from './session-bay-state.svelte';
	import SessionStatusMark from './SessionStatusMark.svelte';
	import type { AgentReadinessProblem } from './types/launch';
	import type {
		SavedSession,
		SavedSessionList,
		SessionAgent,
		SessionViewModel,
		SessionWorkspace
	} from './types/session';

	/**
	 * The strip bay: every session as a strip, racked into Needs you, Running
	 * and Settled under a filter and New. It fills the shell's left column in
	 * every view, so the operator always sees which sessions need them.
	 *
	 * The filter, the recent saved sessions and the Needs you order live in
	 * the {@link SessionBayState} an ancestor shares, so they survive moving
	 * between views. Actions that change the main surface, such as opening a
	 * session, go to the view through callbacks.
	 */
	type Props = {
		workspaces: SessionWorkspace[];
		/** The session open in the main surface, which its strip marks. */
		activeSessionId?: string;
		/** A stopped session with no live session behind it, listed in Settled. */
		restoredSession?: SavedSession & { workspaceId: string };
		/** Whether `restoredSession` is the one open. */
		restoredOpen?: boolean;
		disconnected?: boolean;
		/** Shows the loading state until the first session list arrives. */
		loading?: boolean;
		/** The workspace New starts in. */
		newSessionWorkspace?: SessionWorkspace;
		/** Whether a session start is in flight elsewhere, which disables New. */
		starting?: boolean;
		/** Why Claude Code cannot start, which disables its entry in the New menu. */
		claudeReadiness?: AgentReadinessProblem;
		onSelectSession: (sessionId: string) => void;
		/** Opens `restoredSession` when the operator picks its strip. */
		onOpenRestoredSession?: () => void;
		/** Starts a session. A rejection shows its message under the strips. */
		onStartSession?: (workspaceId: string, agent: SessionAgent) => void | Promise<void>;
		/** Lists a workspace's saved sessions. With `onResumeSession`, Settled lists the newest. */
		onLoadSavedSessions?: (workspaceId: string) => Promise<SavedSessionList>;
		/** Resumes a saved session from its strip. A rejection shows its message under the strips. */
		onResumeSession?: (workspaceId: string, savedSessionId: string) => void | Promise<void>;
		/** Opens the picker of a workspace's saved sessions. With it, the New menu offers Saved sessions. */
		onShowSavedSessions?: (workspaceId: string) => void;
		/** Asks for a folder to open. With it, the New menu offers Open workspace. */
		onOpenWorkspace?: () => void;
		/** Renames a session. With the `rename` capability, a strip's menu offers Rename. */
		onRenameSession?: (sessionId: string, name: string) => void | Promise<void>;
		/** Clones a session. With the `cloneSession` capability, a strip's menu offers Clone. */
		onCloneSession?: (sessionId: string) => void | Promise<void>;
		/** Stops a session. With the `stop` capability, a strip's menu offers Stop. */
		onStopSession?: (sessionId: string) => void | Promise<void>;
	};

	let {
		workspaces,
		activeSessionId,
		restoredSession,
		restoredOpen = false,
		disconnected = false,
		loading = false,
		newSessionWorkspace,
		starting = false,
		claudeReadiness,
		onSelectSession,
		onOpenRestoredSession,
		onStartSession,
		onLoadSavedSessions,
		onResumeSession,
		onShowSavedSessions,
		onOpenWorkspace,
		onRenameSession,
		onCloneSession,
		onStopSession
	}: Props = $props();

	/** How many saved sessions Settled lists per workspace. The picker lists the rest. */
	const recentSessionLimit = 3;
	const memory = getSessionBayState() ?? new SessionBayState();
	const sessionsLoading = new BusyIndicator(() => loading);
	const recentLoading = new BusyIndicator(() =>
		Object.values(memory.recent).some((recent) => recent.status === 'loading')
	);

	let bayElement = $state<HTMLElement>();
	let filterField = $state<HTMLInputElement>();
	let contextMenu = $state<ContextMenuRequest>();
	/** Why the last action from the bay failed. */
	let bayError = $state<string>();
	/** The session whose name is being edited. */
	let renamingSessionId = $state<string>();
	let renameDraft = $state('');
	/** The saved session whose resume is in flight, so no click starts a second one. */
	let resumingSavedId = $state<string>();
	/** Whether a start from this bay is in flight. */
	let startingHere = $state(false);
	const startBusy = $derived(starting || startingHere);

	const sessions = $derived(workspaces.flatMap((workspace) => workspace.sessions));

	// Each workspace loads its recent saved sessions once per bay. A list the
	// shared state already holds stays on screen while it reloads.
	const loadedHere = new SvelteSet<string>();
	$effect(() => {
		if (!onLoadSavedSessions || !onResumeSession || sessionsLoading.active) return;
		const ids = workspaces.map((workspace) => workspace.id);
		untrack(() => {
			for (const workspaceId of ids) {
				if (loadedHere.has(workspaceId)) continue;
				loadedHere.add(workspaceId);
				void loadRecent(workspaceId);
			}
		});
	});

	async function loadRecent(workspaceId: string): Promise<void> {
		if (!onLoadSavedSessions) return;
		if (memory.recent[workspaceId]?.status !== 'ready') memory.recent[workspaceId] = { status: 'loading' };
		try {
			const list = await onLoadSavedSessions(workspaceId);
			memory.recent[workspaceId] = { status: 'ready', sessions: list.sessions };
		} catch {
			memory.recent[workspaceId] = { status: 'failed' };
		}
	}

	/** The workspace's newest saved sessions that the bay does not already list. */
	function recentRows(workspace: SessionWorkspace): SavedSession[] {
		const recent = memory.recent[workspace.id];
		if (recent?.status !== 'ready') return [];
		const listed = workspace.sessions.map((session) => session.savedSessionId);
		if (restoredSession?.workspaceId === workspace.id) listed.push(restoredSession.id);
		return recent.sessions.filter((saved) => !saved.live && !listed.includes(saved.id)).slice(0, recentSessionLimit);
	}

	/** One strip: a live session, the restored session, or a saved one. */
	type BayStrip =
		| { kind: 'live'; key: string; workspace: SessionWorkspace; session: SessionViewModel }
		| { kind: 'restored'; key: string; workspace: SessionWorkspace; saved: SavedSession }
		| { kind: 'saved'; key: string; workspace: SessionWorkspace; saved: SavedSession };

	/** Every session in Needs you, whether or not the filter shows it. */
	const needsIds = $derived(sessions.filter((session) => needsOperator(session)).map((session) => session.id));

	$effect(() => {
		const present = needsIds;
		untrack(() => memory.trackNeeds(present));
	});

	/**
	 * Every strip in its rack, whether or not the filter shows it. The racks
	 * and the attention jump both read this order, so the jump visits sessions
	 * in the order the bay lists them.
	 */
	const racked = $derived.by(() => {
		const racks: Record<BaySection, BayStrip[]> = { needs: [], running: [], settled: [] };
		for (const workspace of workspaces) {
			for (const session of workspace.sessions) {
				racks[baySection(session)].push({ kind: 'live', key: session.id, workspace, session });
			}
			const restored = restoredSession?.workspaceId === workspace.id ? restoredSession : undefined;
			if (restored) racks.settled.push({ kind: 'restored', key: 'restored', workspace, saved: restored });
			for (const saved of recentRows(workspace)) {
				racks.settled.push({ kind: 'saved', key: `saved:${workspace.id}:${saved.id}`, workspace, saved });
			}
		}
		racks.needs.sort((left, right) => (memory.needsSince.get(right.key) ?? 0) - (memory.needsSince.get(left.key) ?? 0));
		return racks;
	});

	const strips = $derived({
		needs: racked.needs.filter((strip) => filterMatches(strip)),
		running: racked.running.filter((strip) => filterMatches(strip)),
		settled: racked.settled.filter((strip) => filterMatches(strip))
	});

	function filterMatches(strip: BayStrip): boolean {
		const title = strip.kind === 'live' ? strip.session.title : strip.saved.title;
		const agent = strip.kind === 'live' ? strip.session.agent : 'Pi';
		return matchesBayFilter(memory.filter, [title, agent, strip.workspace.name]);
	}

	/** Every strip in rack order. */
	const order = $derived([...strips.needs, ...strips.running, ...strips.settled]);

	/** Moves focus from one strip to the next or previous one. */
	function moveFocus(from: HTMLElement, offset: number): void {
		const all = [...(bayElement?.querySelectorAll<HTMLElement>('.session-bay__strip') ?? [])];
		all[all.indexOf(from) + offset]?.focus();
	}

	// The arrival: a session that starts needing the operator travels into
	// Needs you. A bay that mounts with sessions already there plays nothing.
	// It compares every session, not the filtered strips, so clearing the
	// filter reveals strips without replaying their arrival.
	let before: BayPositions | undefined;
	let arrived: ReadonlySet<string> = new SvelteSet<string>();
	let needsKnown: string[] | undefined;
	$effect.pre(() => {
		const needs = needsIds;
		untrack(() => {
			const fresh = needsKnown ? needs.filter((key) => !needsKnown?.includes(key)) : [];
			needsKnown = needs;
			if (!bayElement || fresh.length === 0) return;
			arrived = new SvelteSet(fresh);
			before = captureBay(bayElement);
		});
	});
	$effect(() => {
		void strips;
		untrack(() => {
			if (!before || !bayElement) return;
			playArrival(bayElement, before, arrived);
			before = undefined;
		});
	});

	/** Opens the next session that needs a look, from every session whether or not the filter shows it. */
	function jumpToAttention(): void {
		const ordered = [...racked.needs, ...racked.running, ...racked.settled]
			.filter((strip) => strip.kind === 'live')
			.map((strip) => strip.session);
		const next = nextAttentionSession(ordered, activeSessionId);
		if (!next) return;
		memory.focusRequest = next;
		onSelectSession(next);
	}

	// The jump's strip takes focus once this bay shows its session open. A bay
	// that does not mark the open session, as in views other than Sessions,
	// leaves the request to the session view's bay.
	$effect(() => {
		const id = memory.focusRequest;
		if (!id || id !== activeSessionId) return;
		untrack(() => {
			memory.focusRequest = undefined;
			bayElement?.querySelector<HTMLElement>(`#session-row-${CSS.escape(id)}`)?.focus();
		});
	});

	useKeyActions({ 'bay.filter': () => filterField?.focus(), 'session.nextAttention': jumpToAttention });

	const newUnavailable = $derived(
		disconnected ? 'Pau is reconnecting to the backend.' : startBusy ? 'A session is already starting.' : undefined
	);

	async function start(workspaceId: string, agent: SessionAgent): Promise<void> {
		if (!onStartSession || startBusy) return;
		startingHere = true;
		await act(() => onStartSession(workspaceId, agent), 'The session could not start. Try again.');
		startingHere = false;
	}

	/** Opens the New menu: the agents to start, saved sessions, and another workspace. */
	function openNewMenu(event: MouseEvent): void {
		const workspace = newSessionWorkspace;
		const invoker = event.currentTarget as HTMLElement;
		const items: ContextMenuItem[] = [];
		if (workspace && onStartSession) {
			const claudeReason = newUnavailable ?? (claudeReadiness ? withoutCodeMarks(claudeReadiness.reason) : undefined);
			items.push(
				{ id: 'new-session', label: 'New session', disabled: newUnavailable !== undefined, reason: newUnavailable },
				{
					id: 'new-claude-session',
					label: 'New Claude Code session',
					disabled: claudeReason !== undefined,
					reason: claudeReason
				}
			);
		}
		if (workspace && onShowSavedSessions) {
			items.push({
				id: 'saved',
				label: 'Saved sessions…',
				disabled: disconnected,
				reason: disconnected ? 'Pau is reconnecting to the backend.' : undefined
			});
		}
		if (onOpenWorkspace)
			items.push({ id: 'open-workspace', label: 'Open workspace…', separatorBefore: items.length > 0 });
		contextMenu = {
			label: 'New session',
			items,
			...keyboardAnchor(invoker),
			keyboard: event.detail === 0,
			invoker,
			onSelect: (id) => {
				if (id === 'open-workspace') onOpenWorkspace?.();
				else if (!workspace) return;
				else if (id === 'saved') onShowSavedSessions?.(workspace.id);
				else void start(workspace.id, id === 'new-claude-session' ? 'claude' : 'pi');
			}
		};
	}

	/** Runs a bay action and shows its failure under the strips. */
	async function act(action: () => unknown, fallback: string): Promise<void> {
		bayError = undefined;
		try {
			await action();
		} catch (cause) {
			bayError = cause instanceof Error ? cause.message : fallback;
		}
	}

	async function resume(workspaceId: string, savedSessionId: string): Promise<void> {
		if (!onResumeSession || resumingSavedId) return;
		resumingSavedId = savedSessionId;
		await act(() => onResumeSession(workspaceId, savedSessionId), 'The session could not resume. Try again.');
		resumingSavedId = undefined;
	}

	function runSessionAction(session: SessionViewModel, id: string): void {
		switch (id) {
			case 'open': {
				onSelectSession(session.id);
				break;
			}
			case 'rename': {
				rename(session.id);
				break;
			}
			case 'clone': {
				void act(() => onCloneSession?.(session.id), 'Pau could not clone the session. Try again.');
				break;
			}
			case 'copy-id': {
				void act(() => navigator.clipboard.writeText(session.id), 'Pau could not copy the session ID.');
				break;
			}
			case 'stop': {
				void act(() => onStopSession?.(session.id), 'The session could not be stopped. Try again.');
				break;
			}
		}
	}

	function openSessionMenu(event: MouseEvent | KeyboardEvent, session: SessionViewModel): void {
		const items = sessionMenuItems(session, {
			disconnected,
			rename: onRenameSession !== undefined,
			clone: onCloneSession !== undefined,
			stop: onStopSession !== undefined
		});
		contextMenu = contextMenuRequest(event, `${session.title} actions`, items, (id) => runSessionAction(session, id));
	}

	/** Opens the name of a session's strip for editing, as Rename and `/name` do. */
	export function rename(sessionId: string): void {
		const session = sessions.find((candidate) => candidate.id === sessionId);
		if (!session) return;
		bayError = undefined;
		renameDraft = session.title;
		renamingSessionId = session.id;
	}

	/** Saves the edited session name, or drops the edit when the name is blank or unchanged. */
	async function commitRename(session: SessionViewModel): Promise<void> {
		if (renamingSessionId !== session.id) return;
		renamingSessionId = undefined;
		const name = renameDraft.trim();
		await tick();
		document.getElementById(`session-row-${session.id}`)?.focus();
		if (!onRenameSession || !name || name === session.title) return;
		await act(() => onRenameSession(session.id, name), 'Pau could not rename the session. Try again.');
	}

	function cancelRename(session: SessionViewModel): void {
		renamingSessionId = undefined;
		void tick().then(() => document.getElementById(`session-row-${session.id}`)?.focus());
	}

	const markerLabel = {
		waiting: 'Waiting for your input',
		failed: 'Failed while out of view',
		unread: 'Finished while out of view'
	} as const;
</script>

{#snippet stripLine(title: string, agent: string, workspace: string)}
	<span class="pau-strip__line"
		><span class="pau-strip__name">{title}</span><span class="pau-strip__agent">{agent}</span></span>
	<span class="pau-strip__meta pau-mono">{workspace}</span>
	<span></span>
{/snippet}

{#snippet rack(section: BaySection, label: string, rackStrips: BayStrip[])}
	<section class="session-bay__rack" aria-labelledby={`bay-${section}`}>
		<h2
			class="pau-bay-heading"
			class:pau-bay-heading--attention={section === 'needs'}
			data-bay-key={`heading:${section}`}>
			<span class="pau-section-label" id={`bay-${section}`}>{label}</span><span class="pau-count"
				>{rackStrips.length}</span>
		</h2>
		<ul class="session-bay__list" class:session-bay__list--attention={section === 'needs'}>
			{#each rackStrips as strip (strip.key)}
				<li>
					{#if strip.kind === 'live'}
						{@const session = strip.session}
						{#if renamingSessionId === session.id}
							<!-- svelte-ignore a11y_autofocus -->
							<input
								class="session-bay__rename pau-field"
								aria-label="Session name"
								autofocus
								bind:value={renameDraft}
								onblur={() => void commitRename(session)}
								onkeydown={(event) => {
									if (event.key === 'Enter') {
										event.preventDefault();
										void commitRename(session);
									} else if (event.key === 'Escape') {
										event.preventDefault();
										event.stopPropagation();
										cancelRename(session);
									}
								}} />
						{:else}
							{@const line = bayStateLine(session)}
							{@const status = displayStatus(session)}
							<button
								type="button"
								id={`session-row-${session.id}`}
								class="pau-strip session-bay__strip"
								class:pau-strip--settled={section === 'settled'}
								data-bay-key={strip.key}
								title={session.title}
								aria-current={session.id === activeSessionId ? 'page' : undefined}
								onclick={() => onSelectSession(session.id)}
								oncontextmenu={(event) => openSessionMenu(event, session)}
								onkeydown={(event) => {
									if (isContextMenuKey(event)) {
										openSessionMenu(event, session);
										return;
									}
									if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
									event.preventDefault();
									moveFocus(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
								}}>
								<SessionStatusMark {status} label={sessionStatusLabel(status)} />
								{@render stripLine(session.title, session.agent, strip.workspace.name)}
								<span class={['pau-strip__state', line.tone && `pau-tone-${line.tone}`]} class:pau-mono={line.mono}
									>{line.text}</span>
								<span class="pau-strip__figure">
									{#if session.unseen && session.id !== activeSessionId}
										{@const kind = markerKind(session)}
										<span class={`session-bay__marker session-bay__marker--${kind}`} data-marker={kind}></span>
										<span class="pau-visually-hidden">{markerLabel[kind]}</span>
									{:else if needsOperator(session)}
										<span class="pau-visually-hidden">Attention required</span>
									{/if}
								</span>
							</button>
						{/if}
					{:else}
						{@const saved = strip.saved}
						{@const resuming = resumingSavedId === saved.id}
						<button
							type="button"
							id={strip.kind === 'restored' ? 'session-row-restored' : undefined}
							class="pau-strip pau-strip--settled session-bay__strip"
							data-bay-key={strip.key}
							title={saved.title}
							aria-current={restoredOpen && strip.kind === 'restored' ? 'page' : undefined}
							aria-disabled={strip.kind === 'saved' && (disconnected || resumingSavedId !== undefined)
								? 'true'
								: undefined}
							onclick={() => {
								if (strip.kind === 'restored') onOpenRestoredSession?.();
								else if (!disconnected) void resume(strip.workspace.id, saved.id);
							}}
							onkeydown={(event) => {
								if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
								event.preventDefault();
								moveFocus(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
							}}>
							<SessionStatusMark status="stopped" label="Stopped" />
							{@render stripLine(saved.title, 'Pi', strip.workspace.name)}
							<span class="pau-strip__state">{resuming ? 'Resuming…' : 'Stopped'}</span>
							<span class="pau-strip__figure"></span>
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/snippet}

<nav class="session-bay" aria-label="Sessions" bind:this={bayElement}>
	<div class="session-bay__top">
		<label class="pau-field session-bay__filter">
			<Icon name="search" size={16} />
			<input
				bind:this={filterField}
				bind:value={memory.filter}
				type="search"
				placeholder="Filter sessions"
				aria-label="Filter sessions"
				onkeydown={(event) => {
					if (memory.filter && event.key === 'Escape') {
						event.preventDefault();
						event.stopPropagation();
						memory.filter = '';
					} else if (event.key === 'ArrowDown') {
						event.preventDefault();
						bayElement?.querySelector<HTMLElement>('.session-bay__strip')?.focus();
					}
				}} />
			<kbd class="pau-kbd"><span>/</span></kbd>
		</label>
		{#if onStartSession || onOpenWorkspace || onShowSavedSessions}
			<div class="session-bay__new">
				{#if onStartSession}
					<button
						type="button"
						class="pau-button pau-button--secondary"
						disabled={!newSessionWorkspace || newUnavailable !== undefined}
						title={newSessionWorkspace
							? (newUnavailable ?? `New Pi session in ${newSessionWorkspace.name}`)
							: 'Open a workspace first'}
						onclick={() => newSessionWorkspace && void start(newSessionWorkspace.id, 'pi')}>
						<Icon name="plus" size={16} /><span class="session-bay__new-label">New</span>
					</button>
				{/if}
				<button
					type="button"
					class="pau-button pau-button--secondary pau-button--icon"
					aria-label="More ways to start a session"
					aria-haspopup="menu"
					onclick={openNewMenu}>
					<Icon name="chevronDown" size={16} />
				</button>
			</div>
		{/if}
	</div>
	<div class="session-bay__scroll">
		{#if sessionsLoading.active}
			{#if sessionsLoading.visible}<p class="session-bay__empty" role="status">Loading sessions…</p>{/if}
		{:else if workspaces.length === 0}
			<p class="session-bay__empty">No workspaces yet</p>
		{:else if order.length === 0 && memory.filter.trim()}
			<p class="session-bay__empty">No sessions match “{memory.filter.trim()}”</p>
		{:else}
			{#if order.length === 0 && Object.values(memory.recent).every((recent) => recent.status === 'ready')}
				<p class="session-bay__empty">{startBusy ? 'Starting a session…' : 'No sessions yet'}</p>
			{/if}
			{@render rack('needs', 'Needs you', strips.needs)}
			{@render rack('running', 'Running', strips.running)}
			{@render rack('settled', 'Settled', strips.settled)}
			{#if recentLoading.visible}
				<p class="session-bay__empty" role="status">Loading saved sessions…</p>
			{/if}
			{#each workspaces.filter((workspace) => memory.recent[workspace.id]?.status === 'failed') as workspace (workspace.id)}
				<div class="session-bay__failure">
					<p>Saved sessions in {workspace.name} did not load.</p>
					<button
						type="button"
						class="pau-button pau-button--secondary"
						disabled={disconnected}
						onclick={() => void loadRecent(workspace.id)}>Try again</button>
				</div>
			{/each}
		{/if}
		{#if bayError}<p class="session-bay__error" role="alert">{bayError}</p>{/if}
	</div>
	{#if contextMenu}
		{#key contextMenu}
			<ContextMenu request={contextMenu} onClose={() => (contextMenu = undefined)} />
		{/key}
	{/if}
</nav>

<style>
	/*
	 * The strip bay: a filter and New on its 48px top bar, then the racks.
	 * Needs you sits one step lifted on the raised surface and holds the only
	 * full-contrast names. Running and Settled recede through color and
	 * weight, never opacity, so their text keeps its contrast on the bay.
	 */
	.session-bay {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.session-bay__top {
		display: flex;
		flex: none;
		align-items: center;
		gap: var(--pau-space-2);
		height: var(--pau-size-header);
		padding-inline: var(--pau-shell-inset, var(--pau-space-4));
		border-bottom: 1px solid var(--pau-border);
	}

	.session-bay__filter {
		flex: 1;
	}

	.session-bay__new {
		display: flex;
		flex: none;
	}

	.session-bay__new > :first-child:not(:last-child) {
		border-start-end-radius: 0;
		border-end-end-radius: 0;
	}

	.session-bay__new > :last-child:not(:first-child) {
		margin-inline-start: -1px;
		border-start-start-radius: 0;
		border-end-start-radius: 0;
	}

	.session-bay__scroll {
		flex: 1;
		min-height: 0;
		padding-bottom: var(--pau-space-4);
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.session-bay__list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.session-bay__strip {
		width: 100%;
	}

	.session-bay__list:not(.session-bay__list--attention) :global(.pau-strip__name) {
		color: var(--pau-text-muted);
	}

	.session-bay__list :global(.pau-strip:is(:hover, [aria-current='page'])) :global(.pau-strip__name) {
		color: var(--pau-text);
	}

	.session-bay__list--attention > li + li {
		border-top: 1px solid var(--pau-surface);
	}

	.session-bay__list--attention .session-bay__strip:not([aria-current='page']) {
		background-color: var(--pau-surface-raised);
	}

	@media (hover: hover) {
		.session-bay__list--attention .session-bay__strip:not([aria-current='page']):hover {
			background-color: var(--pau-surface-selected);
		}
	}

	/* Unseen work in a session out of view: a dot in the figure column. */
	.session-bay__marker {
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		background-color: var(--pau-text-muted);
		border-radius: 50%;
	}

	.session-bay__marker--waiting {
		background-color: var(--pau-accent);
	}

	.session-bay__marker--failed {
		background-color: var(--pau-danger);
	}

	.session-bay__empty,
	.session-bay__error {
		margin: 0;
		padding: var(--pau-space-4) var(--pau-space-4) 0;
		color: var(--pau-text-muted);
		line-height: var(--pau-leading-prose);
	}

	.session-bay__error {
		color: var(--pau-danger);
	}

	.session-bay__failure {
		display: grid;
		justify-items: start;
		gap: var(--pau-space-2);
		padding: var(--pau-space-4) var(--pau-space-4) 0;
	}

	.session-bay__failure p {
		margin: 0;
		color: var(--pau-text-muted);
	}

	.session-bay__rename {
		width: calc(100% - 2 * var(--pau-space-4));
		margin: var(--pau-space-3) var(--pau-space-4);
	}

	/* New in the narrow bay drops to its icon below 1200px. */
	@media (max-width: 1199.98px) {
		.session-bay__new > :first-child {
			width: var(--pau-size-row-md);
			padding: 0;
		}

		.session-bay__new-label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}
</style>
