<script lang="ts">
	import {
		WorkspaceFiles,
		type FileEditorSource,
		type ShellNavItem,
		type WorkspaceFileSource
	} from '@stormlightlabs/pau-ui';
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

	let { workspaceId, productItems }: { workspaceId: string; productItems?: ShellNavItem[] } = $props();

	let resolvedWorkspaceName = $state<string>();
	let workspaceName = $derived(resolvedWorkspaceName ?? workspaceId);
	let disconnected = $state(false);
	const source: WorkspaceFileSource = {
		listDirectory: (path, options) => listWorkspaceFiles(workspaceId, path, options),
		search: (query, options) => searchWorkspaceFiles(workspaceId, query, options),
		gitStatus: () => getWorkspaceGitStatus(workspaceId),
		gitDiff: (path) => getWorkspaceGitDiff(workspaceId, path)
	};
	const editorSource: FileEditorSource = {
		read: (path) => readWorkspaceFile(workspaceId, path),
		write: (path, content, revision) => writeWorkspaceFile(workspaceId, path, content, revision)
	};

	onMount(() => {
		void listWorkspaces()
			.then((workspaces) => {
				const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
				resolvedWorkspaceName = workspace?.name || workspace?.path.split(/[\\/]/).at(-1) || workspaceId;
			})
			.catch(() => {
				disconnected = true;
			});
	});
</script>

<WorkspaceFiles {workspaceId} {workspaceName} {source} {editorSource} {disconnected} {productItems} />
