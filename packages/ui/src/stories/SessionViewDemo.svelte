<script lang="ts">
	import type { PromptImage } from '../lib/composer-images';
	import type { AgentReadinessProblem } from '../lib/types/launch';
	import type { ProcessResourceSnapshot } from '../lib/types/resource-monitoring';
	import type {
		CommandOption,
		ExtensionUiResponse,
		FileMention,
		MessageQueue,
		ModelOption,
		PromptQueue,
		SavedSessionList,
		SessionWorkspace,
		TranscriptEntry
	} from '../lib/types/session';
	import type { ShellNavItem } from '../lib/ApplicationShell.svelte';
	import SessionView from '../lib/SessionView.svelte';

	let {
		workspaces,
		initialSessionId,
		resourceSnapshot,
		loading = false,
		disconnected = false,
		startFailure,
		retryFailure,
		compactFailure,
		history = [],
		clearedQueue = { steering: [], followUp: [] },
		commands = [],
		files = [],
		searchFailure = false,
		sendFailure,
		holdSend = false,
		openable = false,
		pickedFolder,
		openFailure,
		replyOnSend = false,
		savedSessions,
		productItems,
		agentReadiness,
		models
	}: {
		workspaces: SessionWorkspace[];
		initialSessionId?: string;
		resourceSnapshot?: ProcessResourceSnapshot;
		loading?: boolean;
		disconnected?: boolean;
		/** When set, starting a session fails with this message. */
		startFailure?: string;
		/** When set, retrying a failed turn fails with this message. */
		retryFailure?: string;
		/** When set, compacting fails with this message. */
		compactFailure?: string;
		/** Earlier prompts the composer can recall, newest first. */
		history?: string[];
		/** Slash commands the composer can complete. */
		commands?: CommandOption[];
		/** Files the composer can mention. A query matches paths that contain it. */
		files?: FileMention[];
		/** When set, searching files fails. */
		searchFailure?: boolean;
		/** When set, sending a prompt fails with this message. */
		sendFailure?: string;
		/** Whether sends never get an answer, which leaves the prompt pending. */
		holdSend?: boolean;
		/** What clearing the queue returns. */
		clearedQueue?: MessageQueue;
		/** Whether the view offers Open workspace. */
		openable?: boolean;
		/** Why Pi cannot start a session, as launch reports it. */
		agentReadiness?: AgentReadinessProblem;
		/**
		 * What a native folder picker returns, with `null` for a cancel. Without
		 * it, the view asks for a path in a text field.
		 */
		pickedFolder?: string | null;
		/** When set, opening a workspace fails with this message. */
		openFailure?: string;
		/** Whether sending a prompt appends an assistant reply to the transcript. */
		replyOnSend?: boolean;
		/** Saved sessions each workspace lists. When set, the rail offers the saved-session picker. */
		savedSessions?: SavedSessionList;
		productItems?: ShellNavItem[];
		/** Models the session can switch to. When set, the composer offers the model and thinking pickers. */
		models?: ModelOption[];
	} = $props();

	let opened = $state<SessionWorkspace[]>([]);
	let replies = $state<TranscriptEntry[]>([]);
	const allWorkspaces = $derived(
		[...workspaces, ...opened].map((workspace) => ({
			...workspace,
			sessions: workspace.sessions.map((session) =>
				session.id === activeSessionId ? { ...session, transcript: [...session.transcript, ...replies] } : session
			)
		}))
	);

	/** Opens a folder by its last path segment, reusing a workspace with that name. */
	function openWorkspace(path: string): string {
		if (openFailure) throw new Error(openFailure);
		const name = path.split('/').findLast(Boolean) ?? path;
		const existing = allWorkspaces.find((workspace) => workspace.name === name);
		if (existing) return existing.id;
		const id = `workspace-${name}`;
		opened.push({ id, name, sessions: [] });
		lastAction = `opened ${path}`;
		return id;
	}

	let activeSessionId = $state<string>();
	let lastAction = $state('No action sent');

	$effect.pre(() => {
		activeSessionId ??= initialSessionId;
	});

	function send(
		sessionId: string,
		text: string,
		queue?: PromptQueue,
		images: PromptImage[] = []
	): Promise<void> | void {
		if (holdSend) return new Promise<void>(() => {});
		if (sendFailure) throw new Error(sendFailure);
		const attached = images.length > 0 ? ` (${images.length} image${images.length === 1 ? '' : 's'})` : '';
		lastAction = `${sessionId}: ${queue ?? 'prompt'}: ${text}${attached}`;
		if (replyOnSend) {
			replies.push({ id: `reply-${replies.length}`, kind: 'message', role: 'assistant', body: `Reply to ${text}` });
		}
	}

	function startSession(workspaceId: string): void {
		if (startFailure) throw new Error(startFailure);
		lastAction = `${workspaceId}: start session`;
	}

	function respondToExtension(sessionId: string, response: ExtensionUiResponse): void {
		lastAction = `${sessionId}: extension response: ${JSON.stringify(response)}`;
	}
