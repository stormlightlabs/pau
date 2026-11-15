<script lang="ts">
	import { tick } from 'svelte';

	import '../styles/tokens.css';
	import { anchorBox, placeAgainst } from './anchored-placement';
	import { dismissible } from './dismissal';
	import { createFocusReturn } from './focus-return';
	import { BusyIndicator } from './busy-indicator.svelte';
	import Icon from './Icon.svelte';
	import type { ModelOption } from './types/session';

	type Props = {
		/** Lists the models the session can use. A rejection shows its message. */
		load: () => Promise<ModelOption[]>;
		/** Selects a model. A rejection shows its message and keeps the list open. */
		onSelect: (model: ModelOption) => void | Promise<void>;
		/** Explains why the picker is read-only right now, such as during a run. */
		unavailableReason?: string;
		/** Receives each fetched model list, so neighbours can read the current model. */
		onLoaded?: (models: ModelOption[]) => void;
		/** Model shown until the list arrives. */
		fallbackLabel?: string;
	};

	let { load, onSelect, unavailableReason, fallbackLabel, onLoaded }: Props = $props();

	/** Longest list before it scrolls, matching the `max-height` in the styles. */
	const listCapRem = 18;

	let models = $state<ModelOption[]>();
	let loadError = $state<string>();
	let open = $state(false);
	/** Times from the list opening, since a load that finishes before then keeps nobody waiting. */
	const modelsLoading = new BusyIndicator(() => open && !models && !loadError);
	let selectError = $state<string>();
	let trigger = $state<HTMLButtonElement>();
	const focusReturn = createFocusReturn();
	let pendingId = $state<string>();
	let panel = $state<HTMLDivElement>();
	/** A keyboard open appears at once. A pointer open fades in, as Select's list does. */
	let keyboardOpen = $state(false);
	let left = $state(0);
	let top = $state(0);
	let maxHeight = $state<number>();
	let above = $state(true);

	const current = $derived(models?.find((model) => model.current));
	const label = $derived(current ? modelLabel(current) : (fallbackLabel ?? 'Model'));
	const disabled = $derived(unavailableReason !== undefined);

	function modelLabel(model: ModelOption): string {
		return model.name || model.id;
	}

	async function fetchModels(): Promise<void> {
		loadError = undefined;
		try {
			models = await load();
			onLoaded?.(models);
		} catch (cause) {
			loadError = cause instanceof Error ? cause.message : 'Pau could not list the available models.';
		}
	}

	async function select(model: ModelOption): Promise<void> {
		if (pendingId) return;
		pendingId = `${model.provider}/${model.id}`;
		selectError = undefined;
		try {
			await onSelect(model);
			close();
			await fetchModels();
		} catch (cause) {
			selectError = cause instanceof Error ? cause.message : 'The model could not be changed. Try again.';
		} finally {
			pendingId = undefined;
		}
	}

	/**
	 * Opens the list from the keyboard and focuses the current model, or the
	 * first control while the list loads.
	 *
	 * @returns Whether the list opened. A disabled picker stays closed.
	 */
	export async function show(): Promise<boolean> {
		if (disabled) return false;
		focusReturn.capture();
		keyboardOpen = true;
		open = true;
		await tick();
		(panel?.querySelector<HTMLButtonElement>('button[aria-current="true"]') ?? panel?.querySelector('button'))?.focus();
		return true;
	}

	/** Lists the models again, after a model changes outside the picker, such as with `/model`. */
	export function refresh(): Promise<void> {
		return fetchModels();
	}

	// The picker mounts for each session, so one load per mount refreshes the list on open.
	$effect(() => {
		void fetchModels();
	});

	$effect(() => {
		if (disabled) close();
	});

	/**
	 * Places the list by Select's rule. The picker lives in the composer
	 * footer, so the list and its errors open upward unless only the space
	 * below fits them.
	 */
	function place(): void {
		if (!trigger || !panel) return;
		const anchor = anchorBox(trigger);
		const cap = listCapRem * Number(getComputedStyle(document.documentElement).fontSize.replace('px', ''));
		const placement = placeAgainst(anchor, panel.offsetWidth, Math.min(panel.scrollHeight, cap), 'above');
		({ left, top, above } = placement);
		maxHeight = Math.min(cap, placement.room);
	}

	// The list joins the top layer, like Select's, and moves when a message or the models change its height.
	$effect(() => {
		void [models, loadError, selectError, pendingId, modelsLoading.visible];
		if (!open || !panel) return;
		if (!panel.matches(':popover-open')) panel.showPopover();
		place();
	});

	function toggle(event: MouseEvent): void {
		if (open) close();
		else {
			focusReturn.capture(trigger);
			// Assistive technology and keyboard clicks report no pointer detail.
			keyboardOpen = event.detail === 0;
			open = true;
		}
	}

	/**
	 * Closes the list. Focus returns to the trigger, or the composer when the
	 * trigger is disabled, unless a press outside the list moved it elsewhere.
	 */
	function close(restoreFocus = true): void {
		if (!open) return;
		open = false;
		if (restoreFocus) focusReturn.restore();
	}

	function handleScroll(event: Event): void {
		if (!panel?.contains(event.target as Node)) place();
	}
</script>

