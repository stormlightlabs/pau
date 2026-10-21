<script lang="ts">
	import {
		WorkspaceFiles,
		type FileEditorSource,
		type ShellNavItem,
		type WorkspaceFileChanges,
		type WorkspaceFileSource
	} from '@stormlightlabs/pau-ui';
	import { getContext, onMount } from 'svelte';

	import {
		getWorkspaceGitDiff,
		getWorkspaceGitStatus,
		listWorkspaceFiles,
		listWorkspaces,
		readWorkspaceFile,
		searchWorkspaceFiles,
		writeWorkspaceFile
	} from './api';
	import { EventStreamClient } from './event-stream';
	import { desktopNativeCapabilitiesContext, type DesktopNativeCapabilities } from './native-capabilities';
	import { interfacePreferences } from './interface-preferences.svelte';

	let { workspaceId, productItems }: { workspaceId: string; productItems?: ShellNavItem[] } = $props();

	let resolvedWorkspaceName = $state<string>();
	let workspacePath = $state<string>();
	const native = getContext<DesktopNativeCapabilities | undefined>(desktopNativeCapabilitiesContext);
	let workspaceName = $derived(resolvedWorkspaceName ?? workspaceId);
	let disconnected = $state(false);
	const source: WorkspaceFileSource = {
		listDirectory: (path, options) => listWorkspaceFiles(workspaceId, path, options),
		search: (query, options) => searchWorkspaceFiles(workspaceId, query, options),
		gitStatus: () => getWorkspaceGitStatus(workspaceId),
		gitDiff: (path) => getWorkspaceGitDiff(workspaceId, path),
		watch: (onChange) => {
			const stream = new EventStreamClient({
				browserOrigin: location.origin,
				watch: workspaceId,
				onState: (_state, event) => {
					if (event?.kind === 'workspace_files_changed' && event.workspace_id === workspaceId) {
						onChange(JSON.parse(event.payload) as WorkspaceFileChanges);
					}
				},
				// Changes made while the stream was down, or before the watch started, have no event.
				onConnectionChange: (connected) => {
					if (connected) onChange({ paths: [], git: true, truncated: true });
				}
			});
			stream.connect();
			return () => stream.stop();
		}
	};
	const editorSource: FileEditorSource = {
		read: (path) => readWorkspaceFile(workspaceId, path),
		write: (path, content, revision) => writeWorkspaceFile(workspaceId, path, content, revision)
	};

	onMount(() => {
		void listWorkspaces()
			.then((workspaces) => {
				const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
				workspacePath = workspace?.path;
				resolvedWorkspaceName = workspace?.name || workspace?.path.split(/[\\/]/).at(-1) || workspaceId;
			})
			.catch(() => {
				disconnected = true;
			});
	});
</script>

<WorkspaceFiles
	{workspaceId}
	{workspaceName}
	{source}
	{editorSource}
	{disconnected}
	{productItems}
	{workspacePath}
	revealPath={native?.revealPath}
	paneWidths={interfacePreferences.widths}
	onPaneResize={(widths) => interfacePreferences.resize(widths)} />
