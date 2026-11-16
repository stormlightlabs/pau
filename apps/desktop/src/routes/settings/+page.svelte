<script lang="ts">
	import {
		ApplicationShell,
		getKeymap,
		SETTINGS_SECTIONS,
		SettingsView,
		type SettingsChoices
	} from '@stormlightlabs/pau-ui';
	import { getContext, onMount } from 'svelte';
	import { page } from '$app/state';

	import { listWorkspaces } from '$lib/api';
	import { productNavigation } from '$lib/app-navigation';
	import { interfacePreferences } from '$lib/interface-preferences.svelte';
	import { liveSessionsContext, type LiveSessions } from '$lib/live-sessions.svelte';

	/** The workspace that the rail's workspace views open. Settings has none of its own, so it uses the first. */
	let workspaceId = $state<string>();

	const sectionItems = SETTINGS_SECTIONS.map((section) => ({
		id: section.id,
		label: section.label,
		href: `#settings-${section.id}`
	}));

	const keymap = getKeymap();
	const choices = $derived(interfacePreferences.choices);
	const views = $derived(productNavigation(page.route.id, workspaceId));
	/** The layout's sessions, whose workspaces carry each one's sandbox summary. */
	const sessions = getContext<LiveSessions | undefined>(liveSessionsContext);
	/** The Sandbox section's summary of the workspace that the workspace views open, and its Agent sandbox link. */
	const sandbox = $derived.by(() => {
		const href = views.find((view) => view.id === 'sandbox')?.href;
		const workspace = sessions?.workspaces.find((candidate) => candidate.id === workspaceId);
		if (!href || !workspaceId) return;
		return { workspace: workspace?.name ?? workspaceId, summary: workspace?.sandbox?.label, href };
	});

	/** Settings names the font `uiFont`; the stored document names it `ui_font`. */
	function change<K extends keyof SettingsChoices>(key: K, value: SettingsChoices[K]): Promise<void> {
		const { uiFont, ...rest }: Partial<SettingsChoices> = { [key]: value };
		return interfacePreferences.choose(uiFont ? { ...rest, ui_font: uiFont } : rest);
	}

	onMount(() => {
		void listWorkspaces()
			.then((workspaces) => (workspaceId = workspaces[0]?.id))
			.catch(() => {});
	});
</script>

<svelte:head><title>Settings · Pau</title></svelte:head>

<ApplicationShell
	contextLabel="Sections"
	productItems={views}
	contextItems={sectionItems}
	theme={choices.theme}
	uiFont={choices.ui_font}>
	<SettingsView
		theme={choices.theme}
		uiFont={choices.ui_font}
		notifications={choices.notifications}
		motion={choices.motion}
		onChange={change}
		shortcuts={keymap?.actions ?? []}
		platform={keymap?.platform ?? 'other'}
		{sandbox}
		diagnosticsHref={views.find((view) => view.id === 'diagnostics')?.href} />
</ApplicationShell>
