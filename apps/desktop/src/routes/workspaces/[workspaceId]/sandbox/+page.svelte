<script lang="ts" module>
	function message(caught: unknown): string {
		return caught instanceof Error ? caught.message : String(caught);
	}
</script>

<script lang="ts">
	import type { SandboxAdapter } from '@stormlightlabs/pau-protocol';
	import {
		ApplicationShell,
		SandboxSettingsView,
		Select,
		type EffectiveSandboxView,
		type SelectOption,
		type SandboxSelectionModel
	} from '@stormlightlabs/pau-ui';
	import { onMount } from 'svelte';
	import { page } from '$app/state';

	import { getWorkspaceSandbox, listWorkspaces, previewSandbox, updateWorkspaceSandbox } from '$lib/api';
	import { productNavigation } from '$lib/app-navigation';
	import { effectiveView, selectionView, selectionWire } from '$lib/sandbox-model';

	const PREVIEW_DELAY_MS = 250;
	const agentOptions: SelectOption<SandboxAdapter>[] = [
		{ value: 'pi', label: 'Pi' },
		{ value: 'claude', label: 'Claude' }
	];

	let workspaceId = $derived(page.params.workspaceId ?? '');
	let selection = $state<SandboxSelectionModel>();
	let draft = $state<SandboxSelectionModel>();
	let adapter = $state<SandboxAdapter>('pi');
	let effective = $state<EffectiveSandboxView>();
	let unavailable = $state<string>();
	let error = $state<string>();
	let notice = $state<string>();
	let saving = $state(false);
	let workspaceName = $state<string>();
	let previewTimer: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
		void listWorkspaces()
			.then((workspaces) => {
				const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
				workspaceName = workspace?.name || workspace?.path.split(/[\\/]/).at(-1);
			})
			.catch(() => {});
		void getWorkspaceSandbox(workspaceId)
			.then((stored) => {
				selection = selectionView(stored.selection);
				draft = selection;
				unavailable = stored.unavailable ?? undefined;
				void preview();
			})
			.catch((caught: unknown) => (error = message(caught)));
		return stopPreview;
	});

	function stopPreview(): void {
		clearTimeout(previewTimer);
	}

	/** Describes the draft before it is saved, so the operator sees what a launch enforces. */
	async function preview(): Promise<void> {
		if (!draft) return;
		const requested = draft;
		try {
			const described = await previewSandbox(workspaceId, adapter, selectionWire(requested));
			if (requested !== draft) return;
			effective = described ? effectiveView(described) : undefined;
			error = undefined;
		} catch (caught) {
			effective = undefined;
			error = message(caught);
		}
	}

	function change(next: SandboxSelectionModel): void {
		draft = next;
		notice = undefined;
		stopPreview();
		previewTimer = setTimeout(() => void preview(), PREVIEW_DELAY_MS);
	}

	async function save(next: SandboxSelectionModel): Promise<void> {
		saving = true;
		error = undefined;
		notice = undefined;
		try {
			const stored = await updateWorkspaceSandbox(workspaceId, selectionWire(next));
			draft = selectionView(stored.selection);
			notice = 'New agent sessions in this workspace use this setting.';
		} catch (caught) {
			error = message(caught);
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>Agent sandbox · Pau</title></svelte:head>

<ApplicationShell
	workspaceName={workspaceName ?? workspaceId}
	contextLabel="Agent sandbox"
	productItems={productNavigation(page.route.id, workspaceId)}
	contextItems={[]}>
	<div class="sandbox-route">
		<div class="sandbox-route__agent">
			<span id="sandbox-route-agent">Show access for</span>
			<Select
				labelledby="sandbox-route-agent"
				options={agentOptions}
				value={adapter}
				onChange={(next) => {
					adapter = next;
					void preview();
				}} />
		</div>
		{#if notice}
			<p role="status">{notice}</p>
		{/if}
		{#if selection}
			<SandboxSettingsView {selection} {effective} {unavailable} {error} {saving} onChange={change} onSave={save} />
		{:else if error}
			<p role="alert">{error}</p>
		{/if}
	</div>
</ApplicationShell>

<style>
	.sandbox-route {
		display: grid;
		justify-items: center;
		gap: var(--pau-space-3);
		padding: var(--pau-space-5) var(--pau-space-4);
		color: var(--pau-text);
		font-size: var(--pau-type-md);
	}

	/* Size by the shell's main column, not the viewport, so nothing overflows beside the rails. */
	.sandbox-route__agent,
	p {
		width: 100%;
		max-width: 54rem;
	}

	.sandbox-route__agent {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
	}

	p {
		margin: 0;
	}
</style>
