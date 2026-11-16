<script lang="ts">
	import '../styles/tokens.css';
	import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language';
	import { languages } from '@codemirror/language-data';
	import { EditorState, type Extension } from '@codemirror/state';
	import { tags } from '@lezer/highlight';
	import { basicSetup, EditorView } from 'codemirror';
	import { onDestroy, onMount, tick, untrack } from 'svelte';

	import { revealLabel } from './context-menu';
	import { sectionFolding } from './editor-folding';
	import { BusyIndicator } from './busy-indicator.svelte';
	import EmptyState from './EmptyState.svelte';
	import type { EditorFileContent, FileEditorSource } from './types/file-editor';

	type Props = {
		path: string;
		source: FileEditorSource;
		line?: number;
		/**
		 * Counts the times the workspace watcher reported this file changed on
		 * disk. Each new count reads the file again: a clean buffer reloads in
		 * place, and an edited one keeps the operator's text and offers Reload
		 * or Keep mine.
		 */
		diskChanges?: number;
		/**
		 * Shows the file in the system file manager. Files the editor can never
		 * open offer it in place of a retry. Omit it when the app cannot reveal
		 * paths.
		 */
		onReveal?: () => Promise<void>;
	};

	let { path, source, line, diskChanges = 0, onReveal }: Props = $props();
	let host = $state<HTMLElement>();
	let view: EditorView | undefined;
	let file = $state<EditorFileContent>();
	let externalFile = $state<EditorFileContent>();
	let loading = $state(true);
	const opening = new BusyIndicator(() => loading);
	let saving = $state(false);
	let dirty = $state(false);
	let error = $state('');
	/** False when reading again cannot succeed, such as a binary or oversized file. */
	let retryable = $state(true);
	let revealFailed = $state(false);
	let notice = $state('');
	/** A change reported during a save, read again once the save settles. */
	let changedWhileSaving = false;
	let seenDiskChanges = untrack(() => diskChanges);

	const syntaxTheme = HighlightStyle.define([
		{ tag: tags.comment, color: 'var(--pau-syntax-comment)' },
		{ tag: [tags.keyword, tags.operatorKeyword], color: 'var(--pau-syntax-keyword)' },
		{ tag: [tags.string, tags.regexp], color: 'var(--pau-syntax-string)' },
		{ tag: [tags.number, tags.bool, tags.null], color: 'var(--pau-syntax-number)' },
		{ tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--pau-syntax-function)' },
		{ tag: [tags.typeName, tags.className], color: 'var(--pau-syntax-type)' },
		{ tag: [tags.variableName, tags.propertyName], color: 'var(--pau-syntax-variable)' },
		{ tag: tags.invalid, color: 'var(--pau-syntax-invalid)', textDecoration: 'underline wavy' },
		// Markdown. Markers such as `#`, `-`, `>` and backticks are processing instructions.
		{ tag: tags.heading, color: 'var(--pau-syntax-function)', fontWeight: 'var(--pau-weight-semibold)' },
		{ tag: tags.strong, fontWeight: 'var(--pau-weight-semibold)' },
		{ tag: tags.emphasis, fontStyle: 'italic' },
		{ tag: tags.strikethrough, textDecoration: 'line-through' },
		{ tag: tags.link, color: 'var(--pau-syntax-type)' },
		{ tag: tags.url, color: 'var(--pau-syntax-type)', textDecoration: 'underline' },
		{ tag: tags.monospace, color: 'var(--pau-syntax-string)' },
		{ tag: [tags.quote, tags.list], color: 'var(--pau-syntax-keyword)' },
		{ tag: [tags.contentSeparator, tags.processingInstruction, tags.meta], color: 'var(--pau-syntax-comment)' },
		// Markup and stylesheets.
		{ tag: tags.tagName, color: 'var(--pau-syntax-keyword)' },
		{ tag: tags.attributeName, color: 'var(--pau-syntax-type)' },
		{ tag: tags.attributeValue, color: 'var(--pau-syntax-string)' },
		{ tag: tags.labelName, color: 'var(--pau-syntax-variable)' },
		{ tag: tags.special(tags.string), color: 'var(--pau-syntax-number)' },
		{ tag: [tags.angleBracket, tags.punctuation], color: 'var(--pau-text-muted)' }
	]);

	onMount(() => void load());
	onDestroy(() => view?.destroy());

	$effect(() => {
		if (diskChanges === seenDiskChanges) return;
		seenDiskChanges = diskChanges;
		void untrack(followDiskChange);
	});

	function errorCode(value: unknown): string | undefined {
		return typeof value === 'object' && value !== null && 'code' in value
			? String((value as { code: unknown }).code)
			: undefined;
	}

	/** Open errors that come from the file itself, so a second read fails the same way. */
	const permanentErrors = new Set(['binary_file', 'file_too_large', 'invalid_encoding']);

	function openError(value: unknown): string {
		switch (errorCode(value)) {
			case 'binary_file': {
				return 'Pau found binary data in this file, so the text editor cannot open it.';
			}
			case 'file_too_large': {
				return 'This file is larger than 2 MiB, the most the text editor opens.';
			}
			case 'invalid_encoding': {
				return 'This file is not valid UTF-8, so the text editor cannot open it.';
			}
			case 'permission_denied': {
				return 'Pau cannot read this file. Check its file permissions and try again.';
			}
			default: {
				return value instanceof Error ? value.message : 'Pau could not open this file.';
			}
		}
	}

	async function language(pathname: string): Promise<Extension> {
		const extension = pathname.split('.').at(-1)?.toLowerCase();
		const fallback = extension === 'svelte' ? 'HTML' : extension === 'mdx' ? 'Markdown' : undefined;
		const description =
			LanguageDescription.matchFilename(languages, pathname) ??
			(fallback ? LanguageDescription.matchLanguageName(languages, fallback) : null);
		return description ? sectionFolding(await description.load()) : [];
	}

	function editorTheme(): Extension {
		return EditorView.theme({
			'&': { height: '100%', color: 'var(--pau-text)', backgroundColor: 'var(--pau-canvas)' },
			'.cm-scroller': { alignItems: 'stretch', overflow: 'auto' },
			'.cm-content': { fontFamily: 'var(--pau-font-code)', fontVariantLigatures: 'none' },
			// The editor hides the native caret and draws this cursor instead.
			'.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--pau-focus)' },
			'&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
				backgroundColor: 'var(--pau-selection)'
			},
			'.cm-gutters': {
				minHeight: '100%',
				backgroundColor: 'var(--pau-surface)',
				color: 'var(--pau-text-muted)',
				borderRight: '1px solid var(--pau-border)'
			},
			'.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--pau-surface-raised) 20%, var(--pau-canvas))' },
			'.cm-activeLineGutter': { backgroundColor: 'var(--pau-surface-raised)' },
			'&.cm-focused': { outline: 'none' }
		});
	}

	async function showFile(next: EditorFileContent): Promise<void> {
		file = next;
		externalFile = undefined;
		dirty = false;
		notice = '';
		await tick();
		if (!host) return;
		view?.destroy();
		const languageSupport = await language(path);
		const state = EditorState.create({
			doc: next.content,
			selection:
				line && line <= next.content.split('\n').length ? { anchor: lineStart(next.content, line) } : undefined,
			extensions: [
				basicSetup,
				languageSupport,
				editorTheme(),
				syntaxHighlighting(syntaxTheme),
				EditorState.readOnly.of(!next.writable),
				EditorView.editable.of(next.writable),
				EditorView.contentAttributes.of({ 'aria-label': `${path} editor` }),
				EditorView.updateListener.of((update) => {
					if (file && update.docChanged) dirty = update.state.doc.toString() !== file.content;
				})
			]
		});
		view = new EditorView({ state, parent: host });
		view.scrollDOM.tabIndex = 0;
		view.scrollDOM.setAttribute('aria-label', `${path} editor scroll area`);
		view.focus();
		if (line) view.dispatch({ effects: EditorView.scrollIntoView(state.selection.main, { y: 'center' }) });
	}

	function lineStart(content: string, target: number): number {
		let offset = 0;
		for (let current = 1; current < target; current += 1) offset = content.indexOf('\n', offset) + 1;
		return Math.max(0, offset);
	}

	async function load(): Promise<void> {
		loading = true;
		error = '';
		revealFailed = false;
		try {
			const opened = await source.read(path);
			loading = false;
			// The editor mounts where the indicator was, so it waits for the indicator to go.
			await opening.hidden();
			await showFile(opened);
		} catch (caught) {
			error = openError(caught);
			retryable = !permanentErrors.has(errorCode(caught) ?? '');
			loading = false;
		}
	}

	async function reveal(): Promise<void> {
		revealFailed = false;
		try {
			await onReveal?.();
		} catch {
			revealFailed = true;
		}
	}

	async function save(): Promise<void> {
		if (!file || !view || !dirty || !file.writable) return;
		saving = true;
		notice = '';
		try {
			const saved = await source.write(path, view.state.doc.toString(), file.revision);
			file = saved;
			dirty = false;
			externalFile = undefined;
			notice = 'Saved';
		} catch (caught) {
			if (errorCode(caught) === 'file_changed') {
				await followDiskChange();
				notice = 'The file changed on disk before it could be saved.';
			} else if (errorCode(caught) === 'read_only') {
				notice = 'This file is read-only and cannot be saved.';
			} else {
				notice = caught instanceof Error ? caught.message : 'Pau could not save this file.';
			}
		} finally {
			saving = false;
			if (changedWhileSaving) {
				changedWhileSaving = false;
				void followDiskChange();
			}
		}
	}

	function revert(): void {
		// Discarding edits shows the newest version, including one that changed on disk meanwhile.
		const latest = externalFile ?? file;
		if (latest) void showFile(latest);
	}

	/**
	 * Reads the file after it changed on disk. A clean buffer takes the new
	 * text in place, keeping the cursor and scroll position. An edited buffer
	 * stays as it is, and the newest disk version waits behind the notice.
	 */
	async function followDiskChange(): Promise<void> {
		if (!file || loading) return;
		if (saving) {
			changedWhileSaving = true;
			return;
		}
		let current: EditorFileContent;
		try {
			current = await source.read(path);
		} catch {
			// The buffer stays usable when the file vanished or a read failed.
			return;
		}
		if (current.revision === file.revision) {
			externalFile = undefined;
			return;
		}
		if (dirty) externalFile = current;
		else if (view && current.writable === file.writable) reloadInPlace(current);
		else await showFile(current);
	}

	function reloadInPlace(next: EditorFileContent): void {
		if (!view) return;
		const { scrollTop } = view.scrollDOM;
		const anchor = Math.min(view.state.selection.main.head, next.content.length);
		file = next;
		externalFile = undefined;
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next.content }, selection: { anchor } });
		view.scrollDOM.scrollTop = scrollTop;
	}

	function keepLocalVersion(): void {
		if (!file || !externalFile) return;
		file = { ...file, revision: externalFile.revision, writable: externalFile.writable };
		externalFile = undefined;
		notice = 'Your version is unchanged. Saving will replace the version on disk.';
	}
