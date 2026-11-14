<script lang="ts">
	import type { LastRoute, LastView } from '@stormlightlabs/pau-protocol';
	import {
		SessionView,
		TerminalPanel,
		type AgentReadinessProblem,
		type SavedSession,
		type SessionAgent,
		type ShellNavItem
	} from '@stormlightlabs/pau-ui';
	import { getContext, onMount, untrack } from 'svelte';

	import { getAgentReadiness, getUiPreferences } from './api';

	import type { EventSocketFactory } from './event-stream';
	import { searchFileMentions } from './file-mentions';
	import { LiveSessions } from './live-sessions.svelte';
	import { interfacePreferences } from './interface-preferences.svelte';
	import { desktopNativeCapabilitiesContext, type DesktopNativeCapabilities } from './native-capabilities';
	import { sessionAttentionContext, type SessionAttention } from './session-attention';
	import { agentReadinessContext, type AgentReadinessSource } from './startup';
	import { terminalDock } from './terminal-dock.svelte';
	import { createTerminalFileLinks } from './terminal-file-links';
	import { createTerminalSource } from './terminal-source';

	let {
		initialSessionId,
		onSessionChange,
		fetcher,
		socketFactory,
		navigation,
		onOpenTerminal,
		onOpenFile,
		restoreLastRoute = false,
		onRouteChange,
		onOpenView
	}: {
		initialSessionId?: string;
		/**
		 * Returns to the view saved in the interface preferences once the
		 * sessions load. A live session opens as it is. A session that stopped
		 * shows with a Resume action and is never resumed on its own. A saved
		 * view whose workspace or session is gone leaves the default view.
		 */
		restoreLastRoute?: boolean;
		/** Called with the session the operator is looking at, to save as the view to restore. */
		onRouteChange?: (route: LastRoute) => void;
		/** Opens a saved workspace view other than sessions. */
		onOpenView?: (view: Exclude<LastView, 'session'>, workspaceId: string) => void;
		/** Builds the product rail for the workspace the operator is working in. */
		navigation?: (workspaceId: string | undefined) => ShellNavItem[];
		onSessionChange?: (workspaceId: string, sessionId: string) => void;
		/** Opens the terminal view of a workspace. */
		onOpenTerminal?: (workspaceId: string) => void;
		/** Opens a workspace file in the editor, such as one linked from terminal output. */
		onOpenFile?: (workspaceId: string, path: string, line?: number) => void;
		fetcher?: typeof fetch;
		socketFactory?: EventSocketFactory;
	} = $props();

	// The route mounts once per navigation, so the transport options are fixed
	// for the life of the store.
	// svelte-ignore state_referenced_locally
	const sessions = new LiveSessions({ browserOrigin: location.origin, fetcher, socketFactory });
	// svelte-ignore state_referenced_locally
	let selectedSessionId = $state(initialSessionId);

	/** Whether the saved view is still being read and resolved. The view shows loading meanwhile. */
	// svelte-ignore state_referenced_locally
	let restoring = $state(restoreLastRoute);
	/** The saved view, `null` when there is none or it could not be read. Unset until read. */
	let savedRoute = $state<LastRoute | null>();
	/**
	 * The stopped session restored from the saved view. The rail keeps listing
	 * it like other stopped sessions until the operator resumes it.
	 */
	let restoredSession = $state<SavedSession & { workspaceId: string }>();
	/** Whether the restored session is the one open, rather than a live session. */
	let restoredOpen = $state(false);

	const workspaces = $derived(sessions.workspaces);
	const activeSessionId = $derived(
		restoredOpen ? undefined : (selectedSessionId ?? workspaces.flatMap((workspace) => workspace.sessions)[0]?.id)
	);
	/** A workspace opened since the operator last chose a session. */
	let openedWorkspaceId = $state<string>();
	/** The workspace that the rail's workspace views open. */
	const currentWorkspaceId = $derived(
		openedWorkspaceId ??
			(restoredOpen ? restoredSession?.workspaceId : undefined) ??
			workspaces.find((workspace) => workspace.sessions.some((session) => session.id === activeSessionId))?.id ??
			workspaces[0]?.id
	);
	/** The docked terminals of the workspace in view. A new workspace gets its own. */
	const dockTerminals = $derived.by(() => {
		const workspaceId = currentWorkspaceId;
		if (workspaceId === undefined) return;
		return {
			workspaceId,
			source: createTerminalSource(location.origin, workspaceId),
			fileLinks: onOpenFile && createTerminalFileLinks(workspaceId, (path, line) => onOpenFile(workspaceId, path, line))
		};
	});

	// Moving terminals from the main area to the dock returns to this session.
	$effect(() => {
		const workspace = workspaces.find((candidate) =>
			candidate.sessions.some((session) => session.id === activeSessionId)
		);
		if (workspace && activeSessionId) terminalDock.session = { workspaceId: workspace.id, sessionId: activeSessionId };
	});

	const native = getContext<DesktopNativeCapabilities | undefined>(desktopNativeCapabilitiesContext);
	/** Absent in the browser development server, which has no launch check. */
	const agentReadiness = getContext<AgentReadinessSource | undefined>(agentReadinessContext);

	/**
	 * Why Claude Code cannot start a session, from the backend's readiness
	 * report. Launch checks only Pi, so the route reads the report itself on
	 * mount, after a Claude Code start fails, and when the operator asks the
	 * notice to check again. Unset while the report
	 * is unread or could not be read, which leaves Claude Code available.
	 */
	let claudeReadiness = $state<AgentReadinessProblem>();

	async function checkClaude(refresh = false): Promise<void> {
		try {
			const report = await getAgentReadiness(refresh, fetcher);
			const claude = report.agents.find((agent) => agent.agent === 'claude');
			claudeReadiness =
				claude && !claude.ready && claude.reason ? { agent: 'claude', reason: claude.reason } : undefined;
		} catch {
			claudeReadiness = undefined;
		}
	}

	/** Absent in the browser development server, which has no native notifications. */
	const attention = getContext<SessionAttention | undefined>(sessionAttentionContext);

	$effect(() => sessions.view(activeSessionId));
	$effect(() => {
		const sessionId = activeSessionId;
		attention?.view(sessionId);
		return () => attention?.leave(sessionId);
	});
	$effect(() =>
		attention?.useTitles(
			(sessionId) =>
				workspaces.flatMap((workspace) => workspace.sessions).find((session) => session.id === sessionId)?.title
		)
	);

	$effect(() => {
		if (restoring) return;
		if (restoredOpen && restoredSession) {
			const route: LastRoute = {
				workspace_id: restoredSession.workspaceId,
				view: 'session',
				session_id: null,
				saved_session_id: restoredSession.id
			};
			untrack(() => onRouteChange?.(route));
			return;
		}
		if (!activeSessionId) return;
		const workspaceId = workspaces.find((workspace) =>
			workspace.sessions.some((session) => session.id === activeSessionId)
		)?.id;
		if (!workspaceId) return;
		const route: LastRoute = {
			workspace_id: workspaceId,
			view: 'session',
			session_id: activeSessionId,
			saved_session_id: sessions.savedSessionId(activeSessionId) ?? null
		};
		untrack(() => onRouteChange?.(route));
	});

	$effect(() => {
		if (savedRoute === undefined || !restoring || sessions.loading) return;
		const route = savedRoute;
		untrack(() => void restore(route));
	});

	onMount(() => {
		sessions.connect();
		void checkClaude();
		if (restoreLastRoute) void readSavedRoute();
		return () => sessions.close();
	});

	async function readSavedRoute(): Promise<void> {
		try {
			const preferences = await getUiPreferences(fetcher);
			savedRoute = preferences.last_route;
		} catch {
			savedRoute = null;
		}
	}

	/**
	 * Opens the saved view. Every failure falls back to the default view
	 * without a message: a workspace removed since, a session Pi no longer
	 * has, or a saved list that cannot be read.
	 */
	async function restore(route: LastRoute | null): Promise<void> {
		let leaving = false;
		try {
			const workspace = workspaces.find((candidate) => candidate.id === route?.workspace_id);
			if (!route || !workspace) return;
			if (route.view !== 'session') {
				if (!onOpenView) return;
				// The page navigates away, so the view keeps loading until it does.
				leaving = true;
				onOpenView(route.view, workspace.id);
				return;
			}
			const liveId =
				workspace.sessions.find((session) => session.id === route.session_id)?.id ??
				(route.saved_session_id ? sessions.liveSessionId(workspace.id, route.saved_session_id) : undefined);
			if (liveId) {
				selectSession(liveId);
				return;
			}
			if (!route.saved_session_id) return;
			const list = await sessions.listSaved(workspace.id);
			const saved = list.sessions.find((candidate) => candidate.id === route.saved_session_id);
			if (!saved) return;
			restoredSession = { ...saved, workspaceId: workspace.id };
			restoredOpen = true;
		} catch {
			// The default view is the fallback.
		} finally {
			if (!leaving) restoring = false;
		}
	}

	function selectSession(sessionId: string): void {
		restoredOpen = false;
		selectedSessionId = sessionId;
		openedWorkspaceId = undefined;
		const workspace = workspaces.find((candidate) => candidate.sessions.some((session) => session.id === sessionId));
		if (workspace) onSessionChange?.(workspace.id, sessionId);
	}

	async function startSession(workspaceId: string, agent: SessionAgent): Promise<void> {
		let sessionId: string;
		try {
			sessionId = await sessions.start(workspaceId, agent);
		} catch (cause) {
			if (agent === 'claude') void checkClaude(true);
			throw cause;
		}
		restoredOpen = false;
		selectedSessionId = sessionId;
		openedWorkspaceId = undefined;
		onSessionChange?.(workspaceId, sessionId);
	}

	async function openWorkspace(path: string): Promise<string> {
		const workspaceId = await sessions.open(path);
		restoredOpen = false;
		openedWorkspaceId = workspaceId;
		return workspaceId;
	}

	async function resumeSession(workspaceId: string, savedSessionId: string): Promise<void> {
		const sessionId = await sessions.resume(workspaceId, savedSessionId);
		// The live session takes the restored row's place once it runs the same conversation.
		if (restoredSession?.id === savedSessionId) restoredSession = undefined;
		restoredOpen = false;
		selectedSessionId = sessionId;
		openedWorkspaceId = undefined;
		onSessionChange?.(workspaceId, sessionId);
	}

	async function restartSession(endedSessionId: string): Promise<void> {
		const workspace = workspaces.find((candidate) =>
			candidate.sessions.some((session) => session.id === endedSessionId)
		);
		const sessionId = await sessions.restart(endedSessionId);
		restoredOpen = false;
		selectedSessionId = sessionId;
		openedWorkspaceId = undefined;
		if (workspace) onSessionChange?.(workspace.id, sessionId);
	}
