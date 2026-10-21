<script lang="ts">
	import FileEditor from '../lib/FileEditor.svelte';
	import type { EditorFileContent, FileEditorSource } from '../lib/types/file-editor';

	type State = 'default' | 'read-only' | 'binary' | 'oversized' | 'invalid-encoding' | 'external-change' | 'markdown';
	let { state: scenario = 'default' }: { state?: State } = $props();

	const original: EditorFileContent = {
		path: 'src/session/state.ts',
		content: `export type SessionState = 'idle' | 'running';\n\nexport const isActive = (state: SessionState) => state === 'running';\n`,
		revision: 'original',
		writable: true
	};
	const markdown: EditorFileContent = {
		path: 'TODO.md',
		content:
			'# Study plan\n\nThree *tracks* run in **parallel**.\n\n> Cards trail the reading.\n\n- [x] Read `ch.1`\n- [ ] See [the guide](https://example.com/guide)\n\n---\n',
		revision: 'markdown',
		writable: true
	};
	let current = structuredClone(original);
	let diskChanges = $state(0);

	const source: FileEditorSource = {
		read: async () => {
			if (scenario === 'binary') throw Object.assign(new Error('binary'), { code: 'binary_file' });
			if (scenario === 'oversized') throw Object.assign(new Error('large'), { code: 'file_too_large' });
			if (scenario === 'invalid-encoding') throw Object.assign(new Error('encoding'), { code: 'invalid_encoding' });
			if (scenario === 'markdown') return structuredClone(markdown);
			return { ...structuredClone(current), writable: scenario !== 'read-only' };
		},
		write: async (path, content) => {
			current = { path, content, revision: 'saved', writable: true };
			return structuredClone(current);
		}
	};

	/** Stands in for the workspace watcher reporting an edit made outside Pau. */
	function changeOnDisk(): void {
		const count = diskChanges + 1;
		current = { ...original, content: `export const source = 'external ${count}';\n`, revision: `external-${count}` };
		diskChanges = count;
	}
</script>

{#if scenario === 'external-change'}
	<button class="editor-story__simulate" type="button" onclick={changeOnDisk}>Change the file on disk</button>
{/if}
<div class="editor-story">
	<FileEditor
		path={scenario === 'markdown' ? markdown.path : original.path}
		{source}
		{diskChanges}
		onReveal={async () => {}} />
</div>

<style>
	.editor-story {
		width: min(72rem, 100vw);
		height: min(44rem, 100vh);
		border: 1px solid var(--pau-border);
	}

	.editor-story__simulate {
		margin: var(--pau-space-2);
	}
</style>
