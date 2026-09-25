<script lang="ts">
	import type { PromptQueue, SessionWorkspace } from '../lib/types/session';
	import SessionView from '../lib/SessionView.svelte';

	let { workspaces, initialSessionId }: { workspaces: SessionWorkspace[]; initialSessionId?: string } = $props();

	let activeSessionId = $state<string>();
	let lastAction = $state('No action sent');

	$effect.pre(() => {
		activeSessionId ??= initialSessionId;
	});

	function send(sessionId: string, text: string, queue?: PromptQueue): void {
		lastAction = `${sessionId}: ${queue ?? 'prompt'}: ${text}`;
	}
</script>

<SessionView
	{workspaces}
	{activeSessionId}
	onSelectSession={(sessionId) => (activeSessionId = sessionId)}
	onSend={send}
	onInterrupt={(sessionId) => {
		lastAction = `${sessionId}: interrupt`;
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
