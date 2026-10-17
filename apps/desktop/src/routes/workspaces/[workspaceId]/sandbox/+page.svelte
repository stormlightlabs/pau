<script lang="ts" module>
	function message(caught: unknown): string {
		return caught instanceof Error ? caught.message : String(caught);
	}
</script>

<script lang="ts">
	import type { SandboxAdapter } from '@stormlightlabs/pau-protocol';
	import { SandboxSettingsView, type EffectiveSandboxView, type SandboxSelectionModel } from '@stormlightlabs/pau-ui';
	import { onMount } from 'svelte';
	import { page } from '$app/state';

	import { getWorkspaceSandbox, previewSandbox, updateWorkspaceSandbox } from '$lib/api';
	import { effectiveView, selectionView, selectionWire } from '$lib/sandbox-model';

	const PREVIEW_DELAY_MS = 250;

	let workspaceId = $derived(page.params.workspaceId ?? '');
	let selection = $state<SandboxSelectionModel>();
	let draft = $state<SandboxSelectionModel>();
	let adapter = $state<SandboxAdapter>('pi');
	let effective = $state<EffectiveSandboxView>();
	let unavailable = $state<string>();
	let error = $state<string>();
	let notice = $state<string>();
	let saving = $state(false);
	let previewTimer: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
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

<main class="sandbox-route">
	<label class="sandbox-route__agent">
		Show access for
		<select bind:value={adapter} onchange={() => void preview()}>
			<option value="pi">Pi</option>
			<option value="claude">Claude</option>
		</select>
	</label>
	{#if notice}
		<p role="status">{notice}</p>
	{/if}
	{#if selection}
		<SandboxSettingsView {selection} {effective} {unavailable} {error} {saving} onChange={change} onSave={save} />
	{:else if error}
		<p role="alert">{error}</p>
	{/if}
</main>

<style>
	.sandbox-route {
		display: grid;
		justify-items: center;
		gap: 0.75rem;
		padding: 1.5rem 1rem;
		color: var(--workbench-text, #e6e6f0);
		font-size: 0.875rem;
	}

	.sandbox-route__agent {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: min(54rem, calc(100vw - 2rem));
	}

	select {
		min-height: 2.25rem;
		font: inherit;
	}

	p {
		width: min(54rem, calc(100vw - 2rem));
		margin: 0;
	}
</style>