</script>

<section class="file-editor" aria-label={`Editor for ${path}`}>
	<header class="file-editor__header">
		<div>
			<p>{path}</p>
			<div class="file-editor__states" aria-live="polite">
				{#if dirty}<span class="file-editor__dirty">Unsaved changes</span>{/if}
				{#if file && !file.writable}<span>Read-only</span>{/if}
				{#if notice}<span>{notice}</span>{/if}
			</div>
		</div>
		<div class="file-editor__actions">
			<button class="pau-button pau-button--secondary" type="button" onclick={revert} disabled={!dirty}>Revert</button>
			<button
				class="pau-button pau-button--primary"
				type="button"
				onclick={() => void save()}
				disabled={!dirty || saving || !file?.writable}>
				{saving ? 'Saving…' : 'Save'}
			</button>
		</div>
	</header>

	{#if externalFile}
		<div class="file-editor__external" role="alert">
			<div>
				<strong>File changed on disk</strong>
				<p>Your unsaved changes are still in the editor.</p>
			</div>
			<div>
				<button class="pau-button pau-button--secondary" type="button" onclick={keepLocalVersion}>Keep mine</button>
				<button class="pau-button pau-button--secondary" type="button" onclick={() => void showFile(externalFile!)}
					>Reload</button>
			</div>
		</div>
	{/if}

	{#if opening.active}
		{#if opening.visible}<p class="file-editor__state" role="status">Opening {path}…</p>{/if}
	{:else if error}
		<EmptyState role="alert" title="Cannot open file">
			<p>{error}</p>
			{#if revealFailed}<p>Pau could not show this file in the file manager.</p>{/if}
			{#if retryable}
				<button
					class="pau-button pau-button--primary file-editor__state-action"
					type="button"
					onclick={() => void load()}>Try again</button>
			{:else if onReveal}
				<button
					class="pau-button pau-button--primary file-editor__state-action"
					type="button"
					onclick={() => void reveal()}>{revealLabel()}</button>
			{/if}
		</EmptyState>
	{:else}
		<div class="file-editor__code" bind:this={host}></div>
	{/if}
</section>

<style>
	.file-editor {
		display: grid;
		grid-template-rows: auto auto minmax(0, 1fr);
		min-width: 0;
		height: 100%;
		background: var(--pau-canvas);
		color: var(--pau-text);
	}

	.file-editor__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--pau-space-3);
		min-height: var(--pau-size-row-lg);
		padding: var(--pau-space-1) var(--file-editor-inset);
		border-bottom: 1px solid var(--pau-border);
		background: var(--pau-surface);
	}

	.file-editor__header p,
	.file-editor__external p {
		margin: 0;
	}

	/* The file states follow the name on its line, so the name keeps the actions' center line. */
	.file-editor__header > div:first-child {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		column-gap: var(--pau-space-3);
		min-width: 0;
	}

	.file-editor__header > div:first-child > p {
		min-width: 0;
		overflow: hidden;
		font: var(--pau-type-xs)/1.35 var(--pau-font-code);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-editor__states {
		display: flex;
		gap: var(--pau-space-2);
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}

	.file-editor__dirty {
		color: var(--pau-warning);
	}

	.file-editor__actions,
	.file-editor__external > div:last-child {
		display: flex;
		flex: none;
		gap: var(--pau-space-1);
	}

	button:focus-visible {
		outline-offset: var(--pau-focus-offset-inset);
	}

	.file-editor__external {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--pau-space-4);
		padding: var(--pau-space-2) var(--file-editor-inset);
		border-bottom: 1px solid var(--pau-warning);
		background: color-mix(in srgb, var(--pau-warning) 12%, var(--pau-surface));
		font-size: var(--pau-type-xs);
	}

	.file-editor__external p {
		color: var(--pau-text-muted);
	}

	/* The changed-on-disk notice is optional, so pin the body to the flexible row. */
	.file-editor__code,
	.file-editor__state,
	.file-editor > :global(.empty-state) {
		grid-row: 3;
	}

	/*
	 * Bars and blocked states start on the shell's inset, under the view title,
	 * and blocked states sit at the top like every other empty state.
	 */
	.file-editor {
		--file-editor-inset: var(--shell-inset, var(--pau-space-4));
		--empty-state-inset: var(--file-editor-inset);
	}

	.file-editor__code {
		min-height: 0;
		overflow: hidden;
		background: var(--pau-canvas);
		font-size: var(--pau-type-sm);
	}

	.file-editor__code :global(.cm-editor) {
		height: 100%;
	}

	.file-editor__code :global(.cm-scroller) {
		overflow: auto;
	}

	.file-editor__state {
		align-self: start;
		margin: 0;
		padding: var(--pau-space-5) var(--empty-state-inset);
		color: var(--pau-text-muted);
	}

	.file-editor__state-action {
		margin-top: var(--pau-space-4);
	}

	@media (max-width: 42rem) {
		.file-editor__header,
		.file-editor__external {
			align-items: stretch;
			flex-direction: column;
		}

		.file-editor__actions,
		.file-editor__external > div:last-child {
			flex-wrap: wrap;
		}
	}
</style>
