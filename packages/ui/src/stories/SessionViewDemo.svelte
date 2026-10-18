<script lang="ts">
	import type { PromptImage } from '../lib/composer-images';
	import type { ProcessResourceSnapshot } from '../lib/types/resource-monitoring';
	import type {
		CommandOption,
		ExtensionUiResponse,
		MessageQueue,
		PromptQueue,
		SessionWorkspace
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
		sendFailure,
		openable = false,
		pickedFolder,
		openFailure,
		productItems
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
		/** When set, sending a prompt fails with this message. */
		sendFailure?: string;
		/** What clearing the queue returns. */
		clearedQueue?: MessageQueue;
		/** Whether the view offers Open workspace. */
		openable?: boolean;
		/**
		 * What a native folder picker returns, with `null` for a cancel. Without
		 * it, the view asks for a path in a text field.
		 */
		pickedFolder?: string | null;
		/** When set, opening a workspace fails with this message. */
		openFailure?: string;
		productItems?: ShellNavItem[];
	} = $props();

	let opened = $state<SessionWorkspace[]>([]);
	const allWorkspaces = $derived([...workspaces, ...opened]);

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

	function send(sessionId: string, text: string, queue?: PromptQueue, images: PromptImage[] = []): void {
		if (sendFailure) throw new Error(sendFailure);
		const attached = images.length > 0 ? ` (${images.length} image${images.length === 1 ? '' : 's'})` : '';
		lastAction = `${sessionId}: ${queue ?? 'prompt'}: ${text}${attached}`;
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
	onOpenWorkspace={openable ? async (path) => openWorkspace(path) : undefined}
	pickFolder={pickedFolder === undefined ? undefined : async () => pickedFolder ?? undefined}
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
