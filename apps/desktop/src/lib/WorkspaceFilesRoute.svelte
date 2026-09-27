<script lang="ts">
	import { WorkspaceFiles, type FileEditorSource, type WorkspaceFileSource } from '@stormlightlabs/pau-ui';
	import { onMount } from 'svelte';

	import {
		getWorkspaceGitDiff,
		getWorkspaceGitStatus,
		listWorkspaceFiles,
		listWorkspaces,
		readWorkspaceFile,
		searchWorkspaceFiles,
		writeWorkspaceFile
	} from './api';

	let { workspaceId }: { workspaceId: string } = $props();

	let resolvedWorkspaceName = $state<string>();
	let workspaceName = $derived(resolvedWorkspaceName ?? workspaceId);
	let disconnected = $state(false);
	const source: WorkspaceFileSource = {
		listDirectory: (path, options) => listWorkspaceFiles(location.search, workspaceId, path, options),
		search: (query, options) => searchWorkspaceFiles(location.search, workspaceId, query, options),
		gitStatus: () => getWorkspaceGitStatus(location.search, workspaceId),
		gitDiff: (path) => getWorkspaceGitDiff(location.search, workspaceId, path)
	};
	const editorSource: FileEditorSource = {
		read: (path) => readWorkspaceFile(location.search, workspaceId, path),
		write: (path, content, revision) => writeWorkspaceFile(location.search, workspaceId, path, content, revision)
	};

	onMount(() => {
		void listWorkspaces(location.search)
			.then((workspaces) => {
				const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
				resolvedWorkspaceName = workspace?.name || workspace?.path.split(/[\\/]/).at(-1) || workspaceId;
			})
			.catch(() => {
				disconnected = true;
			});
	});
</script>

<WorkspaceFiles {workspaceId} {workspaceName} {source} {editorSource} {disconnected} />
