<script lang="ts">
	import MarkdownBlock from './MarkdownBlock.svelte';
	import { parseMarkdown, type MarkdownBlockToken } from './markdown';

	type Props = {
		/** Markdown source. Raw HTML in it is shown as text, never rendered. */
		text: string;
	};

	let { text }: Props = $props();

	/** The previous blocks, kept so unchanged blocks keep their identity while text streams in. */
	let previous: MarkdownBlockToken[] = [];
	const blocks = $derived.by(() => {
		previous = parseMarkdown(text, previous);
		return previous;
	});
</script>

<div class="markdown">
	{#each blocks as block, index (index)}
		<MarkdownBlock token={block} />
	{/each}
</div>

<style>
	.markdown {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--pau-space-3);
		margin-top: var(--pau-space-2);
		font-size: var(--pau-type-md);
		line-height: 1.65;
		overflow-wrap: anywhere;
	}
</style>
