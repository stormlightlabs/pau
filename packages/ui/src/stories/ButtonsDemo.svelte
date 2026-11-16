<script lang="ts">
	import Icon from '../lib/Icon.svelte';
	import { longText } from '../fixtures/foundation';
	import '../styles/tokens.css';

	type Props = {
		/** The sheet's width, so a story can show a narrow container. */
		width?: string;
	};

	let { width = '44rem' }: Props = $props();

	const variants = [
		{ name: 'Primary', className: 'pau-button--primary', label: 'Send prompt' },
		{ name: 'Secondary', className: 'pau-button--secondary', label: 'Open workspace' },
		{ name: 'Quiet', className: 'pau-button--quiet', label: 'Attach image' },
		{ name: 'Danger', className: 'pau-button--danger', label: 'Stop session' }
	] as const;
</script>

<!--
	Every button variant at rest and disabled, with an icon, a key cap, an
	icon-only button and a long label, on the canvas and on the surface.
-->
<div class="buttons-demo" style:max-width={width}>
	{#each ['canvas', 'surface'] as surface (surface)}
		<section class={`buttons-demo__surface buttons-demo__surface--${surface}`} aria-label={`Buttons on the ${surface}`}>
			{#each variants as variant (variant.name)}
				<div class="buttons-demo__row" data-variant={variant.name}>
					<button type="button" class={`pau-button ${variant.className}`}>{variant.label}</button>
					<button type="button" class={`pau-button ${variant.className}`} disabled>{variant.label}</button>
					<button type="button" class={`pau-button ${variant.className}`}
						><Icon name="plus" size={16} /><span>New</span></button>
					<button type="button" class={`pau-button ${variant.className}`}
						><span>{variant.label}</span><kbd><span>Y</span></kbd></button>
					<button type="button" class={`pau-button pau-button--icon ${variant.className}`} aria-label="New terminal"
						><Icon name="terminal" size={16} /></button>
				</div>
			{/each}
			<div class="buttons-demo__row">
				<button type="button" class="pau-button pau-button--quiet" aria-pressed="true"
					><Icon name="dock" size={16} /><span>Terminal</span></button>
				<button type="button" class="pau-button pau-button--secondary buttons-demo__long">{longText.label}</button>
			</div>
		</section>
	{/each}
</div>

<style>
	.buttons-demo {
		display: grid;
		color: var(--pau-text);
		font-family: var(--pau-font-ui);
		font-size: var(--pau-type-md);
	}

	.buttons-demo__surface {
		display: grid;
		gap: var(--pau-space-3);
		padding: var(--pau-space-4);
	}

	.buttons-demo__surface--canvas {
		background: var(--pau-canvas);
	}

	.buttons-demo__surface--surface {
		background: var(--pau-surface);
	}

	.buttons-demo__row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--pau-space-2);
	}

	.buttons-demo__long {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
