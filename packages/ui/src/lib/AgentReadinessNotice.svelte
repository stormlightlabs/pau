<!--
@component
Tells the operator why Pi cannot start a session and gives the command that
fixes it. Pau cannot type into a terminal for the operator, so it shows the
command with a copy button and opens a terminal where they can run it.
-->
<script lang="ts">
	import '../styles/tokens.css';
	import CopyButton from './CopyButton.svelte';
	import type { AgentReadinessProblem, AgentSetupAction } from './types/launch';

	type Props = {
		problem: AgentReadinessProblem;
		/** Opens a terminal in the workspace. Without it, the notice offers only the command. */
		onOpenTerminal?: () => void;
	};

	let { problem, onOpenTerminal }: Props = $props();

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
	const titleId = $props.id();
</script>

<section class="agent-readiness" aria-labelledby={titleId}>
	<h2 id={titleId}>Pi is not ready</h2>
	<p>{problem.reason}</p>
	{#if step}
		<p>{step.instruction}</p>
		<div class="agent-readiness__command">
			<code>{step.command}</code>
			<CopyButton text={step.command} label="Copy command" />
		</div>
		{#if onOpenTerminal}
			<button type="button" class="agent-readiness__terminal" onclick={onOpenTerminal}>Open terminal</button>
		{/if}
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
		overflow-wrap: anywhere;
	}

	.agent-readiness__terminal {
		justify-self: start;
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-3);
		color: var(--pau-text);
		background: transparent;
		border: var(--pau-border-thin) solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		font: inherit;
		cursor: pointer;
	}

	.agent-readiness__terminal:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset);
	}
</style>
