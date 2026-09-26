<script lang="ts">
	import FileEditor from '../lib/FileEditor.svelte';
	import type { EditorFileContent, FileEditorSource } from '../lib/types/file-editor';

	type State = 'default' | 'read-only' | 'binary' | 'oversized' | 'invalid-encoding' | 'external-change';
	let { state = 'default' }: { state?: State } = $props();

	const original: EditorFileContent = {
		path: 'src/session/state.ts',
		content: `export type SessionState = 'idle' | 'running';\n\nexport const isActive = (state: SessionState) => state === 'running';\n`,
		revision: 'original',
		writable: true
	};
	let current = structuredClone(original);
	let reads = 0;

	const source: FileEditorSource = {
		read: async () => {
			if (state === 'binary') throw Object.assign(new Error('binary'), { code: 'binary_file' });
			if (state === 'oversized') throw Object.assign(new Error('large'), { code: 'file_too_large' });
			if (state === 'invalid-encoding') throw Object.assign(new Error('encoding'), { code: 'invalid_encoding' });
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
	<FileEditor path={original.path} {source} pollInterval={60_000} />
</div>

<style>
	.editor-story {
		width: min(72rem, 100vw);
		height: min(44rem, 100vh);
		border: 1px solid var(--pau-border);
	}
</style>
