<script lang="ts">
	import { isReducedMotion } from '../motion';
	import { PALETTE_GROUPS, filterPalette, type PaletteEntry } from './command-palette';
	import { createFocusReturn } from './focus-return';
	import Icon from './Icon.svelte';
	import { eventChord, type KeyChord } from './keymap.svelte';

	type Props = {
		/** Whether the palette is showing. Closing it sets this to false. */
		open?: boolean;
		entries: readonly PaletteEntry[];
		/**
		 * How the palette was opened. A pointer open fades in, unless motion is
		 * reduced. A keyboard open appears at once.
		 */
		entrance?: 'keyboard' | 'pointer';
		/**
		 * Resolved chords that open the palette. Pressing one while it is open
		 * closes it, because the app key map does not run inside dialogs.
		 */
		toggleKeys?: readonly KeyChord[];
	};

	let { open = $bindable(false), entries, entrance = 'keyboard', toggleKeys = [] }: Props = $props();

	const uid = $props.id();
	const listId = `${uid}-list`;
	let dialog = $state<HTMLDialogElement>();
	let input = $state<HTMLInputElement>();
	let listbox = $state<HTMLElement>();
	let query = $state('');
	/** The row the user moved to. Until then the first available row is active. */
	let picked = $state<number>();
	let fade = $state(false);
	/** Gives focus back to the element that had it before the palette opened. */
	const focusReturn = createFocusReturn();

	const results = $derived(filterPalette(entries, query));
	const groups = $derived(
		PALETTE_GROUPS.map((group) => ({
			group,
			items: results.flatMap((entry, index) => (entry.group === group ? [{ entry, index }] : []))
		})).filter((section) => section.items.length > 0)
	);
	const activeIndex = $derived(
		picked ??
			Math.max(
				0,
				results.findIndex((entry) => !entry.disabled)
			)
	);
	const activeId = $derived(results.length > 0 ? optionId(activeIndex) : undefined);

	$effect(() => {
		if (!dialog || !input) return;
		if (open && !dialog.open) {
			focusReturn.capture();
			query = '';
			picked = undefined;
			fade = entrance === 'pointer' && !isReducedMotion();
			dialog.showModal();
			input.focus();
		} else if (!open && dialog.open) {
			dialog.close();
		}
	});

	$effect(() => {
		if (activeId) listbox?.querySelector(`#${CSS.escape(activeId)}`)?.scrollIntoView({ block: 'nearest' });
	});

	function optionId(index: number): string {
		return `${uid}-option-${index}`;
	}

	/**
	 * Closes the palette and returns focus at once, so an entry that moves
	 * focus, such as "Focus the composer", runs after the invoker has it back.
	 */
	function close(): void {
		if (dialog?.open) dialog.close();
		open = false;
		focusReturn.restore();
	}

	/** Runs an entry. A link entry keeps its default action, so the app's router navigates. */
	function choose(entry: PaletteEntry, event: MouseEvent): void {
		if (entry.disabled) {
			event.preventDefault();
			return;
		}
		close();
		entry.run?.();
	}

	function move(offset: number): void {
		if (results.length === 0) return;
		picked = (activeIndex + offset + results.length) % results.length;
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.isComposing) return;
		const chord = eventChord(event);
		if (chord !== undefined && toggleKeys.includes(chord)) {
			event.preventDefault();
			close();
			return;
		}
		switch (event.key) {
			case 'ArrowDown':
			case 'ArrowUp': {
				event.preventDefault();
				move(event.key === 'ArrowDown' ? 1 : -1);
				break;
			}
			case 'Home':
			case 'End': {
				if (results.length === 0) return;
				event.preventDefault();
				picked = event.key === 'Home' ? undefined : results.length - 1;
				break;
			}
			case 'Enter': {
				event.preventDefault();
				// Clicking the option lets a link entry navigate the same way a pointer does.
				if (activeId) listbox?.querySelector<HTMLElement>(`#${CSS.escape(activeId)}`)?.click();
				break;
			}
		}
	}
</script>

