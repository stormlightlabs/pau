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

<details class="pau-disclosure tool-group" {open} ontoggle={handleToggle} data-group-id={id}>
	<summary
		><Icon name="chevronRight" class="pau-disclosure__chevron" size={14} /><span class="pau-cap"
			>{count} tool calls</span
		></summary>
	<div class="tool-group__calls">
		{@render children()}
	</div>
</details>

<style>
	/* A group of finished calls is one strip in the rack until it opens. */
	.tool-group {
		/* The left border counts toward the inset, so text lands on the transcript's shared edge. */
		--disclosure-rule: 1px;
		background-color: var(--pau-surface);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
	}

	:global(:is(.tool-call, .tool-group)) + .tool-group {
		margin-top: calc(-1 * var(--pau-space-5) - 1px);
		border-top-left-radius: 0;
		border-top-right-radius: 0;
	}

	.tool-group:has(+ :global(:is(.tool-call, .tool-group))) {
		border-bottom-right-radius: 0;
		border-bottom-left-radius: 0;
	}

	.tool-group summary {
		display: flex;
		align-items: center;
		min-height: var(--pau-size-row-md);
		padding-right: var(--pau-space-3);
		font-size: var(--pau-type-xs);
		line-height: var(--pau-leading-tight);
	}

	.tool-group__calls {
		display: grid;
	}

	/* Calls inside a group are rows of its rack, under a rule each. */
	.tool-group .tool-group__calls > :global(.tool-call) {
		margin: 0;
		border: 0;
		border-top: 1px solid var(--pau-border);
		border-radius: 0;
	}

	@media (pointer: coarse) {
		.tool-group summary {
			min-height: var(--pau-size-target-touch);
		}
	}
</style>
