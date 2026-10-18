<script lang="ts">
	import { setContext } from 'svelte';

	import { shellNavigationFixtures } from '../fixtures/application-shell';
	import ApplicationShell from '../lib/ApplicationShell.svelte';
	import KeyboardShortcuts from '../lib/KeyboardShortcuts.svelte';
	import { Keymap, keymapContext, type KeyPlatform, type PiKeyBinding } from '../lib/keymap.svelte';

	let {
		platform = 'mac',
		piBindings = [],
		open = false
	}: { platform?: KeyPlatform; piBindings?: PiKeyBinding[]; open?: boolean } = $props();

	// svelte-ignore state_referenced_locally
	const keymap = setContext(keymapContext, new Keymap({ platform }));
	// svelte-ignore state_referenced_locally
	let shortcutsOpen = $state(open);
	let lastAction = $state('None');

	$effect(() => keymap.setPiBindings(piBindings));

	$effect(() => {
		const unregister = keymap.actions
			.filter((action) => !action.id.startsWith('panel.') && action.id !== 'palette.open')
			.map((action) =>
				keymap.register(action.id, (index) => {
					if (action.id === 'app.shortcuts') shortcutsOpen = !shortcutsOpen;
					lastAction = action.range ? `${action.label} (${index + 1})` : action.label;
				})
			);
		return () => {
			for (const remove of unregister) remove();
		};
	});
</script>

<svelte:window onkeydown={(event) => keymap.handleKeydown(event)} />

<ApplicationShell
	workspaceName="fix-diff-gutter"
	contextLabel="Workspaces"
	productItems={shellNavigationFixtures.productItems}
	contextItems={shellNavigationFixtures.contextItems}>
	<section class="keymap-demo">
		<p>Last action: <output aria-label="Last action">{lastAction}</output></p>
		<button type="button" onclick={() => (shortcutsOpen = true)}>Show keyboard shortcuts</button>
		<label>Prompt <textarea rows="2"></textarea></label>
		<div class="xterm" role="textbox" tabindex="0" aria-label="Terminal">$ pi</div>
		<div contenteditable="true" role="textbox" tabindex="0" aria-label="Code editor">const answer = 42;</div>
	</section>
	{#snippet inspector()}<p>Session details</p>{/snippet}
</ApplicationShell>

<KeyboardShortcuts bind:open={shortcutsOpen} actions={keymap.actions} {platform} />

<style>
	.keymap-demo {
		display: grid;
		gap: var(--pau-space-3);
		max-width: 32rem;
		padding: var(--pau-space-4);
	}

	.keymap-demo p {
		margin: 0;
	}

	.keymap-demo label {
		display: grid;
		gap: var(--pau-space-1);
	}

	.keymap-demo textarea,
	.keymap-demo [role='textbox'] {
		padding: var(--pau-space-2);
		color: var(--pau-text);
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border);
		font: inherit;
	}
</style>
