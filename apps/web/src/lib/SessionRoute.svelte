<script lang="ts">
	import {
		SessionView,
		type PromptQueue,
		type SessionViewModel,
		type SessionWorkspace,
		type TranscriptEntry
	} from '@stormlightlabs/pau-ui';

	let {
		initialWorkspaces,
		initialSessionId,
		disconnected = false,
		onSessionChange
	}: {
		initialWorkspaces: SessionWorkspace[];
		initialSessionId?: string;
		disconnected?: boolean;
		onSessionChange?: (workspaceId: string, sessionId: string) => void;
	} = $props();

	let workspaces = $state<SessionWorkspace[]>([]);
	let activeSessionId = $state<string>();
	let initialized = $state(false);

	$effect.pre(() => {
		if (initialized) return;
		workspaces = structuredClone(initialWorkspaces);
		activeSessionId = initialSessionId ?? workspaces.flatMap((workspace) => workspace.sessions)[0]?.id;
		initialized = true;
	});

	function updateSession(sessionId: string, update: (session: SessionViewModel) => SessionViewModel): void {
		workspaces = workspaces.map((workspace) => ({
			...workspace,
			sessions: workspace.sessions.map((session) => (session.id === sessionId ? update(session) : session))
		}));
	}

	function selectSession(sessionId: string): void {
		activeSessionId = sessionId;
		const workspace = workspaces.find((candidate) => candidate.sessions.some((session) => session.id === sessionId));
		if (workspace) onSessionChange?.(workspace.id, sessionId);
	}

	function send(sessionId: string, text: string, queue?: PromptQueue): void {
		updateSession(sessionId, (session) => {
			const entry: TranscriptEntry = {
				id: `local-${session.transcript.length}`,
				kind: 'message',
				role: 'user',
				label: queue === 'follow-up' ? 'You · follow-up' : queue === 'steer' ? 'You · steer' : 'You',
				body: text
			};
			return { ...session, status: 'running', transcript: [...session.transcript, entry] };
		});
	}

	function interrupt(sessionId: string): void {
		updateSession(sessionId, (session) => ({ ...session, status: 'idle' }));
	}

	function clearExtensionDialog(sessionId: string): void {
		updateSession(sessionId, (session) =>
			session.extensionUi ? { ...session, extensionUi: { ...session.extensionUi, dialog: undefined } } : session
		);
	}
</script>

<SessionView
	{workspaces}
	{activeSessionId}
	{disconnected}
	onSelectSession={selectSession}
	onSend={send}
	onInterrupt={interrupt}
	onExtensionUiResponse={(sessionId) => clearExtensionDialog(sessionId)}
	onExtensionUiTimeout={(sessionId) => clearExtensionDialog(sessionId)} />
