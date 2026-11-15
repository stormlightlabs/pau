<script lang="ts">
	import '../styles/tokens.css';
	import { Chunk, unifiedMergeView } from '@codemirror/merge';
	import { EditorState, type Extension } from '@codemirror/state';
	import { basicSetup, EditorView } from 'codemirror';
	import { SvelteSet } from 'svelte/reactivity';

	import type { WorkspaceGitDiff } from './types/workspace-files';

	type Props = { diff: WorkspaceGitDiff; reviewedHunks?: number[]; onReviewedHunksChange?: (hunks: number[]) => void };

	let { diff, reviewedHunks = [], onReviewedHunksChange }: Props = $props();
	let mode = $state<'file' | 'hunk'>('file');
	let currentHunk = $state(0);
	let wrapLines = $state(false);
	let host = $state<HTMLElement>();
	const reviewed = new SvelteSet(initialReviewedHunks());

	let oldDocument = $derived(EditorState.create({ doc: diff.old_content ?? '' }).doc);
	let newDocument = $derived(EditorState.create({ doc: diff.new_content ?? '' }).doc);
	let chunks = $derived(diff.binary || diff.too_large ? [] : Chunk.build(oldDocument, newDocument));
	let activeChunk = $derived(chunks[currentHunk]);
	let displayed = $derived.by(() => {
		if (mode === 'file' || !activeChunk) {
			return { oldContent: diff.old_content ?? '', newContent: diff.new_content ?? '' };
		}
		return {
			oldContent: chunkSlice(oldDocument, activeChunk.fromA, activeChunk.endA),
			newContent: chunkSlice(newDocument, activeChunk.fromB, activeChunk.endB)
		};
	});

	$effect(() => {
		if (!host || diff.binary || diff.too_large) return;
		const wrapping: Extension = wrapLines ? EditorView.lineWrapping : [];
		const view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: displayed.newContent,
				extensions: [
					basicSetup,
					EditorState.readOnly.of(true),
					EditorView.editable.of(false),
					EditorView.contentAttributes.of({ 'aria-label': `${diff.path} diff` }),
					unifiedMergeView({
						original: displayed.oldContent,
						mergeControls: false,
						gutter: true,
						highlightChanges: true
					}),
					wrapping,
					EditorView.theme({
						'&': { height: '100%', color: 'var(--pau-text)', backgroundColor: 'var(--pau-canvas)' },
						'.cm-scroller': { fontFamily: 'var(--pau-font-code)' },
						'.cm-gutters': {
							backgroundColor: 'var(--pau-surface)',
							color: 'var(--pau-text-muted)',
							borderRight: '1px solid var(--pau-border)'
						},
						'.cm-changedLine': { backgroundColor: 'color-mix(in srgb, var(--pau-success) 11%, transparent)' },
						'.cm-deletedChunk': { backgroundColor: 'color-mix(in srgb, var(--pau-danger) 11%, transparent)' },
						'.cm-changeGutter': { width: '3px' },
						'&.cm-focused': { outline: 'none' }
					})
				]
			})
		});
		return () => view.destroy();
	});

	function initialReviewedHunks(): number[] {
		return reviewedHunks;
	}

	function chunkSlice(document: typeof oldDocument, from: number, to: number): string {
		const startLine = Math.max(1, document.lineAt(Math.min(from, document.length)).number - 2);
		const endLine = Math.min(document.lines, document.lineAt(Math.min(to, document.length)).number + 2);
		return document.sliceString(document.line(startLine).from, document.line(endLine).to);
	}

	function hunkLabel(chunk: Chunk): string {
		const oldStart = oldDocument.lineAt(Math.min(chunk.fromA, oldDocument.length)).number;
		const newStart = newDocument.lineAt(Math.min(chunk.fromB, newDocument.length)).number;
		const oldCount =
			chunk.fromA === chunk.toA
				? 0
				: oldDocument.lineAt(Math.min(chunk.endA, oldDocument.length)).number - oldStart + 1;
		const newCount =
			chunk.fromB === chunk.toB
				? 0
				: newDocument.lineAt(Math.min(chunk.endB, newDocument.length)).number - newStart + 1;
		return `@@ −${oldStart},${oldCount} +${newStart},${newCount} @@`;
	}

	function moveHunk(offset: number): void {
		if (chunks.length === 0) return;
		mode = 'hunk';
		currentHunk = (currentHunk + offset + chunks.length) % chunks.length;
	}

	function toggleReviewed(): void {
		if (!activeChunk) return;
		if (reviewed.has(currentHunk)) reviewed.delete(currentHunk);
		else reviewed.add(currentHunk);
		onReviewedHunksChange?.([...reviewed].sort((left, right) => left - right));
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (!event.altKey) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			moveHunk(1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			moveHunk(-1);
		}
	}
</script>

