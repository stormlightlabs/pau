<script lang="ts">
	import '../styles/tokens.css';

	type Props = {
		/** Metadata parts joined by " · ", such as "Pi · Sonnet". */
		text: string;
	};

	let { text }: Props = $props();
	const parts = $derived(text.split(' · '));
</script>

<!--
	Overpass sets the middle dot with almost no right side bearing, so a literal
	" · " reads as "Pi ·Sonnet". The separator is its own hidden element with
	equal space on both sides and stays out of the accessible name. The
	zero-size space keeps the parts apart for assistive technology.
-->
{#each parts as part, index (index)}{#if index > 0}<span class="meta-space">&nbsp;</span><span
			class="meta-separator"
			aria-hidden="true">·</span
		>{/if}{part}{/each}

<style>
	.meta-space {
		display: inline-block;
		inline-size: 0;
		overflow: hidden;
	}

	/*
	 * The glyph is clipped and a drawn dot takes its place, because Overpass centers
	 * the middle dot in neither its advance width nor its margins.
	 */
	.meta-separator {
		display: inline-block;
		inline-size: calc(var(--pau-space-1) * 0.75);
		block-size: calc(var(--pau-space-1) * 0.75);
		margin-inline: calc(var(--pau-space-1) * 1.5);
		border-radius: 50%;
		background: currentColor;
		overflow: hidden;
		text-indent: 100%;
		white-space: nowrap;
		vertical-align: middle;
	}
</style>
