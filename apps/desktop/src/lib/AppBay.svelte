<script lang="ts">
	import { SessionBay } from '@stormlightlabs/pau-ui';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	import type { LiveSessions } from './live-sessions.svelte';

	/**
	 * The bay in every view other than Sessions, which renders its own. It
	 * reads the layout's live sessions, so a session that needs the operator
	 * arrives in Needs you wherever they are. Opening, starting or resuming a
	 * session goes to the session view. It reads Claude Code's readiness as
	 * it mounts, so New offers Claude Code only when it can start.
	 */
	let { sessions }: { sessions: LiveSessions } = $props();

	onMount(() => void sessions.checkClaude());

	const workspaces = $derived(sessions.workspaces);
	/** New starts in the workspace the view shows, or the first one. */
	const newSessionWorkspace = $derived(
		workspaces.find((workspace) => workspace.id === page.params.workspaceId) ?? workspaces[0]
	);

	function openSession(workspaceId: string, sessionId: string): void {
		void goto(resolve('/workspaces/[workspaceId]/sessions/[sessionId]', { workspaceId, sessionId }));
	}
</script>

<SessionBay
	{workspaces}
	{newSessionWorkspace}
	loading={sessions.loading}
	disconnected={sessions.disconnected}
	claudeReadiness={sessions.claudeReadiness}
	onSelectSession={(sessionId) => {
		const workspace = workspaces.find((candidate) => candidate.sessions.some((session) => session.id === sessionId));
		if (workspace) openSession(workspace.id, sessionId);
	}}
	onStartSession={async (workspaceId, agent) => openSession(workspaceId, await sessions.start(workspaceId, agent))}
	onLoadSavedSessions={(workspaceId) => sessions.listSaved(workspaceId)}
	onResumeSession={async (workspaceId, savedSessionId) =>
		openSession(workspaceId, await sessions.resume(workspaceId, savedSessionId))}
	onRenameSession={(sessionId, name) => sessions.rename(sessionId, name)}
	onCloneSession={(sessionId) => sessions.clone(sessionId)}
	onStopSession={(sessionId) => sessions.stop(sessionId)} />
