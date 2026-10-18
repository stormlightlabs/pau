<script lang="ts">
	import FileEditor from '../lib/FileEditor.svelte';
	import type { EditorFileContent, FileEditorSource } from '../lib/types/file-editor';

	type State = 'default' | 'read-only' | 'binary' | 'oversized' | 'invalid-encoding' | 'external-change' | 'markdown';
	let { state = 'default' }: { state?: State } = $props();

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
	let reads = 0;

	const source: FileEditorSource = {
		read: async () => {
			if (state === 'binary') throw Object.assign(new Error('binary'), { code: 'binary_file' });
			if (state === 'oversized') throw Object.assign(new Error('large'), { code: 'file_too_large' });
			if (state === 'invalid-encoding') throw Object.assign(new Error('encoding'), { code: 'invalid_encoding' });
			if (state === 'markdown') return structuredClone(markdown);
			reads += 1;
			if (state === 'external-change' && reads > 1) {
				return { ...original, content: "export const source = 'external';\n", revision: 'external' };
			}
			return { ...structuredClone(current), writable: state !== 'read-only' };
		},
		write: async (path, content) => {
			current = { path, content, revision: 'saved', writable: true };
			return structuredClone(current);
		}
	};
</script>

<div class="editor-story">
	<FileEditor
		path={state === 'markdown' ? markdown.path : original.path}
		{source}
		pollInterval={60_000}
		onReveal={async () => {}} />
</div>

<style>
	.editor-story {
		width: min(72rem, 100vw);
		height: min(44rem, 100vh);
		border: 1px solid var(--pau-border);
	}
</style>
