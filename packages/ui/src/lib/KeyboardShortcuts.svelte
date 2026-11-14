<script lang="ts">
	import '../styles/tokens.css';
	import { themeCssProperties, type ThemeName, type UiFontName } from '../theme';
	import { createFocusReturn } from './focus-return';
	import Icon from './Icon.svelte';
	import KeyboardShortcutList from './KeyboardShortcutList.svelte';
	import type { KeyPlatform, ResolvedKeyAction } from './keymap.svelte';

	type Props = {
		/** Whether the list is showing. Closing the dialog sets it to false. */
		open?: boolean;
		actions: readonly ResolvedKeyAction[];
		platform: KeyPlatform;
		/** The list opens outside the application shell, so it applies the theme itself. */
		theme?: ThemeName;
		uiFont?: UiFontName;
	};

	let { open = $bindable(false), actions, platform, theme = 'eldritch', uiFont = 'overpass' }: Props = $props();
	let dialog = $state<HTMLDialogElement>();
	const focusReturn = createFocusReturn();

	const style = $derived(
		Object.entries(themeCssProperties(theme, uiFont))
			.map(([property, value]) => `${property}: ${value}`)
			.join('; ')
	);
	const yieldedCount = $derived(actions.filter((action) => action.yielded.length > 0).length);

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			focusReturn.capture();
			dialog.showModal();
			// The list has no field or primary action, so start on the dialog and keep Close one Tab away.
			dialog.focus();
		} else if (!open && dialog.open) dialog.close();
	});
</script>

<dialog
	bind:this={dialog}
	class="keyboard-shortcuts"
	tabindex="-1"
	aria-labelledby="keyboard-shortcuts-title"
	data-theme={theme}
	{style}
	onclose={() => {
		open = false;
		focusReturn.restore();
	}}>
	<header>
		<h2 id="keyboard-shortcuts-title">Keyboard shortcuts</h2>
		<button
			type="button"
			class="pau-utility-button"
			aria-label="Close keyboard shortcuts"
			onclick={() => (open = false)}>
			<Icon name="close" size={18} />
		</button>
	</header>
	{#if yieldedCount > 0}
		<p class="keyboard-shortcuts__note">
			Your Pi key bindings take precedence. {yieldedCount === 1
				? 'One shortcut gives'
				: `${yieldedCount} shortcuts give`}
			way to them.
		</p>
	{/if}
	<div class="keyboard-shortcuts__groups">
		<KeyboardShortcutList {actions} {platform} />
	</div>
</dialog>

<style>
	.keyboard-shortcuts {
		width: min(40rem, calc(100% - 2rem));
		max-height: min(42rem, calc(100dvh - 2rem));
		padding: 0;
		overflow: auto;
		color: var(--pau-text);
		background: var(--pau-surface);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-surface);
		box-shadow: 0 1rem 3rem color-mix(in srgb, var(--pau-canvas) 85%, transparent);
		font-family: var(--pau-font-ui);
		font-size: var(--pau-type-md);
		line-height: 1.4;
		outline: 0;
	}

	.keyboard-shortcuts[open] {
		animation: keyboard-shortcuts-enter var(--pau-duration-medium) var(--pau-ease-enter);
	}

	.keyboard-shortcuts::backdrop {
		background: color-mix(in srgb, var(--pau-canvas) 78%, transparent);
	}

	.keyboard-shortcuts[open]::backdrop {
		animation: keyboard-shortcuts-fade var(--pau-duration-medium) var(--pau-ease-enter);
	}

	@keyframes keyboard-shortcuts-enter {
		from {
			opacity: 0;
			transform: scale(var(--pau-motion-scale-enter));
		}
	}

	@keyframes keyboard-shortcuts-fade {
		from {
			opacity: 0;
		}
	}

	header {
		position: sticky;
		top: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--pau-space-3);
		padding: var(--pau-space-3) var(--pau-space-4);
		background: var(--pau-surface);
		border-bottom: 1px solid var(--pau-border);
	}

	h2,
	p {
		margin: 0;
	}

	h2 {
		font-size: var(--pau-type-lg);
	}

	header button {
		display: grid;
		place-items: center;
		width: var(--pau-size-target-compact);
		height: var(--pau-size-target-compact);
		padding: 0;
		border: 0;
		border-radius: var(--pau-radius-control);
		cursor: pointer;
	}

	header button:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset);
	}

	.keyboard-shortcuts__note {
		margin: var(--pau-space-3) var(--pau-space-4) 0;
		padding: var(--pau-space-2) var(--pau-space-3);
		background: var(--pau-canvas);
		border-inline-start: 2px solid var(--pau-warning);
	}

	.keyboard-shortcuts__groups {
		padding: var(--pau-space-4);
	}
</style>
