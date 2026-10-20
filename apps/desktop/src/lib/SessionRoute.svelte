<script lang="ts">
	import { SessionView, type ShellNavItem } from '@stormlightlabs/pau-ui';
	import { getContext, onMount } from 'svelte';

	import type { EventSocketFactory } from './event-stream';
	import { searchFileMentions } from './file-mentions';
	import { LiveSessions } from './live-sessions.svelte';
	import { interfacePreferences } from './interface-preferences.svelte';
	import { desktopNativeCapabilitiesContext, type DesktopNativeCapabilities } from './native-capabilities';
	import { agentReadinessContext, type AgentReadinessSource } from './startup';

	let {
		initialSessionId,
		onSessionChange,
		fetcher,
		socketFactory,
		navigation,
		onOpenTerminal
	}: {
		initialSessionId?: string;
		/** Builds the product rail for the workspace the operator is working in. */
		navigation?: (workspaceId: string | undefined) => ShellNavItem[];
		onSessionChange?: (workspaceId: string, sessionId: string) => void;
		/** Opens the terminal view of a workspace. */
		onOpenTerminal?: (workspaceId: string) => void;
		fetcher?: typeof fetch;
		socketFactory?: EventSocketFactory;
	} = $props();

	// The route mounts once per navigation, so the transport options are fixed
	// for the life of the store.
	// svelte-ignore state_referenced_locally
	const sessions = new LiveSessions({ browserOrigin: location.origin, fetcher, socketFactory });
	// svelte-ignore state_referenced_locally
	let selectedSessionId = $state(initialSessionId);

	const workspaces = $derived(sessions.workspaces);
	const activeSessionId = $derived(selectedSessionId ?? workspaces.flatMap((workspace) => workspace.sessions)[0]?.id);
	/** A workspace opened since the operator last chose a session. */
	let openedWorkspaceId = $state<string>();
	/** The workspace that the rail's workspace views open. */
	const currentWorkspaceId = $derived(
		openedWorkspaceId ??
			workspaces.find((workspace) => workspace.sessions.some((session) => session.id === activeSessionId))?.id ??
			workspaces[0]?.id
	);
	const native = getContext<DesktopNativeCapabilities | undefined>(desktopNativeCapabilitiesContext);
	/** Absent in the browser development server, which has no launch check. */
	const agentReadiness = getContext<AgentReadinessSource | undefined>(agentReadinessContext);

	$effect(() => sessions.view(activeSessionId));

	onMount(() => {
		sessions.connect();
		return () => sessions.close();
	});

	function selectSession(sessionId: string): void {
		selectedSessionId = sessionId;
		openedWorkspaceId = undefined;
		const workspace = workspaces.find((candidate) => candidate.sessions.some((session) => session.id === sessionId));
		if (workspace) onSessionChange?.(workspace.id, sessionId);
	}

	async function startSession(workspaceId: string): Promise<void> {
		const sessionId = await sessions.start(workspaceId);
		selectedSessionId = sessionId;
		openedWorkspaceId = undefined;
		onSessionChange?.(workspaceId, sessionId);
	}

	async function openWorkspace(path: string): Promise<string> {
		const workspaceId = await sessions.open(path);
		openedWorkspaceId = workspaceId;
		return workspaceId;
	}

	async function resumeSession(workspaceId: string, savedSessionId: string): Promise<void> {
		const sessionId = await sessions.resume(workspaceId, savedSessionId);
		selectedSessionId = sessionId;
		openedWorkspaceId = undefined;
		onSessionChange?.(workspaceId, sessionId);
	}

	async function restartSession(endedSessionId: string): Promise<void> {
		const workspace = workspaces.find((candidate) =>
			candidate.sessions.some((session) => session.id === endedSessionId)
		);
		const sessionId = await sessions.restart(endedSessionId);
		selectedSessionId = sessionId;
		openedWorkspaceId = undefined;
		if (workspace) onSessionChange?.(workspace.id, sessionId);
	}
</script>

<SessionView
	{workspaces}
	{activeSessionId}
	loading={sessions.loading}
	disconnected={sessions.disconnected}
	productItems={navigation?.(currentWorkspaceId)}
	paneWidths={interfacePreferences.widths}
	onPaneResize={(widths) => interfacePreferences.resize(widths)}
	pickFolder={native?.pickFolder}
	revealPath={native?.revealPath}
	{onOpenTerminal}
	agentReadiness={agentReadiness?.()}
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
	onSearchFiles={searchFileMentions}
	onLoadModels={(sessionId) => sessions.listModels(sessionId)}
	onSelectModel={(sessionId, model) => sessions.selectModel(sessionId, model)}
	onSelectThinkingLevel={(sessionId, level) => sessions.selectThinkingLevel(sessionId, level)}
	onSend={(sessionId, text, queue, images) => sessions.send(sessionId, text, queue, images)}
	onLoadHistory={(sessionId) => sessions.history(sessionId)}
	onInterrupt={async (sessionId) => {
		await sessions.interrupt(sessionId);
	}}
	onRetry={(sessionId) => sessions.retry(sessionId)}
	onCompact={(sessionId, instructions) => sessions.compact(sessionId, instructions)}
	onClearQueue={(sessionId) => sessions.clearQueue(sessionId)}
	onCancelRetry={(sessionId) => sessions.cancelRetry(sessionId)}
	onStop={(sessionId) => sessions.stop(sessionId)}
	onExtensionUiResponse={(sessionId, response) => sessions.respond(sessionId, response)}
	onExtensionUiTimeout={(sessionId, requestId) => sessions.expire(sessionId, requestId)} />
