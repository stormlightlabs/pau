<script lang="ts">
	import { ApplicationShell, ProcessesView } from '@stormlightlabs/pau-ui';
	import { page } from '$app/state';

	import { productNavigation } from '$lib/app-navigation';
	import { interfacePreferences } from '$lib/interface-preferences.svelte';

	let workspaceId = $derived(page.params.workspaceId ?? '');
</script>

<svelte:head><title>Processes · Pau</title></svelte:head>

<!-- The server does not report process resource use yet, so the view says so instead of listing sample data. -->
<ApplicationShell
	theme={interfacePreferences.choices.theme}
	uiFont={interfacePreferences.choices.ui_font}
	contextLabel="Processes"
	productItems={productNavigation(page.route.id, workspaceId)}
	contextItems={[]}>
	<ProcessesView
		processes={[]}
		unavailable="Pau doesn't collect resource use for workspace processes yet. Sessions and terminals keep running as usual." />
</ApplicationShell>