<svelte:window onscrollcapture={handleScroll} onresize={place} />

<div
	class="model-picker"
	{@attach open && dismissible({ close: () => close(false), restoreFocus: () => focusReturn.restore() })}>
	<button
		bind:this={trigger}
		type="button"
		class="model-picker__trigger pau-field pau-field--quiet"
		aria-label={`Model: ${label}`}
		aria-haspopup="true"
		aria-expanded={open}
		aria-describedby={unavailableReason ? 'model-picker-note' : undefined}
		title={unavailableReason}
		{disabled}
		onclick={toggle}>
		<span class="model-picker__value">{pendingId ? 'Switching…' : label}</span>
		<Icon name="chevronDown" class="model-picker__chevron" size="0.75rem" />
	</button>
	{#if unavailableReason}<span id="model-picker-note" class="pau-visually-hidden">{unavailableReason}</span>{/if}

	{#if open}
		<div
			bind:this={panel}
			popover="manual"
			class="model-picker__panel pau-menu"
			class:model-picker__panel--keyboard={keyboardOpen}
			class:model-picker__panel--below={!above}
			style:left={`${left}px`}
			style:top={`${top}px`}
			style:max-height={maxHeight === undefined ? undefined : `${maxHeight}px`}
			role="group"
			aria-label="Models">
			{#if selectError}<p class="model-picker__error" role="alert">{selectError}</p>{/if}
			{#if loadError}
				<p class="model-picker__error" role="alert">{loadError}</p>
				<button type="button" class="pau-button pau-button--secondary" onclick={() => void fetchModels()}
					>Try again</button>
			{:else if !models || modelsLoading.active}
				{#if modelsLoading.visible}<p class="model-picker__note" role="status">Loading models…</p>{/if}
			{:else if models.length === 0}
				<p class="model-picker__note">No models are available. Sign in to a provider in Pi, then reopen this list.</p>
			{:else}
				<ul>
					{#each models as model (`${model.provider}/${model.id}`)}
						<li>
							<button
								type="button"
								class="pau-menu__item pau-option"
								aria-current={model.current ? 'true' : undefined}
								disabled={pendingId !== undefined}
								onclick={() => void select(model)}>
								<Icon name="check" class="model-picker__check" size="0.875rem" />
								<span class="pau-menu__text">
									<small>{model.provider}</small>
									<span>{modelLabel(model)}</span>
								</span>
								{#if model.reasoning}<span class="pau-menu__hint">Reasoning</span>{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<style>
	/*
	 * The trigger and list copy Select's quiet trigger and list, so the model
	 * picker reads like the thinking level beside it. The list stays a group
	 * of buttons because it also shows loading, retry, and empty states.
	 */
	.model-picker {
		position: relative;
		min-width: 0;
	}

	button {
		color: var(--pau-text);
		background-color: transparent;
		border: 1px solid transparent;
		border-radius: var(--pau-radius-control);
		font: inherit;
		cursor: pointer;
	}

	button:disabled {
		color: var(--pau-text-muted);
		cursor: not-allowed;
	}

	button:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset);
	}

	.model-picker__trigger {
		max-width: 100%;
	}

	.model-picker__value {
		flex: 1;
	}

	.model-picker__trigger :global(.model-picker__chevron) {
		flex: none;
		color: var(--pau-text-muted);
	}

	.model-picker__panel {
		position: fixed;
		inset: auto;
		display: grid;
		width: 20rem;
		max-width: min(24rem, calc(100vw - 1rem));
		max-height: 18rem;
		overflow-y: auto;
		font-family: inherit;
		transform-origin: bottom left;
		animation: model-picker-enter var(--pau-duration-move) var(--pau-ease-out);
	}

	.model-picker__panel--below {
		transform-origin: top left;
	}

	.model-picker__panel--keyboard {
		animation: none;
	}

	:global(:root[data-motion='reduce']) .model-picker__panel {
		animation: none;
	}

	@media (prefers-reduced-motion: reduce) {
		:global(:root:not([data-motion])) .model-picker__panel {
			animation: none;
		}
	}

	ul {
		display: grid;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li button:focus-visible {
		background-color: var(--pau-surface-selected);
	}

	li button :global(.model-picker__check) {
		color: var(--pau-accent);
		visibility: hidden;
	}

	li button[aria-current='true'] :global(.model-picker__check) {
		visibility: visible;
	}

	/* Try again, after the list fails to load. */
	.model-picker__panel > button {
		justify-self: start;
		min-height: var(--pau-size-row-md);
		margin: 0 var(--pau-space-2) var(--pau-space-2);
		border-color: var(--pau-border);
	}

	.model-picker__note,
	.model-picker__error {
		margin: 0;
		padding: var(--pau-space-2);
		color: var(--pau-text-muted);
		font-size: var(--pau-type-sm);
	}

	.model-picker__error {
		color: var(--pau-danger);
	}

	@keyframes model-picker-enter {
		from {
			opacity: 0;
			transform: scale(var(--pau-motion-scale-enter));
		}
	}

	@media (forced-colors: active) {
		li button:hover:not(:disabled),
		li button:focus-visible {
			outline: 2px solid Highlight;
			outline-offset: -2px;
		}
	}
</style>
