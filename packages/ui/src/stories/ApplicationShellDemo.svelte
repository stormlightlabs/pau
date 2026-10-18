<script lang="ts">
	import { shellNavigationFixtures } from '../fixtures/application-shell';
	import ApplicationShell, { type ShellPaneWidths } from '../lib/ApplicationShell.svelte';
	import type { ThemeName, UiFontName } from '../theme';

	let {
		disconnected = false,
		inspectorOpen = true,
		longContent = false,
		theme = 'eldritch',
		uiFont = 'overpass',
		paneWidths = { contextRail: null, inspector: null }
	}: {
		disconnected?: boolean;
		inspectorOpen?: boolean;
		longContent?: boolean;
		theme?: ThemeName;
		uiFont?: UiFontName;
		paneWidths?: ShellPaneWidths;
	} = $props();

	// Stands in for the app that stores the widths the shell reports.
	let saved = $derived<ShellPaneWidths>(paneWidths);

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
	{uiFont}
	paneWidths={saved}
	onResize={(widths) => (saved = widths)}>
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
		<output aria-label="Saved pane widths">{JSON.stringify(saved)}</output>
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
		padding-bottom: var(--pau-space-5);
		border-bottom: 1px solid var(--shell-border, #353951);
	}

	h1,
	h2,
	p {
		margin-block: 0;
	}

	h1 {
		margin-top: var(--pau-space-2);
		font-size: var(--pau-type-lg);
		font-weight: var(--pau-weight-semibold);
	}

	h2,
	header p {
		color: var(--shell-muted, #a9a8c0);
		font-size: var(--pau-type-xs);
		font-weight: var(--pau-weight-medium);
	}

	.tool-log {
		display: grid;
		gap: var(--pau-space-3);
		margin-block: var(--pau-space-5);
		padding-left: var(--pau-space-4);
		border-left: 1px solid var(--shell-border, #353951);
	}

	.tool-log p {
		display: grid;
		grid-template-columns: 3rem minmax(0, 1fr) auto;
		gap: var(--pau-space-3);
	}

	.tool-log span,
	.tool-log small {
		color: var(--shell-muted, #a9a8c0);
	}

	code {
		font: inherit;
	}

	.conversation > p {
		margin-top: var(--pau-space-2);
		line-height: 1.65;
	}

	.note {
		margin-top: var(--pau-space-6);
	}

	.note p {
		margin-top: var(--pau-space-2);
		line-height: 1.65;
	}

	.inspection h2 {
		margin: var(--pau-space-4) 0 var(--pau-space-3);
		font-size: var(--pau-type-label);
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.inspection ul {
		display: grid;
		gap: var(--pau-space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.inspection li {
		display: grid;
		grid-template-columns: 0.5rem 1fr;
		gap: var(--pau-space-2);
	}

	.inspection li span {
		width: 0.4rem;
		height: 0.4rem;
		margin-top: var(--pau-space-1);
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
		gap: var(--pau-space-3);
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
