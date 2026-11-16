<script lang="ts">
	import { setContext } from 'svelte';

	import { shellNavigationFixtures } from '../fixtures/application-shell';
	import ApplicationShell, { type ShellPaneWidths } from '../lib/ApplicationShell.svelte';
	import { Keymap, keymapContext } from '../lib/keymap.svelte';
	import PageHeader from '../lib/PageHeader.svelte';
	import type { ThemeName, UiFontName } from '../theme';

	let {
		disconnected = false,
		withWorkspace = true,
		longContent = false,
		theme = 'eldritch',
		uiFont = 'overpass',
		paneWidths = { contextRail: null, inspector: null }
	}: {
		disconnected?: boolean;
		/** Whether the view has a workspace column. */
		withWorkspace?: boolean;
		longContent?: boolean;
		theme?: ThemeName;
		uiFont?: UiFontName;
		paneWidths?: ShellPaneWidths;
	} = $props();

	// The app provides a key map, so the view row and the panel shortcuts name their chords.
	const keymap = setContext(keymapContext, new Keymap({ platform: 'mac' }));

	// Stands in for the app that stores the widths the shell reports.
	let saved = $derived<ShellPaneWidths>(paneWidths);

	const reviewNotes = Array.from({ length: 9 }, (_, index) => index + 1);
</script>

<svelte:window onkeydown={(event) => keymap.handleKeydown(event)} />

{#snippet workspace()}
	<section class="inspection" aria-label="Checks">
		<h3 class="pau-bay-heading"><span class="pau-section-label">Checks</span><span class="pau-count">3</span></h3>
		<ul>
			<li class="pau-strip pau-strip--row">
				<span class="pau-mark pau-mark--idle" aria-hidden="true"></span><span class="pau-strip__name">typecheck</span
				><span class="pau-strip__figure">passed</span>
			</li>
			<li class="pau-strip pau-strip--row">
				<span class="pau-mark pau-mark--idle" aria-hidden="true"></span><span class="pau-strip__name">tests</span><span
					class="pau-strip__figure">38 passed</span>
			</li>
			<li class="pau-strip pau-strip--row">
				<span class="pau-mark pau-mark--running" aria-hidden="true"></span><span class="pau-strip__name">lint</span
				><span class="pau-strip__figure">running</span>
			</li>
		</ul>
	</section>
{/snippet}

<ApplicationShell
	contextLabel="Workspaces"
	productItems={shellNavigationFixtures.productItems}
	contextItems={shellNavigationFixtures.contextItems}
	{disconnected}
	{theme}
	{uiFont}
	workspace={withWorkspace ? workspace : undefined}
	workspaceLabel="Checks"
	paneWidths={saved}
	onResize={(widths) => (saved = widths)}>
	<section class="conversation" aria-labelledby="task-title">
		<PageHeader title="Fix diff gutter markers under line wrapping" titleId="task-title">
			{#snippet actions()}
				<button type="button" class="pau-button pau-button--quiet">Export</button>
			{/snippet}
		</PageHeader>
		<output aria-label="Saved pane widths">{JSON.stringify(saved)}</output>
		<p>
			Gutter rows now follow visual line offsets, so wrapped lines keep their markers. Two wrap tests cover folded and
			unfolded ranges.
		</p>
		{#if longContent}
			{#each reviewNotes as note (note)}
				<section class="note">
					<h2>Review note {note}</h2>
					<p>
						The marker stays attached to its visual row while the editor width changes. This text is long enough to
						exercise scrolling and line wrapping in the main surface.
					</p>
				</section>
			{/each}
		{/if}
	</section>
</ApplicationShell>

<style>
	h2,
	p {
		margin-block: 0;
	}

	h2 {
		font-size: var(--pau-type-lg);
	}

	output {
		display: block;
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}

	.conversation > p,
	.note p {
		max-width: 75ch;
		margin-top: var(--pau-space-2);
		line-height: var(--pau-leading-prose);
	}

	.note {
		margin-top: var(--pau-space-6);
	}

	.inspection ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
</style>
