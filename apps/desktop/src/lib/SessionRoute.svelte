<script lang="ts">
	import { SessionView } from '@stormlightlabs/pau-ui';
	import { onMount } from 'svelte';

	import type { EventSocketFactory } from './event-stream';
	import { LiveSessions } from './live-sessions.svelte';

	let {
		search,
		initialSessionId,
		onSessionChange,
		fetcher,
		socketFactory
	}: {
		/** Query string carrying the desktop API port and token. */
		search: string;
		initialSessionId?: string;
		onSessionChange?: (workspaceId: string, sessionId: string) => void;
		fetcher?: typeof fetch;
		socketFactory?: EventSocketFactory;
	} = $props();

	// The route mounts once per navigation, so the transport options are fixed
	// for the life of the store.
	// svelte-ignore state_referenced_locally
	const sessions = new LiveSessions({ search, browserOrigin: location.origin, fetcher, socketFactory });
	// svelte-ignore state_referenced_locally
	let selectedSessionId = $state(initialSessionId);

	const workspaces = $derived(sessions.workspaces);
	const activeSessionId = $derived(selectedSessionId ?? workspaces.flatMap((workspace) => workspace.sessions)[0]?.id);

	onMount(() => {
		sessions.connect();
		return () => sessions.close();
	});

	function selectSession(sessionId: string): void {
		selectedSessionId = sessionId;
		const workspace = workspaces.find((candidate) => candidate.sessions.some((session) => session.id === sessionId));
		if (workspace) onSessionChange?.(workspace.id, sessionId);
	}

	async function startSession(workspaceId: string): Promise<void> {
		const sessionId = await sessions.start(workspaceId);
		selectedSessionId = sessionId;
		onSessionChange?.(workspaceId, sessionId);
	}

	async function resumeSession(workspaceId: string, savedSessionId: string): Promise<void> {
		const sessionId = await sessions.resume(workspaceId, savedSessionId);
		selectedSessionId = sessionId;
		onSessionChange?.(workspaceId, sessionId);
	}
</script>

<SessionView
	{workspaces}
	{activeSessionId}
	loading={sessions.loading}
	disconnected={sessions.disconnected}
	onSelectSession={selectSession}
	onStartSession={startSession}
	onLoadSavedSessions={(workspaceId) => sessions.listSaved(workspaceId)}
	onResumeSession={resumeSession}
	onLoadSessionTree={(sessionId) => sessions.tree(sessionId)}
	onBranchSession={(sessionId, entryId) => sessions.branch(sessionId, entryId)}
	onLoadCommands={(sessionId) => sessions.listCommands(sessionId)}
	onLoadModels={(sessionId) => sessions.listModels(sessionId)}
	onSelectModel={(sessionId, model) => sessions.selectModel(sessionId, model)}
	onSelectThinkingLevel={(sessionId, level) => sessions.selectThinkingLevel(sessionId, level)}
	onSend={(sessionId, text, queue) => sessions.send(sessionId, text, queue)}
	onLoadHistory={(sessionId) => sessions.history(sessionId)}
	onInterrupt={(sessionId) => sessions.interrupt(sessionId)}
	onRetry={(sessionId) => sessions.retry(sessionId)}
	onCompact={(sessionId, instructions) => sessions.compact(sessionId, instructions)}
	onClearQueue={(sessionId) => sessions.clearQueue(sessionId)}
	onCancelRetry={(sessionId) => sessions.cancelRetry(sessionId)}
	onStop={(sessionId) => sessions.stop(sessionId)}
	onExtensionUiResponse={(sessionId, response) => sessions.respond(sessionId, response)}
	onExtensionUiTimeout={(sessionId, requestId) => sessions.expire(sessionId, requestId)} />
