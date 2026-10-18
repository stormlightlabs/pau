<script lang="ts">
	import '../styles/tokens.css';
	import { themeCssProperties, type ThemeName, type UiFontName } from '../theme';
	import { createFocusReturn } from './focus-return';
	import Icon from './Icon.svelte';
	import { KEY_GROUPS, formatChord, type KeyPlatform, type ResolvedKeyAction } from './keymap.svelte';

	type Props = {
		/** Whether the list is showing. Closing the dialog sets it to false. */
		open?: boolean;
		actions: readonly ResolvedKeyAction[];
		platform: KeyPlatform;
		/** The list opens outside the application shell, so it applies the theme itself. */
		theme?: ThemeName;
		uiFont?: UiFontName;
	};

	let { open = $bindable(false), actions, platform, theme = 'eldritch', uiFont = 'ibm-plex-sans' }: Props = $props();
	let dialog = $state<HTMLDialogElement>();
	const focusReturn = createFocusReturn();

	const style = $derived(
		Object.entries(themeCssProperties(theme, uiFont))
			.map(([property, value]) => `${property}: ${value}`)
			.join('; ')
	);
	const groups = $derived(
		[...KEY_GROUPS, ...new Set(actions.map((action) => action.group))]
			.filter((group, index, all) => all.indexOf(group) === index)
			.map((group) => ({ group, actions: actions.filter((action) => action.group === group) }))
			.filter((entry) => entry.actions.length > 0)
	);
	const yieldedCount = $derived(actions.filter((action) => action.yielded.length > 0).length);

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			focusReturn.capture();
			dialog.showModal();
		} else if (!open && dialog.open) dialog.close();
	});

	function chords(action: ResolvedKeyAction): string[] {
		const formatted = action.keys.map((chord) => formatChord(chord, platform));
		return action.range && formatted.length > 2 ? [formatted[0] ?? '', formatted.at(-1) ?? ''] : formatted;
	}
</script>

<dialog
	bind:this={dialog}
	class="keyboard-shortcuts"
	aria-labelledby="keyboard-shortcuts-title"
	data-theme={theme}
	{style}
	onclose={() => {
		open = false;
		focusReturn.restore();
	}}>
	<header>
		<h2 id="keyboard-shortcuts-title">Keyboard shortcuts</h2>
		<button type="button" aria-label="Close keyboard shortcuts" onclick={() => (open = false)}>
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
		{#each groups as { group, actions: groupActions } (group)}
			<section aria-labelledby={`keyboard-shortcuts-${group}`}>
				<h3 id={`keyboard-shortcuts-${group}`}>{group}</h3>
				<ul>
					{#each groupActions as action (action.id)}
						{@const keys = chords(action)}
						<li>
							<span class="keyboard-shortcuts__label">
								{action.label}
								{#each action.yielded as conflict (conflict.keys)}
									<small>Pi uses {formatChord(conflict.keys, platform)} for {conflict.piAction}</small>
								{/each}
							</span>
							<span class="keyboard-shortcuts__keys">
								{#if keys.length === 0}
									<span class="keyboard-shortcuts__none">No shortcut</span>
								{:else}
									{#each keys as key, index (key)}
										{#if index > 0}<span class="keyboard-shortcuts__separator">{action.range ? 'to' : 'or'}</span>{/if}
										<kbd>{key}</kbd>
									{/each}
								{/if}
							</span>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
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
		font-size: var(--pau-type-sm);
		line-height: 1.4;
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
	h3,
	p,
	ul {
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
		color: var(--pau-text-muted);
		background: transparent;
		border: 0;
		border-radius: var(--pau-radius-control);
		cursor: pointer;
	}

	header button:hover {
		color: var(--pau-text);
		background: var(--pau-surface-raised);
	}

	header button:focus-visible {
		outline: 2px solid var(--pau-focus);
		outline-offset: 1px;
	}

	.keyboard-shortcuts__note {
		margin: var(--pau-space-3) var(--pau-space-4) 0;
		padding: var(--pau-space-2) var(--pau-space-3);
		background: var(--pau-canvas);
		border-inline-start: 2px solid var(--pau-warning);
	}

	.keyboard-shortcuts__groups {
		display: grid;
		gap: var(--pau-space-4);
		padding: var(--pau-space-4);
	}

	h3 {
		margin-bottom: var(--pau-space-1);
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
		font-weight: 600;
	}

	ul {
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--pau-space-3);
		min-height: var(--pau-size-row-md);
		padding-block: var(--pau-space-1);
		border-bottom: var(--pau-border-thin) solid var(--pau-border);
	}

	.keyboard-shortcuts__label {
		display: grid;
		min-width: 0;
	}

	small {
		color: var(--pau-warning);
		font-size: var(--pau-type-xs);
		overflow-wrap: anywhere;
	}

	.keyboard-shortcuts__keys {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: var(--pau-space-1);
	}

	kbd {
		min-width: 1.5rem;
		padding: 0.0625rem var(--pau-space-1);
		color: var(--pau-text);
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		font-family: var(--pau-font-ui);
		font-size: var(--pau-type-xs);
		text-align: center;
	}

	.keyboard-shortcuts__separator,
	.keyboard-shortcuts__none {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}
</style>
