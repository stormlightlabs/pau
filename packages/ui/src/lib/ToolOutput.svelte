<script lang="ts">
	import CopyButton from './CopyButton.svelte';
	import { diffLineKind, outputWindow, toolOutputLineStep } from './tool-call-format';

	type Props = {
		/** Output split into lines. */
		lines: string[];
		/** Accessible name for the output block. */
		label: string;
		/** Which end stays visible when the output exceeds the line cap. */
		from?: 'head' | 'tail';
		/** Colors lines by their `+` or `-` marker. */
		diff?: boolean;
	};

	let { lines, label, from = 'head', diff = false }: Props = $props();
	let shown = $state(toolOutputLineStep);
	let visible = $derived(outputWindow(lines, shown, from));
	let next = $derived(Math.min(toolOutputLineStep, visible.hidden));
</script>

{#snippet more()}
	<button type="button" class="tool-output__more" onclick={() => (shown += toolOutputLineStep)}>
		{from === 'tail' ? `Show ${next} earlier lines` : `Show ${next} more lines`}
	</button>
{/snippet}

<div class="tool-output">
	<CopyButton class="tool-output__copy" text={lines.join('\n')} label="Copy output" />
	{#if from === 'tail' && visible.hidden > 0}{@render more()}{/if}
	{#if diff}
		<pre aria-label={label}>{#each visible.lines as line, index (index)}<span
					class={`tool-output__line tool-output__line--${diffLineKind(line)}`}>{line}</span
				>{/each}</pre>
	{:else}
		<pre aria-label={label}>{visible.lines.join('\n')}</pre>
	{/if}
	{#if from === 'head' && visible.hidden > 0}{@render more()}{/if}
</div>

<style>
	.tool-output {
		position: relative;
	}

	.tool-output :global(.tool-output__copy) {
		position: absolute;
		top: 0;
		right: 0;
		opacity: 0;
	}

	.tool-output:hover :global(.tool-output__copy),
	.tool-output:focus-within :global(.tool-output__copy) {
		opacity: 1;
	}

	@media (hover: none) {
		.tool-output :global(.tool-output__copy) {
			opacity: 1;
		}
	}

	.tool-output pre {
		margin: 0;
		overflow: auto;
		color: var(--pau-text);
		font-family: var(--pau-font-code);
		font-size: var(--pau-type-xs);
		font-variant-ligatures: none;
		line-height: 1.5;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.tool-output__line {
		display: block;
		min-height: 1.5em;
		padding-inline: var(--pau-space-1);
	}

	.tool-output__line--added {
		background: color-mix(in srgb, var(--pau-success) 14%, transparent);
		box-shadow: inset 2px 0 var(--pau-success);
	}

	.tool-output__line--removed {
		background: color-mix(in srgb, var(--pau-danger) 14%, transparent);
		box-shadow: inset 2px 0 var(--pau-danger);
	}

	.tool-output__more {
		min-height: var(--pau-size-row-sm);
		margin-block: var(--pau-space-1);
		padding: 0 var(--pau-space-2);
		color: var(--pau-text-muted);
		font: inherit;
		font-size: var(--pau-type-xs);
		background: transparent;
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		cursor: pointer;
		transition: color var(--pau-duration-feedback) var(--pau-ease-standard);
	}

	.tool-output__more:hover {
		color: var(--pau-text);
	}

	.tool-output__more:focus-visible {
		outline: 2px solid var(--pau-focus);
		outline-offset: 1px;
	}

	@media (pointer: coarse) {
		.tool-output__more {
			min-height: var(--pau-size-target-touch);
		}
	}
</style>
