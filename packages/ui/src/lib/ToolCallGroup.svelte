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
	<summary><Icon name="chevronRight" class="pau-disclosure__chevron" size={14} />{count} tool calls</summary>
	<div class="tool-group__calls">
		{@render children()}
	</div>
</details>

<style>
	.tool-group {
		--disclosure-rule: 1px;
		border-left: var(--disclosure-rule) solid var(--pau-border);
	}

	/* Matches the compact spacing between consecutive tool call rows. */
	:global(.tool-call) + .tool-group,
	:global(.tool-group) + .tool-group {
		margin-top: calc(-1 * var(--pau-space-5));
	}

	.tool-group summary {
		display: flex;
		align-items: center;
		min-height: var(--pau-size-row-md);
		padding-block: var(--pau-space-1);
		padding-right: var(--pau-space-3);
	}

	/*
	 * The transcript's row gap, so the negative margin that packs consecutive
	 * tool call rows together works the same inside a group.
	 */
	.tool-group__calls {
		display: grid;
		gap: var(--pau-space-5);
	}

	/*
	 * Grouped calls hang under the group's own rule, so their chevrons and
	 * labels line up with the group summary instead of stepping inward. They
	 * keep `--disclosure-rule` because the group's rule still sits to their
	 * left.
	 */
	.tool-group__calls > :global(.tool-call) {
		border-left: 0;
	}

	@media (pointer: coarse) {
		.tool-group summary {
			min-height: var(--pau-size-target-touch);
		}
	}
</style>
