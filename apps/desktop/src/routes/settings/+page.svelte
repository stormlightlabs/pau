<script lang="ts">
	import { ApplicationShell, SETTINGS_SECTIONS, SettingsView } from '@stormlightlabs/pau-ui';
	import { onMount } from 'svelte';
	import { page } from '$app/state';

	import { listWorkspaces } from '$lib/api';
	import { productNavigation } from '$lib/app-navigation';
	import { interfacePreferences } from '$lib/interface-preferences.svelte';

	/** The workspace that the rail's workspace views open. Settings has none of its own, so it uses the first. */
	let workspaceId = $state<string>();

	const sectionItems = SETTINGS_SECTIONS.map((section) => ({
		id: section.id,
		label: section.label,
		href: `#settings-${section.id}`
	}));

	onMount(() => {
		void listWorkspaces()
			.then((workspaces) => (workspaceId = workspaces[0]?.id))
			.catch(() => {});
	});
</script>

<svelte:head><title>Settings · Pau</title></svelte:head>

<ApplicationShell
	workspaceName="Settings"
	contextLabel="Sections"
	productItems={productNavigation(page.route.id, workspaceId)}
	contextItems={sectionItems}>
	<SettingsView
		motion={interfacePreferences.motion}
		onMotionChange={(value) => interfacePreferences.setMotion(value)} />
</ApplicationShell>