</script>

<SessionView
	workspaces={allWorkspaces}
	{productItems}
	{agentReadiness}
	onOpenWorkspace={openable ? async (path) => openWorkspace(path) : undefined}
	pickFolder={pickedFolder === undefined ? undefined : async () => pickedFolder ?? undefined}
	{activeSessionId}
	{resourceSnapshot}
	{loading}
	{disconnected}
	onLoadSavedSessions={savedSessions ? async () => savedSessions : undefined}
	onResumeSession={savedSessions
		? (workspaceId, savedSessionId) => {
				lastAction = `${workspaceId}: resume ${savedSessionId}`;
			}
		: undefined}
	onStartSession={startSession}
	onSelectSession={(sessionId) => (activeSessionId = sessionId)}
	onSend={send}
	onLoadModels={models ? async () => models : undefined}
	onSelectModel={(sessionId, model) => {
		lastAction = `${sessionId}: model: ${model.id}`;
	}}
	onSelectThinkingLevel={(sessionId, level) => {
		lastAction = `${sessionId}: thinking: ${level}`;
	}}
	onLoadHistory={async () => history}
	onLoadCommands={async () => commands}
	onSearchFiles={async (_workspaceId, query) => {
		if (searchFailure) throw new Error('Search failed');
		return files.filter((file) => file.path.toLowerCase().includes(query.toLowerCase()));
	}}
	onInterrupt={(sessionId) => {
		lastAction = `${sessionId}: interrupt`;
	}}
	onRetry={(sessionId) => {
		if (retryFailure) throw new Error(retryFailure);
		lastAction = `${sessionId}: retry`;
	}}
	onCompact={(sessionId, instructions) => {
		if (compactFailure) throw new Error(compactFailure);
		lastAction = `${sessionId}: compact: ${instructions ?? 'no instructions'}`;
	}}
	onClearQueue={async (sessionId) => {
		lastAction = `${sessionId}: clear queue`;
		return clearedQueue;
	}}
	onCancelRetry={(sessionId) => {
		lastAction = `${sessionId}: cancel retry`;
	}}
	onStop={(sessionId) => {
		lastAction = `${sessionId}: stop`;
	}}
	onRenameSession={(sessionId, name) => {
		lastAction = `${sessionId}: rename: ${name}`;
	}}
	onCloneSession={(sessionId) => {
		lastAction = `${sessionId}: clone`;
	}}
	onBranchFromMessage={async (sessionId, entryId) => {
		lastAction = `${sessionId}: branch from ${entryId}`;
		return { text: 'Edited prompt', cancelled: false };
	}}
	onOpenTerminal={(workspaceId) => {
		lastAction = `${workspaceId}: open terminal`;
	}}
	revealPath={async (path) => {
		lastAction = `reveal ${path}`;
	}}
	onExtensionUiResponse={respondToExtension}
	onExtensionUiTimeout={(sessionId, requestId) => {
		lastAction = `${sessionId}: extension timeout: ${requestId}`;
	}}
	onOpenPiTerminal={(sessionId) => {
		lastAction = `${sessionId}: open Pi terminal`;
	}} />

<p class="action" aria-live="polite">{lastAction}</p>

<style>
	.action {
		position: fixed;
		right: 0.75rem;
		bottom: 0.75rem;
		z-index: 10;
		margin: 0;
		padding: var(--pau-space-2) var(--pau-space-2);
		color: var(--pau-text-muted);
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border);
		font: var(--pau-type-xs) var(--pau-font-ui);
	}
</style>
