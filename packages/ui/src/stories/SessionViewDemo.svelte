<script lang="ts">
	import type { ProcessResourceSnapshot } from '../lib/types/resource-monitoring';
	import type {
		CommandOption,
		ExtensionUiResponse,
		MessageQueue,
		PromptQueue,
		SessionWorkspace
	} from '../lib/types/session';
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
		commands = []
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
		/** What clearing the queue returns. */
		clearedQueue?: MessageQueue;
	} = $props();

	let activeSessionId = $state<string>();
	let lastAction = $state('No action sent');

	$effect.pre(() => {
		activeSessionId ??= initialSessionId;
	});

	function send(sessionId: string, text: string, queue?: PromptQueue): void {
		lastAction = `${sessionId}: ${queue ?? 'prompt'}: ${text}`;
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
	{workspaces}
	{activeSessionId}
	{resourceSnapshot}
	{loading}
	{disconnected}
	onStartSession={startSession}
	onSelectSession={(sessionId) => (activeSessionId = sessionId)}
	onSend={send}
	onLoadHistory={async () => history}
	onLoadCommands={async () => commands}
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
