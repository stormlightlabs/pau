<script lang="ts">
	import '../styles/tokens.css';
	import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language';
	import { languages } from '@codemirror/language-data';
	import { EditorState, type Extension } from '@codemirror/state';
	import { tags } from '@lezer/highlight';
	import { basicSetup, EditorView } from 'codemirror';
	import { onMount, tick } from 'svelte';

	import type { EditorFileContent, FileEditorSource } from './types/file-editor';

	type Props = { path: string; source: FileEditorSource; line?: number; pollInterval?: number };

	let { path, source, line, pollInterval = 2000 }: Props = $props();
	let host = $state<HTMLElement>();
	let view: EditorView | undefined;
	let file = $state<EditorFileContent>();
	let externalFile = $state<EditorFileContent>();
	let loading = $state(true);
	let saving = $state(false);
	let dirty = $state(false);
	let error = $state('');
	let notice = $state('');

	const syntaxTheme = HighlightStyle.define([
		{ tag: tags.comment, color: 'var(--pau-syntax-comment)' },
		{ tag: [tags.keyword, tags.operatorKeyword], color: 'var(--pau-syntax-keyword)' },
		{ tag: [tags.string, tags.regexp], color: 'var(--pau-syntax-string)' },
		{ tag: [tags.number, tags.bool, tags.null], color: 'var(--pau-syntax-number)' },
		{ tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--pau-syntax-function)' },
		{ tag: [tags.typeName, tags.className], color: 'var(--pau-syntax-type)' },
		{ tag: [tags.variableName, tags.propertyName], color: 'var(--pau-syntax-variable)' },
		{ tag: tags.invalid, color: 'var(--pau-syntax-invalid)', textDecoration: 'underline wavy' }
	]);

	onMount(() => {
		void load();
		const poll = setInterval(() => void checkForExternalChange(), pollInterval);
		return () => {
			clearInterval(poll);
			view?.destroy();
		};
	});

	function errorCode(value: unknown): string | undefined {
		return typeof value === 'object' && value !== null && 'code' in value
			? String((value as { code: unknown }).code)
			: undefined;
	}

	function openError(value: unknown): string {
		switch (errorCode(value)) {
			case 'binary_file': {
				return 'This file contains binary data and cannot be opened in the text editor.';
			}
			case 'file_too_large': {
				return 'This file is larger than the 2 MiB built-in editor limit.';
			}
			case 'invalid_encoding': {
				return 'This file is not valid UTF-8 and cannot be opened in the text editor.';
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
		return description ? description.load() : [];
	}

	function editorTheme(): Extension {
		return EditorView.theme({
			'&': { height: '100%', color: 'var(--pau-text)', backgroundColor: 'var(--pau-canvas)' },
			'.cm-content': { caretColor: 'var(--pau-accent)', fontFamily: 'var(--pau-font-code)' },
			'.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--pau-accent)' },
			'&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
				backgroundColor: 'var(--pau-selection)'
			},
			'.cm-gutters': {
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
		try {
			const opened = await source.read(path);
			loading = false;
			await showFile(opened);
		} catch (caught) {
			error = openError(caught);
			loading = false;
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
				await checkForExternalChange();
				notice = 'The file changed on disk before it could be saved.';
			} else if (errorCode(caught) === 'read_only') {
				notice = 'This file is read-only and cannot be saved.';
			} else {
				notice = caught instanceof Error ? caught.message : 'Pau could not save this file.';
			}
		} finally {
			saving = false;
		}
	}

	function revert(): void {
		if (file) void showFile(file);
	}

	async function checkForExternalChange(): Promise<void> {
		if (!file || loading || saving || externalFile) return;
		try {
			const current = await source.read(path);
			if (current.revision !== file.revision) externalFile = current;
		} catch {
			// The current buffer stays usable while a transient refresh fails.
		}
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
			<button type="button" onclick={() => void checkForExternalChange()} disabled={loading}>Check for changes</button>
			<button type="button" onclick={revert} disabled={!dirty}>Revert</button>
			<button
				class="file-editor__save"
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
				<p>{dirty ? 'Your unsaved changes are still in the editor.' : 'Reload to view the current version.'}</p>
			</div>
			<div>
				{#if dirty}<button type="button" onclick={keepLocalVersion}>Keep my version</button>{/if}
				<button type="button" onclick={() => void showFile(externalFile!)}>Reload from disk</button>
			</div>
		</div>
	{/if}

	{#if loading}
		<p class="file-editor__state" role="status">Opening {path}…</p>
	{:else if error}
		<div class="file-editor__state" role="alert">
			<strong>Cannot open file</strong>
			<p>{error}</p>
			<button type="button" onclick={() => void load()}>Try again</button>
		</div>
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
		min-height: var(--pau-size-target-touch);
		padding: var(--pau-space-1) var(--pau-space-3);
		border-bottom: 1px solid var(--pau-border);
		background: var(--pau-surface);
	}

	.file-editor__header p,
	.file-editor__external p,
	.file-editor__state p {
		margin: 0;
	}

	.file-editor__header > div:first-child {
		min-width: 0;
	}

	.file-editor__header > div:first-child > p {
		overflow: hidden;
		font: var(--pau-type-xs)/1.35 var(--pau-font-code);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-editor__states {
		display: flex;
		gap: var(--pau-space-2);
		min-height: 1rem;
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

	button {
		min-height: var(--pau-size-row-sm);
		padding: var(--pau-space-1) var(--pau-space-2);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		background: var(--pau-surface-raised);
		color: var(--pau-text);
		font: inherit;
		cursor: pointer;
	}

	button:hover:not(:disabled),
	button:focus-visible {
		border-color: var(--pau-focus);
	}

	button:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset-inset);
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.file-editor__save {
		border-color: var(--pau-accent);
		background: var(--pau-accent);
		color: var(--pau-canvas);
		font-weight: var(--pau-weight-semibold);
	}

	.file-editor__external {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--pau-space-4);
		padding: var(--pau-space-2) var(--pau-space-3);
		border-bottom: 1px solid var(--pau-warning);
		background: color-mix(in srgb, var(--pau-warning) 12%, var(--pau-surface));
		font-size: var(--pau-type-xs);
	}

	.file-editor__external p {
		color: var(--pau-text-muted);
	}

	.file-editor__code {
		min-height: 0;
		overflow: hidden;
		font-size: var(--pau-type-sm);
	}

	.file-editor__code :global(.cm-editor) {
		height: 100%;
	}

	.file-editor__code :global(.cm-scroller) {
		overflow: auto;
	}

	.file-editor__state {
		align-self: center;
		justify-self: center;
		display: grid;
		max-width: 32rem;
		gap: var(--pau-space-2);
		padding: var(--pau-space-5);
		text-align: center;
	}

	.file-editor__state p {
		color: var(--pau-text-muted);
	}

	.file-editor__state button {
		justify-self: center;
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

	@media (pointer: coarse) {
		button {
			min-height: var(--pau-size-target-touch);
		}
	}
</style>
