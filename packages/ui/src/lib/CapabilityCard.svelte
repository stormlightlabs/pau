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
	<button type="button" aria-pressed={enabled} onclick={() => (enabled = !enabled)}>
		{enabled ? 'Disable' : 'Enable'}
	</button>
</article>

<style>
	.capability-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--pau-space-6);
		width: min(34rem, calc(100vw - 3rem));
		padding: var(--pau-space-4);
		color: var(--workbench-text);
		background: var(--workbench-surface);
		border: 1px solid var(--workbench-border);
		border-radius: var(--pau-radius-surface);
		box-shadow: 0 1rem 2.5rem color-mix(in srgb, var(--workbench-shadow) 18%, transparent);
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
		color: var(--workbench-muted);
		font-size: var(--pau-type-md);
		line-height: 1.5;
	}

	span {
		padding: var(--pau-space-1) var(--pau-space-2);
		color: var(--workbench-unavailable-text);
		background: var(--workbench-unavailable-surface);
		border-radius: var(--pau-radius-control);
		font-size: var(--pau-type-xs);
		font-weight: 650;
	}

	span.available {
		color: var(--workbench-available-text);
		background: var(--workbench-available-surface);
	}

	button {
		min-width: 5.25rem;
		min-height: var(--pau-size-target-touch);
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--workbench-button-text);
		background: var(--workbench-button-surface);
		border: 1px solid transparent;
		border-radius: var(--pau-radius-control);
		font: inherit;
		font-size: var(--pau-type-sm);
		font-weight: 650;
		cursor: pointer;
		transition:
			background var(--pau-duration-feedback) var(--pau-ease-standard),
			transform var(--pau-duration-feedback) var(--pau-ease-standard);
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
			gap: var(--pau-space-4);
		}

		button {
			width: 100%;
		}
	}
</style>
