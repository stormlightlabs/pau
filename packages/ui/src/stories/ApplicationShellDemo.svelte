<script lang="ts">
	import { shellNavigationFixtures } from '../fixtures/applicationShell';
	import ApplicationShell from '../lib/ApplicationShell.svelte';
	import type { ThemeName, UiFontName } from '../theme';

	let {
		disconnected = false,
		inspectorOpen = true,
		longContent = false,
		theme = 'eldritch',
		uiFont = 'inter'
	}: {
		disconnected?: boolean;
		inspectorOpen?: boolean;
		longContent?: boolean;
		theme?: ThemeName;
		uiFont?: UiFontName;
	} = $props();

	const reviewNotes = Array.from({ length: 9 }, (_, index) => index + 1);
</script>

<ApplicationShell
	workspaceName="fix-diff-gutter"
	contextLabel="Workspaces"
	productItems={shellNavigationFixtures.productItems}
	contextItems={shellNavigationFixtures.contextItems}
	{disconnected}
	{inspectorOpen}
	{theme}
	{uiFont}>
	<section class="conversation" aria-labelledby="task-title">
		<header>
			<p>pi · task</p>
			<h1 id="task-title">Fix diff gutter markers under line wrapping</h1>
		</header>
		<div class="tool-log" aria-label="Recent tool activity">
			<p><span>read</span><code>src/diff/gutter.ts</code><small>212 lines</small></p>
			<p><span>grep</span><code>wrapWidth</code><small>6 matches</small></p>
			<p><span>edit</span><code>src/diff/gutter.ts</code><small>+24 −9</small></p>
			<p><span>bash</span><code>pnpm test diff</code><small>38 passed</small></p>
		</div>
		<h2>pi · sonnet</h2>
		<p>
			Gutter rows now follow visual line offsets, so wrapped lines keep their markers. Two wrap tests cover folded and
			unfolded ranges.
		</p>
		{#if longContent}
			{#each reviewNotes as note (note)}
				<section class="note">
					<h2>Review note {note}</h2>
					<p>
						The marker stays attached to its visual row while the editor width changes. This text is intentionally long
						enough to exercise scrolling and line wrapping in the main surface.
					</p>
				</section>
			{/each}
		{/if}
	</section>

	{#snippet inspector()}
		<section class="inspection">
			<h2>Plan · v0.3</h2>
			<ul>
				<li><span class="done"></span>Theme tokens → CSS vars</li>
				<li><span class="active"></span>Gutter markers under wrap</li>
				<li><span></span>MCP registry browser</li>
			</ul>
			<h2>Checks</h2>
			<dl>
				<div>
					<dt>typecheck</dt>
					<dd>passed</dd>
				</div>
				<div>
					<dt>tests</dt>
					<dd>38 passed</dd>
				</div>
				<div>
					<dt>lint</dt>
					<dd>running</dd>
				</div>
			</dl>
		</section>
	{/snippet}
</ApplicationShell>

<style>
	.conversation {
		max-width: 54rem;
		margin-inline: auto;
	}

	.conversation header {
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--shell-border, #353951);
	}

	h1,
	h2,
	p {
		margin-block: 0;
	}

	h1 {
		margin-top: 0.4rem;
		font-size: 1rem;
		font-weight: 550;
	}

	h2,
	header p {
		color: var(--shell-muted, #a9a8c0);
		font-size: 0.75rem;
		font-weight: 500;
	}

	.tool-log {
		display: grid;
		gap: 0.7rem;
		margin-block: 1.5rem;
		padding-left: 1rem;
		border-left: 1px solid var(--shell-border, #353951);
	}

	.tool-log p {
		display: grid;
		grid-template-columns: 3rem minmax(0, 1fr) auto;
		gap: 0.75rem;
	}

	.tool-log span,
	.tool-log small {
		color: var(--shell-muted, #a9a8c0);
	}

	code {
		font: inherit;
	}

	.conversation > p {
		margin-top: 0.55rem;
		line-height: 1.65;
	}

	.note {
		margin-top: 2rem;
	}

	.note p {
		margin-top: 0.5rem;
		line-height: 1.65;
	}

	.inspection h2 {
		margin: 1rem 0 0.75rem;
		font-size: 0.7rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.inspection ul {
		display: grid;
		gap: 0.85rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.inspection li {
		display: grid;
		grid-template-columns: 0.5rem 1fr;
		gap: 0.55rem;
	}

	.inspection li span {
		width: 0.4rem;
		height: 0.4rem;
		margin-top: 0.35rem;
		background: var(--pau-info, #8bd7ff);
		border-radius: 50%;
	}

	.inspection li span.done {
		background: var(--pau-success, #6bf0bd);
	}

	.inspection li span.active {
		background: var(--pau-warning, #ffd479);
	}

	dl {
		display: grid;
		gap: 0.65rem;
		margin: 0;
	}

	dl div {
		display: flex;
		justify-content: space-between;
	}

	dt,
	dd {
		margin: 0;
	}

	dd {
		color: var(--shell-muted, #a9a8c0);
	}
</style>