</script>

{#snippet terminals()}
	{#if dockTerminals}
		{#key dockTerminals}
			<TerminalPanel
				layout="dock"
				theme={interfacePreferences.choices.theme}
				disconnected={sessions.disconnected}
				source={dockTerminals.source}
				fileLinks={dockTerminals.fileLinks}
				onMove={onOpenTerminal &&
					(() => {
						terminalDock.open = false;
						onOpenTerminal(dockTerminals.workspaceId);
					})}
				onHide={() => (terminalDock.open = false)} />
		{/key}
	{/if}
{/snippet}

<SessionView
	dock={dockTerminals ? terminals : undefined}
	dockOpen={terminalDock.open}
	onDockToggle={(open) => (terminalDock.open = open)}
	dockHeight={terminalDock.height}
	onDockResize={(height) => (terminalDock.height = height)}
	theme={interfacePreferences.choices.theme}
	uiFont={interfacePreferences.choices.ui_font}
	{workspaces}
	{activeSessionId}
	loading={sessions.loading || restoring}
	{restoredSession}
	onOpenRestoredSession={() => (restoredOpen = true)}
	disconnected={sessions.disconnected}
	productItems={navigation?.(currentWorkspaceId)}
	paneWidths={interfacePreferences.widths}
	onPaneResize={(widths) => interfacePreferences.resize(widths)}
	pickFolder={native?.pickFolder}
	revealPath={native?.revealPath}
	{onOpenTerminal}
	agentReadiness={agentReadiness?.()}
	{claudeReadiness}
	onCheckClaude={() => checkClaude(true)}
	onOpenWorkspace={openWorkspace}
	onSelectSession={selectSession}
	onClearAttention={() => sessions.clearUnseen()}
	onStartSession={startSession}
	onLoadSavedSessions={(workspaceId) => sessions.listSaved(workspaceId)}
	onResumeSession={resumeSession}
	onRestartSession={restartSession}
	onLoadSessionTree={(sessionId) => sessions.tree(sessionId)}
	onSearchSession={(sessionId, query) => sessions.search(sessionId, query)}
	onBranchSession={(sessionId, entryId) => sessions.branch(sessionId, entryId)}
	onBranchFromMessage={(sessionId, entryId) => sessions.branchFromMessage(sessionId, entryId)}
	onRenameSession={(sessionId, name) => sessions.rename(sessionId, name)}
	onCloneSession={(sessionId) => sessions.clone(sessionId)}
	onLoadCommands={(sessionId) => sessions.listCommands(sessionId)}
	onSearchFiles={(workspaceId, query, signal) => searchFileMentions(workspaceId, query, signal, fetcher)}
	onLoadModels={(sessionId) => sessions.listModels(sessionId)}
	onSelectModel={(sessionId, model) => sessions.selectModel(sessionId, model)}
	onSelectThinkingLevel={(sessionId, level) => sessions.selectThinkingLevel(sessionId, level)}
	onSend={(sessionId, text, queue, images) => sessions.send(sessionId, text, queue, images)}
	onLoadHistory={(sessionId) => sessions.history(sessionId)}
	onInterrupt={(sessionId) => sessions.interrupt(sessionId)}
	onRunShellCommand={(sessionId, command, excludeFromContext) =>
		sessions.runShellCommand(sessionId, command, excludeFromContext)}
	onStopShellCommands={(sessionId) => sessions.stopShellCommands(sessionId)}
	onRetry={(sessionId) => sessions.retry(sessionId)}
	onCompact={(sessionId, instructions) => sessions.compact(sessionId, instructions)}
	onClearQueue={(sessionId) => sessions.clearQueue(sessionId)}
	onCancelRetry={(sessionId) => sessions.cancelRetry(sessionId)}
	onStop={(sessionId) => sessions.stop(sessionId)}
	onExtensionUiResponse={(sessionId, response) => sessions.respond(sessionId, response)}
	onExtensionUiTimeout={(sessionId, requestId) => sessions.expire(sessionId, requestId)} />
