<script lang="ts">
	import {
		ApplicationShell,
		getKeymap,
		SETTINGS_SECTIONS,
		SettingsView,
		type SettingsChoices
	} from '@stormlightlabs/pau-ui';
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

	const keymap = getKeymap();
	const choices = $derived(interfacePreferences.choices);

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
	productItems={productNavigation(page.route.id, workspaceId)}
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
		platform={keymap?.platform ?? 'other'} />
</ApplicationShell>
