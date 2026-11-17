<script lang="ts">
	import {
		RESOURCE_KIND_LABELS,
		ResourceBrowser,
		resourceKindFromSegment,
		type ResourceIndex,
		type ResourceKind
	} from '@stormlightlabs/pau-ui';
	import { page } from '$app/state';

	import { getWorkspaceResources } from '$lib/api';
	import { productNavigation } from '$lib/app-navigation';
	import { interfacePreferences } from '$lib/interface-preferences.svelte';

	let workspaceId = $derived(page.params.workspaceId ?? '');
	let kind = $derived(resourceKindFromSegment(page.params.kind));
	let index = $state<ResourceIndex>();
	let error = $state<string>();

	/** Reads the index again. A reply for a workspace that is no longer open is dropped. */
	async function load(id: string): Promise<void> {
		error = undefined;
		try {
			const loaded = await getWorkspaceResources(id);
			if (id === workspaceId) index = loaded;
		} catch (reason) {
			if (id !== workspaceId) return;
			index = undefined;
			error = reason instanceof Error ? reason.message : 'The resource list could not be read.';
		}
	}

	$effect(() => {
		const id = workspaceId;
		index = undefined;
		void load(id);
	});

	function kindHref(target: ResourceKind): string {
		return `/workspaces/${encodeURIComponent(workspaceId)}/resources/${target}s`;
	}
</script>

<svelte:head><title>{RESOURCE_KIND_LABELS[kind]} · Pau</title></svelte:head>

<ResourceBrowser
	theme={interfacePreferences.choices.theme}
	uiFont={interfacePreferences.choices.ui_font}
	{kind}
	{kindHref}
	{index}
	{error}
	onRetry={() => void load(workspaceId)}
	productItems={productNavigation(page.route.id, workspaceId)}
	paneWidths={interfacePreferences.widths}
	onPaneResize={(widths) => interfacePreferences.resize(widths)} />
