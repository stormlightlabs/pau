<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { TerminalSurface } from '@stormlightlabs/pau-ui';
	import { onMount } from 'svelte';

	import { listWorkspaces } from '$lib/api';
	import { openFileQuery, productNavigation } from '$lib/app-navigation';
	import { interfacePreferences } from '$lib/interface-preferences.svelte';
	import { terminalDock } from '$lib/terminal-dock.svelte';
	import { createTerminalFileLinks } from '$lib/terminal-file-links';
	import { createTerminalSource } from '$lib/terminal-source';

	const workspaceId = page.params.workspaceId ?? '';
	const source = createTerminalSource(location.origin, workspaceId);
	const fileLinks = createTerminalFileLinks(workspaceId, openFile);

	let workspaceName = $state(workspaceId);
	let disconnected = $state(false);

	function openFile(path: string, line?: number): void {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- the route is resolved; only the query is added
		void goto(resolve('/workspaces/[workspaceId]/editor', { workspaceId }) + openFileQuery(path, line));
	}

	/** Opens the dock under the session last shown in this workspace, or under the session list. */
	function moveToDock(): void {
		terminalDock.open = true;
		const session = terminalDock.session;
		void goto(
			session?.workspaceId === workspaceId
				? resolve('/workspaces/[workspaceId]/sessions/[sessionId]', session)
				: resolve('/')
		);
	}

	onMount(() => {
		void listWorkspaces()
			.then((workspaces) => {
				const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
				workspaceName = workspace?.name || workspace?.path.split(/[\\/]/).at(-1) || workspaceId;
			})
			.catch(() => {
				disconnected = true;
			});
	});
</script>

<svelte:head><title>Terminal · Pau</title></svelte:head>

<TerminalSurface
	theme={interfacePreferences.choices.theme}
	uiFont={interfacePreferences.choices.ui_font}
	{workspaceName}
	{source}
	{disconnected}
	{fileLinks}
	onMoveToDock={moveToDock}
	productItems={productNavigation(page.route.id, workspaceId)}
	paneWidths={interfacePreferences.widths}
	onPaneResize={(widths) => interfacePreferences.resize(widths)} />
