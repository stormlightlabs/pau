<script lang="ts">
	import type { Snippet } from 'svelte';

	import '../styles/tokens.css';
	import Icon from './Icon.svelte';

	type Props = {
		/** Stable group id, kept on the element so transcript search can open the group around a match. */
		id: string;
		/** Number of calls in the group. */
		count: number;
		/** Whether the group shows its calls. The host owns this so it survives re-renders and Ctrl+O. */
		open: boolean;
		/** Reports a disclosure change the operator made on this group. */
		onToggle: (open: boolean) => void;
		/** The tool call rows. */
		children: Snippet;
	};

	let { id, count, open, onToggle, children }: Props = $props();

	function handleToggle(event: Event): void {
		const next = (event.currentTarget as HTMLDetailsElement).open;
		// Svelte also fires `toggle` when the host changes `open`. Report only operator changes.
		if (next !== open) onToggle(next);
	}
</script>

<details class="tool-group" {open} ontoggle={handleToggle} data-group-id={id}>
	<summary><Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />{count} tool calls</summary>
	<div class="tool-group__calls">
		{@render children()}
	</div>
</details>

<style>
	.tool-group {
		border-left: 1px solid var(--pau-border);
	}

	/* Matches the compact spacing between consecutive tool call rows. */
	:global(.tool-call) + .tool-group,
	:global(.tool-group) + .tool-group {
		margin-top: calc(-1 * var(--pau-space-5));
	}

	.tool-group summary {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		min-height: var(--pau-size-row-md);
		padding: var(--pau-space-1) var(--pau-space-3);
		color: var(--pau-text-muted);
		list-style: none;
		cursor: pointer;
	}

	/* WebKit draws its own disclosure triangle unless the marker is hidden. */
	.tool-group summary::-webkit-details-marker {
		display: none;
	}

	.tool-group summary :global(svg) {
		color: var(--pau-info);
	}

	/*
	 * The transcript's row gap, so the negative margin that packs consecutive
	 * tool call rows together works the same inside a group.
	 */
	.tool-group__calls {
		display: grid;
		gap: var(--pau-space-5);
		padding-left: var(--pau-space-4);
	}

	@media (pointer: coarse) {
		.tool-group summary {
			min-height: var(--pau-size-target-touch);
		}
	}
</style>
