<script lang="ts">
	import '../styles/tokens.css';
	import type { Snippet } from 'svelte';

	/**
	 * Shared empty, loading, and not-yet-started state for a task surface. It
	 * starts at the surface's content column and stays top-aligned, so the
	 * heading sits next to the rail and actions it describes instead of floating
	 * in the middle of a tall pane. The surface sets `--empty-state-inset` to
	 * the left inset of its own content (for example a view header's padding)
	 * and passes the body and actions as children. Body copy goes in `<p>`.
	 */
	let {
		title,
		titleId,
		level = 2,
		role,
		children
	}: {
		title: string;
		/** Id a surrounding `aria-labelledby` points at. */
		titleId?: string;
		/** Heading level: 1 when the state fills the surface, 2 inside a region. */
		level?: 1 | 2;
		role?: 'status' | 'alert';
		/** Body copy, then actions. */
		children?: Snippet;
	} = $props();
</script>

<div class="empty-state" {role}>
	<svelte:element this={`h${level}`} class={{ 'pau-view-title': level === 1 }} id={titleId}>{title}</svelte:element>
	{@render children?.()}
</div>

<style>
	.empty-state {
		box-sizing: border-box;
		width: 100%;
		max-width: 40rem;
		padding: var(--pau-space-5) var(--empty-state-inset, 0);
	}

	.empty-state :is(h1, h2) {
		margin: 0;
	}

	/* A level 1 state fills the surface and takes the view title role instead. */
	.empty-state h2 {
		font-size: var(--pau-type-lg);
	}

	.empty-state :global(p) {
		margin: var(--pau-space-2) 0 0;
		color: var(--pau-text-muted);
		line-height: 1.55;
	}
</style>
