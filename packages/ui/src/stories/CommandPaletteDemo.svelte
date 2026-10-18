<script lang="ts">
	import { setContext } from 'svelte';

	import { shellNavigationFixtures } from '../fixtures/application-shell';
	import ApplicationShell from '../lib/ApplicationShell.svelte';
	import type { PaletteEntry } from '../lib/command-palette';
	import { Keymap, keymapContext, type KeyPlatform, type PiKeyBinding } from '../lib/keymap.svelte';

	let { platform = 'mac', piBindings = [] }: { platform?: KeyPlatform; piBindings?: PiKeyBinding[] } = $props();

	// svelte-ignore state_referenced_locally
	const keymap = setContext(keymapContext, new Keymap({ platform }));
	let lastAction = $state('None');
	let composer = $state<HTMLTextAreaElement>();

	$effect(() => keymap.setPiBindings(piBindings));

	// Only some actions have a handler, so the rest show as unavailable.
	$effect(() => {
		const unregister = [
			...['session.new', 'session.next', 'session.previous'].map((id) =>
				keymap.register(id, () => (lastAction = keymap.actions.find((action) => action.id === id)?.label ?? id))
			),
			keymap.register('composer.focus', () => composer?.focus())
		];
		return () => {
			for (const remove of unregister) remove();
		};
	});

	const paletteEntries: PaletteEntry[] = [
		{
			id: 'session:gutter',
			label: 'Fix diff gutter markers',
			group: 'Sessions',
			detail: 'pau',
			run: () => (lastAction = 'Opened Fix diff gutter markers')
		},
		{
			id: 'session:tokens',
			label: 'Rename theme tokens',
			group: 'Sessions',
			detail: 'website',
			run: () => (lastAction = 'Opened Rename theme tokens')
		},
		{ id: 'workspace:pau', label: 'pau', group: 'Workspaces', run: () => (lastAction = 'Opened pau') },
		{ id: 'workspace:website', label: 'website', group: 'Workspaces', run: () => (lastAction = 'Opened website') }
	];
</script>

<svelte:window onkeydown={(event) => keymap.handleKeydown(event)} />

<ApplicationShell
	workspaceName="pau"
	contextLabel="Workspaces"
	productItems={shellNavigationFixtures.productItems}
	contextItems={shellNavigationFixtures.contextItems}
	{paletteEntries}>
	<section class="palette-demo">
		<p>Last action: <output aria-label="Last action">{lastAction}</output></p>
		<label>Prompt <textarea bind:this={composer} rows="2"></textarea></label>
	</section>
</ApplicationShell>

<style>
	.palette-demo {
		display: grid;
		gap: var(--pau-space-3);
		max-width: 32rem;
		padding: var(--pau-space-4);
	}

	.palette-demo p {
		margin: 0;
	}

	.palette-demo label {
		display: grid;
		gap: var(--pau-space-1);
	}

	.palette-demo textarea {
		padding: var(--pau-space-2);
		color: var(--pau-text);
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border);
		font: inherit;
	}
</style>
