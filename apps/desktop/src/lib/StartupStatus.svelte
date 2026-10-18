<!--
@component
Shows desktop startup progress until the workspace can render. It lists each
step with its state and, for a failed step, the reason.
-->
<script lang="ts">
	import type { StartupProgress } from '@stormlightlabs/pau-protocol';

	import { STARTUP_STEP_LABELS } from './startup';

	let { progress, error }: { progress: StartupProgress | undefined; error?: string } = $props();
</script>

<main class="startup" aria-busy={progress?.phase === 'running'}>
	<h1>{progress?.phase === 'failed' ? 'Pau could not start' : 'Starting Pau'}</h1>
	{#if error}
		<p role="alert">{error}</p>
	{/if}
	{#if progress}
		<ol>
			{#each progress.steps as step (step.id)}
				<li data-state={step.state}>
					<span>{STARTUP_STEP_LABELS[step.id]}</span>
					<span class="state">{step.state}</span>
					{#if step.reason}
						<p>{step.reason}</p>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</main>

<style>
	.startup {
		max-width: 32rem;
		margin: 20vh auto 0;
		padding: 0 1rem;
		color: #e4e5f1;
		font:
			14px/1.5 system-ui,
			sans-serif;
	}

	h1 {
		font-size: 1.25rem;
		font-weight: 600;
	}

	ol {
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0.25rem 0;
	}

	.state {
		margin-left: auto;
		opacity: 0.7;
	}

	li p {
		flex-basis: 100%;
		margin: 0;
		opacity: 0.85;
	}
</style>
