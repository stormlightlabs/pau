<script lang="ts">
	import type { Token, Tokens } from 'marked';
	import { safeHref } from './markdown';

	type Props = {
		/** One top-level Markdown block. */
		token: Token;
	};

	let { token }: Props = $props();
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
				<a {href} title={link.title ?? undefined} target="_blank" rel="noopener noreferrer"
					>{@render inline(link.tokens)}</a>
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
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<pre data-language={code.lang || undefined} tabindex="0"><code>{code.text}</code></pre>
	{:else if node.type === 'blockquote'}
		<blockquote>
			{#each (node as Tokens.Blockquote).tokens as child, index (index)}{@render block(child)}{/each}
		</blockquote>
	{:else if node.type === 'list'}
		{@const list = node as Tokens.List}
		<svelte:element
			this={list.ordered ? 'ol' : 'ul'}
			start={typeof list.start === 'number' && list.start !== 1 ? list.start : undefined}>
			{#each list.items as item, index (index)}
				<li>
					{#if item.task}<input type="checkbox" checked={item.checked} disabled aria-label="Task" />{/if}
					{#each item.tokens as child, childIndex (childIndex)}
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

	.markdown__heading {
		font-size: var(--pau-type-lg);
		font-weight: 600;
		line-height: 1.35;
		text-wrap: balance;
	}

	h1 {
		font-size: var(--pau-type-xl);
	}

	h5,
	h6 {
		font-size: var(--pau-type-md);
		color: var(--pau-text-muted);
	}

	ul,
	ol {
		padding-left: var(--pau-space-5);
	}

	li input {
		margin: 0 var(--pau-space-2) 0 calc(var(--pau-space-4) * -1);
	}

	blockquote {
		display: grid;
		gap: var(--pau-space-2);
		padding-left: var(--pau-space-3);
		border-left: 2px solid var(--pau-border);
		color: var(--pau-text-muted);
	}

	a {
		color: var(--pau-accent);
		text-underline-offset: 2px;
	}

	code {
		padding: 0.05em var(--pau-space-1);
		border-radius: var(--pau-radius-control);
		background: var(--pau-surface-raised);
		font-family: var(--pau-font-code);
		font-size: 0.92em;
	}

	pre {
		padding: var(--pau-space-3);
		overflow-x: auto;
		overflow-wrap: normal;
		border: var(--pau-border-thin) solid var(--pau-border);
		border-radius: var(--pau-radius-surface);
		background: var(--pau-surface);
		font-family: var(--pau-font-code);
		font-size: var(--pau-type-sm);
		line-height: 1.55;
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
		font-weight: 600;
	}

	hr {
		width: 100%;
		border: 0;
		border-top: var(--pau-border-thin) solid var(--pau-border);
	}
</style>
