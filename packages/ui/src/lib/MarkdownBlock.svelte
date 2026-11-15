<script lang="ts">
	import type { Token, Tokens } from 'marked';
	import CopyButton from './CopyButton.svelte';
	import { useExternalLinks } from './external-links';
	import { safeHref } from './markdown';

	type Props = {
		/** One top-level Markdown block. */
		token: Token;
	};

	let { token }: Props = $props();

	const links = useExternalLinks();
</script>

{#snippet inline(tokens: Token[] | undefined)}
	{#each tokens ?? [] as node, index (index)}
		{#if node.type === 'strong'}
			<strong>{@render inline((node as Tokens.Strong).tokens)}</strong>
		{:else if node.type === 'em'}
			<em>{@render inline((node as Tokens.Em).tokens)}</em>
		{:else if node.type === 'del'}
			<del>{@render inline((node as Tokens.Del).tokens)}</del>
		{:else if node.type === 'codespan'}
			<code>{(node as Tokens.Codespan).text}</code>
		{:else if node.type === 'br'}
			<br />
		{:else if node.type === 'link'}
			{@const link = node as Tokens.Link}
			{@const href = safeHref(link.href)}
			{#if href}
				<a
					class="pau-link"
					{href}
					title={link.title ?? undefined}
					target="_blank"
					rel="noopener noreferrer"
					onclick={(event) => links.click(event, href)}>{@render inline(link.tokens)}</a>
			{:else}
				{@render inline(link.tokens)}
			{/if}
		{:else if node.type === 'image'}
			<!-- Remote images would load from the network on the agent's say-so. -->
			{(node as Tokens.Image).text}
		{:else if 'tokens' in node && node.tokens}
			{@render inline(node.tokens as Token[])}
		{:else if 'text' in node}
			{node.text}
		{:else}
			{node.raw}
		{/if}
	{/each}
{/snippet}

{#snippet block(node: Token)}
	{#if node.type === 'heading'}
		{@const heading = node as Tokens.Heading}
		<svelte:element this={`h${Math.min(Math.max(heading.depth, 1), 6)}`} class="markdown__heading"
			>{@render inline(heading.tokens)}</svelte:element>
	{:else if node.type === 'paragraph'}
		<p>{@render inline((node as Tokens.Paragraph).tokens)}</p>
	{:else if node.type === 'code'}
		{@const code = node as Tokens.Code}
		<div class="markdown__code">
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<pre data-language={code.lang || undefined} tabindex="0"><code>{code.text}</code></pre>
			<CopyButton class="markdown__copy" text={code.text} label="Copy code" />
		</div>
	{:else if node.type === 'blockquote'}
		<blockquote>
			{#each (node as Tokens.Blockquote).tokens as child, index (index)}{@render block(child)}{/each}
		</blockquote>
	{:else if node.type === 'list'}
		{@const list = node as Tokens.List}
		{@const start = typeof list.start === 'number' ? list.start : 1}
		<svelte:element
			this={list.ordered ? 'ol' : 'ul'}
			start={start !== 1 ? start : undefined}
			style:--markdown-marker-digits={list.ordered ? String(start + list.items.length - 1).length : undefined}>
			{#each list.items as item, index (index)}
				<li>
					{#if item.task}<span class="markdown__task"
							><input type="checkbox" checked={item.checked} disabled aria-label="Task" /></span
						>{/if}{#each item.tokens as child, childIndex (childIndex)}
						{#if child.type === 'text'}
							{@render inline((child as Tokens.Text).tokens ?? [child])}
						{:else}
							{@render block(child)}
						{/if}
					{/each}
				</li>
			{/each}
		</svelte:element>
	{:else if node.type === 'table'}
		{@const table = node as Tokens.Table}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div class="markdown__table" role="region" aria-label="Table" tabindex="0">
			<table>
				<thead>
					<tr>
						{#each table.header as cell, index (index)}
							<th scope="col" style:text-align={cell.align}>{@render inline(cell.tokens)}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each table.rows as row, rowIndex (rowIndex)}
						<tr>
							{#each row as cell, index (index)}
								<td style:text-align={cell.align}>{@render inline(cell.tokens)}</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else if node.type === 'hr'}
		<hr />
	{:else if node.type === 'html'}
		<p>{(node as Tokens.HTML).raw.trim()}</p>
	{:else if 'tokens' in node && node.tokens}
		<p>{@render inline(node.tokens as Token[])}</p>
	{:else if 'text' in node}
		<p>{node.text}</p>
	{/if}
{/snippet}

{@render block(token)}

<style>
	p,
	blockquote,
	pre,
	ul,
	ol,
	hr,
	.markdown__heading {
		margin: 0;
	}

	p {
		white-space: pre-wrap;
	}

	/*
	 * Headings descend one type step per level, all at 600, so an agent's
	 * outline reads at a glance. Every level is scoped to the heading class so
	 * no shared rule outranks a level's size.
	 */
	.markdown__heading {
		font-weight: var(--pau-weight-semibold);
		line-height: 1.35;
		text-wrap: balance;
	}

	h1.markdown__heading {
		font-size: var(--pau-type-xl);
	}

	h2.markdown__heading {
		font-size: var(--pau-type-lg);
	}

	h3.markdown__heading {
		font-size: var(--pau-type-md);
	}

	h4.markdown__heading,
	h5.markdown__heading,
	h6.markdown__heading {
		font-size: var(--pau-type-sm);
	}

	h5.markdown__heading,
	h6.markdown__heading {
		color: var(--pau-text-muted);
	}

	/*
	 * Item text starts `space/5` in, and a bullet sits on the left edge of
	 * the text around the list, where paragraphs start. A nested list repeats
	 * this from its parent item's text. The browser's own marker hangs a
	 * variable distance left of the text, so it is drawn here. An empty
	 * marker string, unlike `none`, keeps Safari reading the list as a list.
	 */
	ul,
	ol {
		--markdown-list-indent: var(--pau-space-5);

		padding-left: var(--markdown-list-indent);
		list-style-type: '';
	}

	/*
	 * A number ends `space/2` before its item's text, so `9.` and `10.` line
	 * up on the period and a longer number grows left, away from the text.
	 * The markup gives the digit count of the list's last number, and the
	 * indent widens to fit it, so `100.` and `1000.` stay inside the list.
	 */
	ol {
		--markdown-list-indent: max(
			var(--pau-space-5),
			calc((var(--markdown-marker-digits, 1) + 1) * 1ch + var(--pau-space-2))
		);
	}

	li {
		position: relative;
	}

	li::before {
		position: absolute;
		color: var(--pau-text-muted);
	}

	ul > li::before {
		left: calc(var(--markdown-list-indent) * -1);
		content: '•';
	}

	ol > li::before {
		right: calc(100% + var(--pau-space-2));
		content: counter(list-item) '.';
		/* Positioned against the item's left edge, the marker has no width to fill and would break between digits. */
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	/* A task item's checkbox takes the marker's place and centers on the capitals. */
	li:has(> .markdown__task)::before {
		content: none;
	}

	/*
	 * The box stays in the line, so its baseline offset can center it on the
	 * capitals. Its only content is positioned, so its baseline is its bottom
	 * edge in every engine, which a native checkbox's own baseline is not. The
	 * offset raises that edge by half the cap height less half the box. Its
	 * margins move it into the marker's place without moving the text.
	 */
	.markdown__task {
		position: relative;
		display: inline-block;
		width: 1em;
		height: 1em;
		margin: 0 calc(var(--markdown-list-indent) - 1em) 0 calc(var(--markdown-list-indent) * -1);
		/* Close to the UI fonts' cap center where `cap` is unsupported. */
		vertical-align: -0.15em;
		vertical-align: calc(0.5cap - 0.5em);
	}

	.markdown__task input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
	}

	blockquote {
		display: grid;
		gap: var(--pau-space-2);
		padding-left: var(--pau-space-3);
		border-left: 2px solid var(--pau-border);
		color: var(--pau-text-muted);
	}

	code {
		padding: 0.05em var(--pau-space-1);
		border-radius: var(--pau-radius-control);
		background: var(--pau-surface-raised);
		font-family: var(--pau-font-code);
		font-variant-ligatures: none;
		font-size: 0.92em;
	}

	pre {
		padding: var(--pau-space-3);
		overflow-x: auto;
		overflow-wrap: normal;
		border: var(--pau-border-thin) solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		background: var(--pau-surface);
		font-family: var(--pau-font-code);
		font-variant-ligatures: none;
		font-size: var(--pau-type-sm);
		line-height: 1.55;
	}

	.markdown__code {
		position: relative;
	}

	.markdown__code :global(.markdown__copy) {
		position: absolute;
		top: var(--pau-space-2);
		right: var(--pau-space-2);
		opacity: 0;
	}

	.markdown__code:hover :global(.markdown__copy),
	.markdown__code:focus-within :global(.markdown__copy) {
		opacity: 1;
	}

	@media (hover: none) {
		.markdown__code :global(.markdown__copy) {
			opacity: 1;
		}
	}

	pre code {
		padding: 0;
		background: none;
		font-size: inherit;
	}

	.markdown__table {
		overflow-x: auto;
	}

	table {
		border-collapse: collapse;
		font-size: var(--pau-type-sm);
	}

	th,
	td {
		padding: var(--pau-space-1) var(--pau-space-3);
		border: var(--pau-border-thin) solid var(--pau-border);
		text-align: left;
	}

	th {
		background: var(--pau-surface);
		font-weight: var(--pau-weight-semibold);
	}

	hr {
		width: 100%;
		border: 0;
		border-top: var(--pau-border-thin) solid var(--pau-border);
	}
</style>
