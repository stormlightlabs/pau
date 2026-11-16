<script lang="ts">
	import '../styles/tokens.css';
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
	<button
		type="button"
		class="pau-button pau-button--primary"
		aria-pressed={enabled}
		onclick={() => (enabled = !enabled)}>
		{enabled ? 'Disable' : 'Enable'}
	</button>
</article>

<style>
	.capability-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--pau-space-6);
		width: 100%;
		max-width: 34rem;
		padding: var(--pau-space-4);
		color: var(--pau-text);
		background: var(--pau-surface);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
	}

	.capability-card__copy {
		display: grid;
		gap: var(--pau-space-2);
	}

	.capability-card__heading {
		display: flex;
		align-items: center;
		gap: var(--pau-space-3);
	}

	h2,
	p {
		margin: 0;
	}

	h2 {
		font-size: var(--pau-type-lg);
		line-height: 1.35;
	}

	p {
		max-width: 26rem;
		color: var(--pau-text-muted);
		font-size: var(--pau-type-md);
		line-height: 1.5;
	}

	span {
		padding: var(--pau-space-1) var(--pau-space-2);
		color: var(--pau-danger);
		background: var(--pau-surface-raised);
		border-radius: var(--pau-radius-control);
		font-size: var(--pau-type-xs);
		font-weight: var(--pau-weight-semibold);
	}

	span.available {
		color: var(--pau-success);
	}

	button {
		min-width: 5.25rem;
	}

	@media (max-width: 30rem) {
		.capability-card {
			align-items: stretch;
			flex-direction: column;
			gap: var(--pau-space-4);
		}

		button {
			width: 100%;
		}
	}
</style>
