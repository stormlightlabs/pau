<!--
@component
Tells the operator why an agent cannot start a session. For Pi it gives the
command that fixes it. Pau cannot type into a terminal for the operator, so it
shows the command with a copy button and opens a terminal where they can run
it. Claude Code's reason names its own fix, and the notice can check again
once the operator has applied it.
-->
<script lang="ts">
	import '../styles/tokens.css';
	import { codeSpans } from './code-spans';
	import CopyButton from './CopyButton.svelte';
	import type { AgentReadinessProblem, AgentSetupAction } from './types/launch';

	type Props = {
		problem: AgentReadinessProblem;
		/** Opens a terminal in the workspace. Without it, the notice offers only the command. */
		onOpenTerminal?: () => void;
		/**
		 * Reads the agent's readiness again. Without it, the notice offers no
		 * Check again action. The action is disabled until the promise settles.
		 */
		onCheckAgain?: () => Promise<void>;
		/** The id of the reason paragraph, so a disabled control can name it as its description. */
		reasonId?: string;
	};

	let { problem, onOpenTerminal, onCheckAgain, reasonId }: Props = $props();

	let checking = $state(false);

	async function checkAgain(): Promise<void> {
		if (!onCheckAgain) return;
		checking = true;
		try {
			await onCheckAgain();
		} finally {
			checking = false;
		}
	}

	/** Commands from Pi's install and CLI documentation. */
	const setup: Record<AgentSetupAction, { instruction: string; command: string }> = {
		install_pi: {
			instruction: 'Install Pi from a terminal, then restart Pau.',
			command: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent'
		},
		update_pi: { instruction: 'Update Pi from a terminal, then restart Pau.', command: 'pi update' },
		run_pi: {
			instruction: 'Start Pi in a terminal and run /login to connect a provider, then restart Pau.',
			command: 'pi'
		}
	};

	const step = $derived(problem.action ? setup[problem.action] : undefined);
	const agentName = $derived(problem.agent === 'claude' ? 'Claude Code' : 'Pi');
	const titleId = $props.id();
</script>

<section class="agent-readiness" aria-labelledby={titleId}>
	<h2 id={titleId}>{agentName} is not ready</h2>
	<p id={reasonId}>
		{#each codeSpans(problem.reason) as span, index (index)}{#if span.code}<code>{span.text}</code
				>{:else}{span.text}{/if}{/each}
	</p>
	{#if step}
		<p>{step.instruction}</p>
		<div class="agent-readiness__command">
			<code>{step.command}</code>
			<CopyButton text={step.command} label="Copy command" />
		</div>
		{#if onOpenTerminal}
			<button type="button" class="pau-button pau-button--secondary agent-readiness__terminal" onclick={onOpenTerminal}
				>Open terminal</button>
		{/if}
	{/if}
	{#if onCheckAgain}
		<button
			type="button"
			class="pau-button pau-button--secondary agent-readiness__action"
			disabled={checking}
			onclick={() => void checkAgain()}>{checking ? 'Checking…' : 'Check again'}</button>
	{/if}
</section>

<style>
	.agent-readiness {
		display: grid;
		gap: var(--pau-space-2);
		margin-block-start: var(--pau-space-5);
		padding: var(--pau-space-4);
		border: var(--pau-border-thin) solid var(--pau-border);
		border-inline-start: 2px solid var(--pau-warning);
		border-radius: var(--pau-radius-surface);
		background: var(--pau-surface);
	}

	.agent-readiness h2,
	.agent-readiness p {
		margin: 0;
	}

	.agent-readiness h2 {
		font-size: var(--pau-type-md);
		font-weight: var(--pau-weight-semibold);
	}

	.agent-readiness p {
		color: var(--pau-text-muted);
	}

	.agent-readiness p code {
		font-family: var(--pau-font-code);
		font-size: var(--pau-type-sm);
		color: var(--pau-text);
	}

	.agent-readiness__command {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		padding: var(--pau-space-2) var(--pau-space-3);
		border-radius: var(--pau-radius-control);
		background: var(--pau-canvas);
	}

	.agent-readiness__command code {
		flex: 1;
		min-width: 0;
		font-family: var(--pau-font-code);
		font-size: var(--pau-type-sm);
		white-space: nowrap;
		overflow-x: auto;
	}

	/* The notice sits inside a surface whose primary action is elsewhere. */
	.agent-readiness__terminal,
	.agent-readiness__action {
		justify-self: start;
	}
</style>
