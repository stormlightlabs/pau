<script lang="ts">
	import '../styles/tokens.css';
	import type { Snippet } from 'svelte';

	/**
	 * Shared heading for full-width views such as Diagnostics and Processes. It
	 * insets its content by the same `space/3` as the view's sections so the
	 * title and the right-side metadata align with the rows below. The view
	 * root must set `container-type: inline-size`; the header stacks when that
	 * container is narrower than 48rem.
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
	<div>
		<p>{eyebrow}</p>
		<h1 id={titleId}>{title}</h1>
	</div>
	{@render meta?.()}
</header>

<style>
	.view-header {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: var(--pau-space-4);
		margin-bottom: var(--pau-space-5);
		padding-inline: var(--pau-space-3);
		font-family: var(--pau-font-ui);
	}

	p,
	h1 {
		margin: 0;
	}

	p {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}

	h1 {
		font-size: var(--pau-type-lg);
		font-weight: var(--pau-weight-semibold);
	}

	@container (max-width: 48rem) {
		.view-header {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
