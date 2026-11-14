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
		/** Whether the agent can switch models at all. */
		supported?: boolean;
		/** Explains why the picker is read-only right now, such as during a run. */
		unavailableReason?: string;
		/** Receives each fetched model list, so neighbours can read the current model. */
		onLoaded?: (models: ModelOption[]) => void;
		/** Model shown until the list arrives. */
		fallbackLabel?: string;
	};

	let { load, onSelect, supported = true, unavailableReason, fallbackLabel, onLoaded }: Props = $props();

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
	const disabled = $derived(!supported || unavailableReason !== undefined);
	const explanation = $derived(
		supported ? unavailableReason : 'This agent does not support switching models in a session.'
	);

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
		if (supported) void fetchModels();
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
		class="model-picker__trigger pau-field"
		aria-label={`Model: ${label}`}
		aria-haspopup="true"
		aria-expanded={open}
		aria-describedby={explanation ? 'model-picker-note' : undefined}
		title={explanation}
		{disabled}
		onclick={toggle}>
		<span class="model-picker__value">{pendingId ? 'Switching…' : label}</span>
		<Icon name="chevronDown" class="model-picker__chevron" size="0.75rem" />
	</button>
	{#if explanation}<span id="model-picker-note" class="pau-visually-hidden">{explanation}</span>{/if}

	{#if open}
		<div
			bind:this={panel}
			popover="manual"
			class="model-picker__panel"
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
								class="pau-option"
								aria-current={model.current ? 'true' : undefined}
								disabled={pendingId !== undefined}
								onclick={() => void select(model)}>
								<Icon name="check" class="model-picker__check" size="0.875rem" />
								<span class="model-picker__name">
									<small>{model.provider}</small>
									{modelLabel(model)}
								</span>
								{#if model.reasoning}<span class="model-picker__badge">Reasoning</span>{/if}
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
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		max-width: 100%;
		min-height: var(--pau-size-row-sm);
		padding-inline: var(--pau-space-1);
		text-align: start;
	}

	.model-picker__value {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
		margin: 0;
		padding: var(--pau-space-1);
		overflow-y: auto;
		color: var(--pau-text);
		font: inherit;
		font-size: var(--pau-type-md);
		background: var(--pau-surface-raised);
		border: var(--pau-border-thin, 1px) solid var(--pau-border);
		border-radius: var(--pau-radius-surface);
		box-shadow: 0 0.5rem 1.5rem rgb(0 0 0 / 28%);
		transform-origin: bottom left;
		animation: model-picker-enter var(--pau-duration-small) var(--pau-ease-enter);
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

	li button {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		width: 100%;
		min-height: var(--pau-size-row-md);
		padding: var(--pau-space-1) var(--pau-space-3) var(--pau-space-1) var(--pau-space-2);
		text-align: start;
		border: 0;
		cursor: default;
	}

	li button:focus-visible {
		background-color: var(--pau-selection);
	}

	li button :global(.model-picker__check) {
		flex: none;
		color: var(--pau-accent);
		visibility: hidden;
	}

	li button[aria-current='true'] :global(.model-picker__check) {
		visibility: visible;
	}

	.model-picker__name {
		display: grid;
		flex: 1;
		gap: 2px;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.model-picker__name small,
	.model-picker__badge {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}

	.model-picker__badge {
		flex: none;
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
