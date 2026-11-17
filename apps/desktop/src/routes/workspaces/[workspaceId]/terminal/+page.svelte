<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { TerminalSurface } from '@stormlightlabs/pau-ui';
	import { onMount } from 'svelte';

	import { listWorkspaces } from '$lib/api';
	import { openFileInEditor, productNavigation } from '$lib/app-navigation';
	import { interfacePreferences } from '$lib/interface-preferences.svelte';
	import { terminalDock } from '$lib/terminal-dock.svelte';
	import { createTerminalFileLinks } from '$lib/terminal-file-links';
	import { createTerminalSource } from '$lib/terminal-source';

	const workspaceId = page.params.workspaceId ?? '';
	const source = createTerminalSource(location.origin, workspaceId);
	const fileLinks = createTerminalFileLinks(workspaceId, (path, line) => openFileInEditor(workspaceId, path, line));

	let disconnected = $state(false);

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
		// The list tells a running backend from one that cannot be reached.
		void listWorkspaces().catch(() => {
			disconnected = true;
		});
	});
</script>

<svelte:head><title>Terminal · Pau</title></svelte:head>

<TerminalSurface
	theme={interfacePreferences.choices.theme}
	uiFont={interfacePreferences.choices.ui_font}
	{source}
	{disconnected}
	{fileLinks}
	onMoveToDock={moveToDock}
	productItems={productNavigation(page.route.id, workspaceId)}
	paneWidths={interfacePreferences.widths}
	onPaneResize={(widths) => interfacePreferences.resize(widths)} />
