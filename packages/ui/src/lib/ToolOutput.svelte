<script lang="ts">
	import '../styles/tokens.css';
	import CopyButton from './CopyButton.svelte';
	import { diffLineKind, outputWindow, toolOutputChunkLines, toolOutputLineCap } from './tool-call-format';

	type Props = {
		/** Output split into lines. */
		lines: string[];
		/** Accessible name for the output block. */
		label: string;
		/** Which end stays visible while the output is capped. */
		from?: 'head' | 'tail';
		/** Colors lines by their `+` or `-` marker. */
		diff?: boolean;
	};

	let { lines, label, from = 'head', diff = false }: Props = $props();
	let expanded = $state(false);
	let body = $state<HTMLPreElement>();
	const bodyId = $props.id();

	const capped = $derived(lines.length > toolOutputLineCap);
	const visible = $derived(expanded ? lines : outputWindow(lines, toolOutputLineCap, from).lines);
	/*
	 * Plain output renders as one text node per chunk of lines. Each chunk
	 * after the first starts with its line break, so a full chunk's text never
	 * changes again, and a streamed line rewrites only the last chunk.
	 */
	const chunks = $derived.by(() => {
		const texts: string[] = [];
		for (let start = 0; start < visible.length; start += toolOutputChunkLines) {
			const text = visible.slice(start, start + toolOutputChunkLines).join('\n');
			texts.push(start === 0 ? text : `\n${text}`);
		}
		return texts;
	});
	const count = $derived(lines.length.toLocaleString('en-US'));
	const summary = $derived(
		expanded ? `All ${count} lines` : `${from === 'tail' ? 'Last' : 'First'} ${toolOutputLineCap} of ${count} lines`
	);

	/* An opened command output starts at its end, where the result is. */
	$effect(() => {
		if (expanded && from === 'tail' && body) body.scrollTop = body.scrollHeight;
	});
</script>

<div
	class="pau-tool-output tool-output"
	class:pau-tool-output--capped={capped && !expanded}
	class:pau-tool-output--expanded={expanded}
	class:pau-tool-output--head={from === 'head'}>
	<CopyButton class="tool-output__copy" text={lines.join('\n')} label="Copy output" />
	<!-- The open body scrolls, so it takes focus for keyboard scrolling. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<pre
		bind:this={body}
		id={bodyId}
		class="pau-tool-output__body"
		aria-label={label}
		tabindex={expanded ? 0 : undefined}>{#if diff}{#each visible as line, index (index)}<span
					class={`tool-output__line tool-output__line--${diffLineKind(line)}`}>{line}</span
				>{/each}{:else}{#each chunks as chunk, index (index)}{chunk}{/each}{/if}</pre>
	{#if capped}
		<div class="pau-tool-output__bar">
			<span>{summary}</span>
			<button
				type="button"
				class="pau-button pau-button--quiet"
				aria-expanded={expanded}
				aria-controls={bodyId}
				onclick={() => (expanded = !expanded)}>{expanded ? 'Show less' : `Show all ${count} lines`}</button>
		</div>
	{/if}
</div>

<style>
	.tool-output :global(.tool-output__copy) {
		position: absolute;
		top: 0;
		right: 0;
		z-index: 1;
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

	.tool-output__line {
		display: block;
		min-height: var(--pau-leading-row);
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
</style>
