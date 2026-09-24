<script lang="ts">
	import type { CapabilityFixture } from '../fixtures/capabilities';

	let { capability }: { capability: CapabilityFixture } = $props();
	let enabled = $derived(capability.available);
</script>

<article class="capability-card" aria-labelledby={`capability-${capability.id}`}>
	<div class="capability-card__copy">
		<div class="capability-card__heading">
			<h2 id={`capability-${capability.id}`}>{capability.label}</h2>
			<span class:available={enabled}>{enabled ? 'Available' : 'Unavailable'}</span>
		</div>
		<p>{capability.description}</p>
	</div>
	<button type="button" aria-pressed={enabled} onclick={() => (enabled = !enabled)}>
		{enabled ? 'Disable' : 'Enable'}
	</button>
</article>

<style>
	.capability-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 2rem;
		width: min(34rem, calc(100vw - 3rem));
		padding: 1.25rem;
		color: var(--workbench-text);
		background: var(--workbench-surface);
		border: 1px solid var(--workbench-border);
		border-radius: 0.75rem;
		box-shadow: 0 1rem 2.5rem color-mix(in srgb, var(--workbench-shadow) 18%, transparent);
	}

	.capability-card__copy {
		display: grid;
		gap: 0.625rem;
	}

	.capability-card__heading {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	h2,
	p {
		margin: 0;
	}

	h2 {
		font-size: 1rem;
		line-height: 1.35;
	}

	p {
		max-width: 26rem;
		color: var(--workbench-muted);
		font-size: 0.875rem;
		line-height: 1.5;
	}

	span {
		padding: 0.2rem 0.45rem;
		color: var(--workbench-unavailable-text);
		background: var(--workbench-unavailable-surface);
		border-radius: 999px;
		font-size: 0.6875rem;
		font-weight: 650;
	}

	span.available {
		color: var(--workbench-available-text);
		background: var(--workbench-available-surface);
	}

	button {
		min-width: 5.25rem;
		min-height: 2.75rem;
		padding: 0.625rem 0.875rem;
		color: var(--workbench-button-text);
		background: var(--workbench-button-surface);
		border: 1px solid transparent;
		border-radius: 0.5rem;
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 650;
		cursor: pointer;
		transition:
			background 140ms ease,
			transform 140ms ease;
	}

	button:hover {
		background: var(--workbench-button-hover);
	}

	button:active {
		transform: translateY(1px);
	}

	button:focus-visible {
		outline: 3px solid var(--workbench-focus);
		outline-offset: 3px;
	}

	@media (max-width: 30rem) {
		.capability-card {
			align-items: stretch;
			flex-direction: column;
			gap: 1rem;
		}

		button {
			width: 100%;
		}
	}
</style>
