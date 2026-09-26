<script lang="ts">
	import type { ProcessResourceSnapshot } from '../lib/types/resource-monitoring';
	import type { ExtensionUiResponse, PromptQueue, SessionWorkspace } from '../lib/types/session';
	import SessionView from '../lib/SessionView.svelte';

	let {
		workspaces,
		initialSessionId,
		resourceSnapshot
	}: { workspaces: SessionWorkspace[]; initialSessionId?: string; resourceSnapshot?: ProcessResourceSnapshot } =
		$props();

	let activeSessionId = $state<string>();
	let lastAction = $state('No action sent');

	$effect.pre(() => {
		activeSessionId ??= initialSessionId;
	});

	function send(sessionId: string, text: string, queue?: PromptQueue): void {
		lastAction = `${sessionId}: ${queue ?? 'prompt'}: ${text}`;
	}

	function respondToExtension(sessionId: string, response: ExtensionUiResponse): void {
		lastAction = `${sessionId}: extension response: ${JSON.stringify(response)}`;
	}
</script>

<SessionView
	{workspaces}
	{activeSessionId}
	{resourceSnapshot}
	onSelectSession={(sessionId) => (activeSessionId = sessionId)}
	onSend={send}
	onInterrupt={(sessionId) => {
		lastAction = `${sessionId}: interrupt`;
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
		padding: 0.4rem 0.6rem;
		color: var(--pau-text-muted);
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border);
		font: 0.6875rem var(--pau-font-ui);
	}
</style>
