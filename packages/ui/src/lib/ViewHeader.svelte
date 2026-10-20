<script lang="ts">
	import '../styles/tokens.css';
	import type { Snippet } from 'svelte';

	/**
	 * Shared heading for full-width views such as Diagnostics and Processes. It
	 * insets its content by the same `space/3` as the view's sections so the
	 * title and the right-side metadata align with the rows below. The metadata
	 * centers on the title line rather than on the eyebrow and title together.
	 * The view root must set `container-type: inline-size`; the header stacks
	 * when that container is narrower than 48rem.
	 */
	let {
		eyebrow,
		title,
		titleId,
		meta
	}: {
		/** Muted line above the title, such as the workspace name. */
		eyebrow: string;
		title: string;
		/** Id the view's `aria-labelledby` points at. */
		titleId: string;
		/** Right-aligned count or status chip. */
		meta?: Snippet;
	} = $props();
</script>

<header class="view-header">
	<p>{eyebrow}</p>
	<h1 class="pau-view-title" id={titleId}>{title}</h1>
	{#if meta}<div class="view-header__meta">{@render meta()}</div>{/if}
</header>

<style>
	.view-header {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		column-gap: var(--pau-space-4);
		margin-bottom: var(--pau-space-5);
		padding-inline: var(--pau-space-3);
		font-family: var(--pau-font-ui);
	}

	p,
	h1 {
		grid-column: 1;
		margin: 0;
	}

	p {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}

	.view-header__meta {
		grid-area: 2 / 2;
	}

	@container (max-width: 48rem) {
		.view-header {
			grid-template-columns: minmax(0, 1fr);
		}

		.view-header__meta {
			grid-area: auto;
			justify-self: start;
			margin-top: var(--pau-space-2);
		}
	}
</style>