<section class="diff-review" aria-label={`Diff for ${diff.path}`}>
	<header class="diff-review__header">
		<div>
			<p>{diff.previous_path ? `${diff.previous_path} → ${diff.path}` : diff.path}</p>
			<small>{reviewed.size} of {chunks.length} hunks reviewed</small>
		</div>
		<div class="diff-review__controls">
			<div class="diff-review__segmented" aria-label="Diff view">
				<button type="button" class="pau-utility-button" aria-pressed={mode === 'file'} onclick={() => (mode = 'file')}
					>File</button>
				<button
					type="button"
					class="pau-utility-button"
					aria-pressed={mode === 'hunk'}
					disabled={chunks.length === 0}
					onclick={() => (mode = 'hunk')}>Hunk</button>
			</div>
			<label class="pau-choice"><input type="checkbox" bind:checked={wrapLines} /><span>Wrap lines</span></label>
		</div>
	</header>

	{#if diff.binary}
		<div class="diff-review__notice" role="status">
			<strong>Binary file</strong>
			<p>Pau cannot display a text diff for this file.</p>
		</div>
	{:else if diff.too_large}
		<div class="diff-review__notice" role="status">
			<strong>Diff is too large</strong>
			<p>This file exceeds the 2 MiB built-in diff limit.</p>
		</div>
	{:else if chunks.length === 0}
		<div class="diff-review__notice" role="status"><p>No text changes to review.</p></div>
	{:else}
		{#if mode === 'hunk' && activeChunk}
			<nav class="diff-review__hunk-nav" aria-label="Diff hunks">
				<button
					type="button"
					class="pau-utility-button"
					aria-label="Previous hunk"
					aria-keyshortcuts="Alt+ArrowUp"
					onkeydown={handleKeydown}
					onclick={() => moveHunk(-1)}>Previous</button>
				<strong>Hunk {currentHunk + 1} of {chunks.length}</strong>
				<code>{hunkLabel(activeChunk)}</code>
				<button
					type="button"
					class="pau-utility-button"
					aria-label="Next hunk"
					aria-keyshortcuts="Alt+ArrowDown"
					onkeydown={handleKeydown}
					onclick={() => moveHunk(1)}>Next</button>
				<button
					type="button"
					class="pau-utility-button"
					aria-pressed={reviewed.has(currentHunk)}
					onclick={toggleReviewed}>
					{reviewed.has(currentHunk) ? 'Reviewed' : 'Mark reviewed'}
				</button>
			</nav>
		{/if}
		<div class="diff-review__code" bind:this={host}></div>
	{/if}
</section>

<style>
	.diff-review {
		display: grid;
		grid-template-rows: auto auto minmax(0, 1fr);
		min-width: 0;
		height: 100%;
		color: var(--pau-text);
		background: var(--pau-canvas);
		outline: none;
	}

	.diff-review:focus-visible {
		box-shadow: inset 0 0 0 var(--pau-focus-width) var(--pau-focus);
	}

	.diff-review__header,
	.diff-review__hunk-nav {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		min-height: var(--pau-size-target-touch);
		padding: var(--pau-space-2) var(--shell-inset, var(--pau-space-4));
		border-bottom: 1px solid var(--pau-border);
		background: var(--pau-surface);
	}

	.diff-review__header {
		justify-content: space-between;
	}

	.diff-review__header p,
	.diff-review__header small,
	.diff-review__notice p {
		margin: 0;
	}

	.diff-review__header p {
		overflow: hidden;
		font: var(--pau-type-xs)/1.35 var(--pau-font-code);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.diff-review__header small {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}

	.diff-review__controls,
	.diff-review__segmented {
		display: flex;
		align-items: center;
		gap: var(--pau-space-1);
	}

	.diff-review__controls label {
		display: flex;
		align-items: center;
		min-height: var(--pau-size-row-sm);
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}

	.diff-review button {
		min-height: var(--pau-size-row-sm);
		padding: var(--pau-space-1) var(--pau-space-2);
		color: var(--pau-text);
		background-color: var(--pau-surface-raised);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		font: inherit;
		cursor: pointer;
	}

	.diff-review button[aria-pressed='true'] {
		border-color: var(--pau-success);
		color: var(--pau-success);
	}

	.diff-review button:focus-visible {
		border-color: var(--pau-focus);
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset-inset);
	}

	.diff-review button:disabled {
		cursor: not-allowed;
	}

	.diff-review__hunk-nav {
		min-width: 0;
		font-size: var(--pau-type-xs);
	}

	.diff-review__hunk-nav code {
		min-width: 0;
		margin-right: auto;
		overflow: hidden;
		color: var(--pau-text-muted);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.diff-review__code {
		min-height: 0;
		overflow: hidden;
		font-size: var(--pau-type-sm);
	}

	.diff-review__code :global(.cm-editor) {
		height: 100%;
	}

	.diff-review__code :global(.cm-scroller) {
		overflow: auto;
	}

	.diff-review__notice {
		align-self: center;
		justify-self: center;
		grid-row: 2 / -1;
		display: grid;
		gap: var(--pau-space-1);
		padding: var(--pau-space-6);
		color: var(--pau-text-muted);
		text-align: center;
	}

	.diff-review__notice strong {
		color: var(--pau-text);
	}

	@media (max-width: 42rem) {
		.diff-review__header {
			align-items: stretch;
			flex-direction: column;
		}

		.diff-review__controls,
		.diff-review__hunk-nav {
			flex-wrap: wrap;
		}
	}

	@media (pointer: coarse) {
		.diff-review button,
		.diff-review__controls label {
			min-height: var(--pau-size-target-touch);
		}
	}
</style>