<dialog
	bind:this={dialog}
	class="command-palette"
	aria-label="Command palette"
	data-entrance={fade ? 'fade' : undefined}
	oncancel={(event) => {
		event.preventDefault();
		close();
	}}
	onclose={() => {
		open = false;
		focusReturn.restore();
	}}
	onclick={(event) => {
		if (event.target === dialog) close();
	}}>
	<div class="command-palette__field">
		<Icon name="search" size={16} />
		<input
			bind:this={input}
			bind:value={query}
			type="text"
			role="combobox"
			aria-label="Search or run a command"
			aria-expanded="true"
			aria-controls={listId}
			aria-autocomplete="list"
			aria-activedescendant={activeId}
			autocomplete="off"
			spellcheck="false"
			placeholder="Search or run a command"
			oninput={() => (picked = undefined)}
			onkeydown={handleKeydown} />
	</div>
	<div bind:this={listbox} id={listId} class="command-palette__list" role="listbox" aria-label="Commands">
		{#each groups as { group, items } (group)}
			<div role="group" aria-labelledby={`${uid}-${group}`}>
				<div id={`${uid}-${group}`} class="command-palette__heading" role="presentation">{group}</div>
				{#each items as { entry, index } (entry.id)}
					{#snippet row()}
						<span class="command-palette__label">{entry.label}</span>
						{#if entry.detail}<span class="command-palette__detail">{entry.detail}</span>{/if}
						{#if entry.disabled}
							<span class="command-palette__reason">{entry.disabled}</span>
						{:else if entry.shortcut}
							<kbd>{entry.shortcut}</kbd>
						{/if}
					{/snippet}
					{#if entry.href && !entry.disabled}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the app owner resolves view links -->
						<a
							id={optionId(index)}
							class="command-palette__option"
							href={entry.href}
							role="option"
							tabindex="-1"
							aria-selected={index === activeIndex}
							onpointermove={() => (picked = index)}
							onclick={(event) => choose(entry, event)}>{@render row()}</a>
					{:else}
						<!-- Options never take focus. The combobox handles their keys through aria-activedescendant. -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div
							id={optionId(index)}
							class="command-palette__option"
							role="option"
							tabindex="-1"
							aria-selected={index === activeIndex}
							aria-disabled={entry.disabled ? 'true' : undefined}
							onpointermove={() => (picked = index)}
							onclick={(event) => choose(entry, event)}>
							{@render row()}
						</div>
					{/if}
				{/each}
			</div>
		{/each}
	</div>
	<p class="command-palette__empty" role="status">{results.length === 0 ? 'No matches' : ''}</p>
</dialog>

<style>
	.command-palette {
		width: min(36rem, calc(100% - 2rem));
		margin: 12dvh auto auto;
		padding: 0;
		overflow: hidden;
		color: var(--pau-text);
		background: var(--pau-surface);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-overlay);
		box-shadow: 0 1rem 3rem color-mix(in srgb, var(--pau-canvas) 85%, transparent);
		font-family: var(--pau-font-ui);
		font-size: var(--pau-type-md);
		line-height: 1.4;
	}

	.command-palette::backdrop {
		background: color-mix(in srgb, var(--pau-canvas) 60%, transparent);
	}

	/* Only a pointer open fades, and only when motion is not reduced. */
	.command-palette[data-entrance='fade'][open],
	.command-palette[data-entrance='fade'][open]::backdrop {
		animation: command-palette-fade var(--pau-duration-quick) var(--pau-ease-out);
	}

	@keyframes command-palette-fade {
		from {
			opacity: 0;
		}
	}

	.command-palette__field {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		padding-inline: var(--pau-space-3);
		color: var(--pau-text-muted);
		border-bottom: 1px solid var(--pau-border-control);
	}

	.command-palette__field input {
		flex: 1;
		min-width: 0;
		height: var(--pau-size-row-lg);
		padding: 0;
		color: var(--pau-text);
		background: transparent;
		border: 0;
		outline: 0;
		font: inherit;
	}

	.command-palette__field input::placeholder {
		color: var(--pau-text-muted);
	}

	.command-palette__list {
		max-height: calc(var(--pau-size-row-md) * 12);
		padding-block: var(--pau-space-1);
		overflow-y: auto;
	}

	.command-palette__list:empty {
		display: none;
	}

	.command-palette__heading {
		display: flex;
		align-items: center;
		height: var(--pau-size-row-sm);
		padding-inline: var(--pau-space-3);
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
		font-weight: var(--pau-weight-semibold);
	}

	/* Every row has the same height, so filtering never changes row geometry. */
	.command-palette__option {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-3);
		overflow: hidden;
		color: inherit;
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}

	.command-palette__option[aria-selected='true'] {
		background: var(--pau-surface-raised);
		box-shadow: inset 2px 0 0 var(--pau-accent);
	}

	.command-palette__option[aria-disabled='true'] {
		color: var(--pau-text-muted);
		cursor: default;
	}

	.command-palette__label {
		flex: none;
		max-width: 60%;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.command-palette__detail {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
		text-overflow: ellipsis;
	}

	.command-palette__reason,
	kbd {
		flex: none;
		margin-inline-start: auto;
		font-size: var(--pau-type-xs);
	}

	.command-palette__reason {
		color: var(--pau-text-muted);
	}

	kbd {
		min-width: 1.5rem;
		padding: 0.0625rem var(--pau-space-1);
		color: var(--pau-text);
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		font-family: var(--pau-font-ui);
		text-align: center;
	}

	.command-palette__empty:empty {
		display: none;
	}

	.command-palette__empty {
		margin: 0;
		padding: var(--pau-space-3);
		color: var(--pau-text-muted);
	}
</style>
