<script module lang="ts">
	/** One choice in a {@link Select}. `value` is what the owner stores; `label` is what the operator reads. */
	export type SelectOption<T extends string = string> = {
		value: T;
		label: string;
		/** Secondary line under the label. */
		description?: string;
		/** Keeps the option visible but refuses to select it. */
		disabled?: boolean;
		/** Explains a disabled option. Shown under its label and announced with it. */
		disabledReason?: string;
	};
</script>

<script lang="ts" generics="T extends string">
	import '../styles/tokens.css';
	import { tick } from 'svelte';

	import { createFocusReturn } from './focus-return';
	import Icon from './Icon.svelte';

	type Props = {
		options: SelectOption<T>[];
		/**
		 * The stored choice. A synchronous `onChange` updates it, so it can be
		 * bound. Absent shows `placeholder`.
		 */
		value?: T;
		/**
		 * Receives a new choice. A returned promise keeps the choice on screen
		 * while it runs and blocks further changes. Afterwards `value` decides
		 * what shows, so a rejection restores the previous value and shows its
		 * message.
		 */
		onChange?: (value: T) => void | Promise<void>;
		/** Accessible name when no visible label names the control. */
		label?: string;
		/** Id of a visible element that names the control. */
		labelledby?: string;
		/** Id of an element with extra description, such as a field hint. */
		describedby?: string;
		/** Id for the trigger, so a `<label for>` can name it. */
		id?: string;
		/** Text shown when no option matches `value`. */
		placeholder?: string;
		disabled?: boolean;
		/** Explains why the control is disabled. Announced and shown as a tooltip. */
		disabledReason?: string;
		/** Message for a rejection that is not an `Error`. */
		errorFallback?: string;
		/** Stretches the trigger to the width of its container. */
		block?: boolean;
		/** `quiet` drops the border and background for use inside a toolbar row. */
		variant?: 'field' | 'quiet';
	};

	let {
		options,
		value = $bindable(),
		onChange,
		label,
		labelledby,
		describedby,
		id,
		placeholder = 'Choose an option',
		disabled = false,
		disabledReason,
		errorFallback = 'The change could not be saved. Try again.',
		block = false,
		variant = 'field'
	}: Props = $props();

	/** Gap between the list and the viewport edge, and between the list and its trigger. */
	const edge = 8;
	const gap = 4;
	/** Longest list before it scrolls, matching the `max-height` in the styles. */
	const listCapRem = 18;
	/** Typeahead forgets earlier keys after this pause, as native selects do. */
	const typeaheadResetMs = 500;

	const baseId = $props.id();
	const listId = `${baseId}-list`;
	const hintId = `${baseId}-hint`;
	const optionId = (index: number) => `${baseId}-option-${index}`;
	const focusReturn = createFocusReturn();

	let trigger = $state<HTMLButtonElement>();
	let list = $state<HTMLDivElement>();
	let open = $state(false);
	/** A keyboard open appears at once. A pointer open fades in. */
	let keyboardOpen = $state(false);
	let activeIndex = $state(-1);
	let pendingValue = $state<T>();
	let error = $state<string>();
	let left = $state(0);
	let top = $state(0);
	let minWidth = $state(0);
	let maxHeight = $state<number>();
	let above = $state(false);
	let typeahead = '';
	let typeaheadTimer: ReturnType<typeof setTimeout> | undefined;

	const pending = $derived(pendingValue !== undefined);
	const shown = $derived(pendingValue ?? value);
	const selectedIndex = $derived(options.findIndex((option) => option.value === shown));
	const selected = $derived(options[selectedIndex]);
	const explained = $derived(disabled && disabledReason !== undefined);
	const descriptions = $derived(
		[explained ? hintId : undefined, describedby].filter((part) => part !== undefined).join(' ') || undefined
	);

	$effect(() => {
		if (disabled && open) close(false);
	});

	/** The first option that can be chosen, or the first option when none can. */
	function firstEnabled(): number {
		const index = options.findIndex((option) => !option.disabled);
		return index === -1 ? 0 : index;
	}

	async function show(keyboard: boolean, index = selectedIndex >= 0 ? selectedIndex : firstEnabled()): Promise<void> {
		if (disabled || pending || options.length === 0) return;
		focusReturn.capture(trigger);
		keyboardOpen = keyboard;
		activeIndex = index;
		maxHeight = undefined;
		open = true;
		// The top layer keeps the list above scroll containers and overlay rails.
		list?.showPopover();
		place();
		await tick();
		revealActive();
	}

	/** Closes the list. Focus returns to the trigger unless the pointer or Tab moved it elsewhere. */
	function close(restoreFocus = true): void {
		if (!open) return;
		open = false;
		if (list?.matches(':popover-open')) list.hidePopover();
		if (restoreFocus) focusReturn.restore();
	}

	/** Places the list under the trigger, or above it when there is more room there. */
	function place(): void {
		if (!trigger || !list) return;
		const anchor = trigger.getBoundingClientRect();
		const cap = listCapRem * Number(getComputedStyle(document.documentElement).fontSize.replace('px', ''));
		const natural = Math.min(list.scrollHeight, cap);
		const below = innerHeight - anchor.bottom - gap - edge;
		const over = anchor.top - gap - edge;
		above = natural > below && over > below;
		const room = Math.max(0, above ? over : below);
		const height = Math.min(natural, room);
		maxHeight = Math.min(cap, room);
		minWidth = anchor.width;
		const width = Math.max(list.offsetWidth, anchor.width);
		left = Math.max(edge, Math.min(anchor.left, innerWidth - width - edge));
		top = above ? anchor.top - gap - height : anchor.bottom + gap;
	}

	function revealActive(): void {
		list?.querySelector(`#${CSS.escape(optionId(activeIndex))}`)?.scrollIntoView({ block: 'nearest' });
	}

	function move(index: number): void {
		activeIndex = Math.max(0, Math.min(options.length - 1, index));
		revealActive();
	}

	/**
	 * Index of the option that the typed keys select. Repeating one character
	 * cycles through the options that start with it.
	 */
	function matchTypeahead(key: string): number | undefined {
		clearTimeout(typeaheadTimer);
		typeahead += key.toLowerCase();
		typeaheadTimer = setTimeout(() => (typeahead = ''), typeaheadResetMs);
		const repeated = [...typeahead].every((char) => char === typeahead[0]);
		const search = repeated ? typeahead[0]! : typeahead;
		const from = activeIndex < 0 ? 0 : activeIndex + (repeated ? 1 : 0);
		const order = options.map((_, offset) => (from + offset) % options.length);
		return order.find((index) => options[index]!.label.toLowerCase().startsWith(search));
	}

	function choose(index: number): void {
		const option = options[index];
		if (!option || option.disabled) return;
		close();
		if (option.value !== shown) void commit(option.value);
	}

	async function commit(next: T): Promise<void> {
		error = undefined;
		try {
			const result = onChange?.(next);
			if (!(result instanceof Promise)) {
				value = next;
				return;
			}
			pendingValue = next;
			await result;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : errorFallback;
		} finally {
			pendingValue = undefined;
		}
	}

	function isTypeaheadKey(event: KeyboardEvent): boolean {
		if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return false;
		// Space selects unless the operator is in the middle of typing a label.
		return event.key !== ' ' || typeahead !== '';
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (!open) {
			handleClosedKey(event);
			return;
		}
		if (event.key === 'Tab') {
			close(false);
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close();
			return;
		}
		if (isTypeaheadKey(event)) {
			event.preventDefault();
			const match = matchTypeahead(event.key);
			if (match !== undefined) move(match);
			return;
		}
		const target = openTarget(event);
		if (target === undefined) return;
		event.preventDefault();
		if (target === 'choose') choose(activeIndex);
		else move(target);
	}

	/** What a key does while the list is open: move to an index, choose the active option, or nothing. */
	function openTarget(event: KeyboardEvent): number | 'choose' | undefined {
		if (event.key === 'Enter' || event.key === ' ' || (event.altKey && event.key === 'ArrowUp')) return 'choose';
		switch (event.key) {
			case 'ArrowDown': {
				return activeIndex + 1;
			}
			case 'ArrowUp': {
				return activeIndex - 1;
			}
			case 'Home': {
				return 0;
			}
			case 'End': {
				return options.length - 1;
			}
		}
		return undefined;
	}

	function handleClosedKey(event: KeyboardEvent): void {
		if (isTypeaheadKey(event)) {
			event.preventDefault();
			const match = matchTypeahead(event.key);
			if (match !== undefined) void show(true, match);
			return;
		}
		switch (event.key) {
			case 'Enter':
			case ' ':
			case 'ArrowDown':
			case 'ArrowUp': {
				event.preventDefault();
				void show(true);
				return;
			}
			case 'Home': {
				event.preventDefault();
				void show(true, 0);
				return;
			}
			case 'End': {
				event.preventDefault();
				void show(true, options.length - 1);
			}
		}
	}

	/** Keyboard opens are handled on keydown, so a Space keyup must not click the trigger again. */
	function handleKeyup(event: KeyboardEvent): void {
		if (event.key === ' ') event.preventDefault();
	}

	function handleClick(event: MouseEvent): void {
		if (pending) return;
		if (open) close();
		// Assistive technology clicks report no pointer detail and get the keyboard treatment.
		else void show(event.detail === 0);
	}

	function handleOutsidePointer(event: PointerEvent): void {
		if (!open) return;
		const target = event.target as Node;
		if (!list?.contains(target) && !trigger?.contains(target)) close(false);
	}

	function handleScroll(event: Event): void {
		if (open && !list?.contains(event.target as Node)) place();
	}
</script>

<svelte:window
	onpointerdowncapture={handleOutsidePointer}
	onscrollcapture={handleScroll}
	onresize={() => close(false)}
	onblur={() => close(false)} />

<div class="select" class:select--block={block}>
	<button
		bind:this={trigger}
		{id}
		type="button"
		role="combobox"
		class="select__trigger"
		class:select__trigger--quiet={variant === 'quiet'}
		aria-label={label}
		aria-labelledby={labelledby}
		aria-describedby={descriptions}
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls={listId}
		aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
		aria-busy={pending || undefined}
		aria-disabled={pending || undefined}
		title={explained ? disabledReason : undefined}
		{disabled}
		onclick={handleClick}
		onkeydown={handleKeydown}
		onkeyup={handleKeyup}>
		<span class="select__value" class:select__value--placeholder={!selected}>{selected?.label ?? placeholder}</span>
		<Icon name="chevronDown" class="select__chevron" size="0.75rem" />
	</button>
	{#if explained}<span id={hintId} class="select__hint">{disabledReason}</span>{/if}

	<!-- Pointer presses keep focus on the trigger, which owns the active option. -->
	<div
		bind:this={list}
		id={listId}
		popover="manual"
		role="listbox"
		tabindex="-1"
		aria-label={label}
		aria-labelledby={labelledby}
		class="select__list"
		class:select__list--keyboard={keyboardOpen}
		class:select__list--above={above}
		style:left={`${left}px`}
		style:top={`${top}px`}
		style:min-width={`${minWidth}px`}
		style:max-height={maxHeight === undefined ? undefined : `${maxHeight}px`}
		onpointerdown={(event) => event.preventDefault()}>
		{#each options as option, index (option.value)}
			{@const reasonId = `${optionId(index)}-reason`}
			{@const descriptionId = `${optionId(index)}-description`}
			{@const labelId = `${optionId(index)}-label`}
			<!-- The trigger keeps focus and handles keys through aria-activedescendant. -->
			<!-- svelte-ignore a11y_interactive_supports_focus, a11y_click_events_have_key_events -->
			<div
				id={optionId(index)}
				role="option"
				class="select__option"
				class:select__option--active={index === activeIndex}
				aria-selected={index === selectedIndex}
				aria-labelledby={labelId}
				aria-disabled={option.disabled || undefined}
				aria-describedby={[
					option.description ? descriptionId : undefined,
					option.disabled && option.disabledReason ? reasonId : undefined
				]
					.filter((part) => part !== undefined)
					.join(' ') || undefined}
				title={option.disabled ? option.disabledReason : undefined}
				onpointermove={() => (activeIndex = index)}
				onclick={() => choose(index)}>
				<Icon name="check" class="select__check" size="0.875rem" />
				<span class="select__text">
					<span id={labelId}>{option.label}</span>
					{#if option.description}<small id={descriptionId}>{option.description}</small>{/if}
					{#if option.disabled && option.disabledReason}<small id={reasonId}>{option.disabledReason}</small>{/if}
				</span>
			</div>
		{/each}
	</div>
	{#if error}<p class="select__error" role="alert">{error}</p>{/if}
</div>

<style>
	.select {
		position: relative;
		display: inline-block;
		min-width: 0;
	}

	.select--block {
		display: block;
		width: 100%;
	}

	.select__trigger {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		width: 100%;
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-3) var(--pau-space-2);
		color: var(--pau-text);
		font: inherit;
		font-size: var(--pau-type-sm);
		text-align: start;
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		cursor: pointer;
		transition: border-color var(--pau-duration-feedback) var(--pau-ease-standard);
	}

	.select__trigger--quiet {
		min-height: var(--pau-size-row-sm);
		padding-inline: var(--pau-space-1);
		font-size: inherit;
		background: transparent;
		border-color: transparent;
	}

	.select__trigger:hover:not(:disabled, [aria-disabled='true']) {
		border-color: var(--pau-accent);
	}

	.select__trigger:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset);
	}

	.select__trigger:disabled {
		color: var(--pau-text-muted);
		cursor: not-allowed;
	}

	.select__trigger[aria-busy='true'] {
		cursor: progress;
	}

	.select__value {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.select__value--placeholder {
		color: var(--pau-text-muted);
	}

	.select__trigger :global(.select__chevron) {
		flex: none;
		color: var(--pau-text-muted);
	}

	/* Screen readers get the explanation through aria-describedby. Sighted users get the title. */
	.select__hint {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}

	.select__list {
		position: fixed;
		inset: auto;
		max-width: min(24rem, calc(100vw - 1rem));
		max-height: 18rem;
		margin: 0;
		padding: var(--pau-space-1);
		overflow-y: auto;
		color: var(--pau-text);
		font: inherit;
		font-size: var(--pau-type-sm);
		background: var(--pau-surface-raised);
		border: var(--pau-border-thin, 1px) solid var(--pau-border);
		border-radius: var(--pau-radius-surface);
		box-shadow: 0 0.5rem 1.5rem rgb(0 0 0 / 28%);
		transform-origin: top left;
		animation: select-enter var(--pau-duration-small) var(--pau-ease-enter);
	}

	.select__list--above {
		transform-origin: bottom left;
	}

	.select__list--keyboard {
		animation: none;
	}

	:global(:root[data-motion='reduce']) .select__list {
		animation: none;
	}

	@media (prefers-reduced-motion: reduce) {
		:global(:root:not([data-motion])) .select__list {
			animation: none;
		}
	}

	.select__option {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		min-height: var(--pau-size-row-md);
		padding: var(--pau-space-1) var(--pau-space-3) var(--pau-space-1) var(--pau-space-2);
		border-radius: var(--pau-radius-control);
		cursor: default;
	}

	.select__option--active {
		background: var(--pau-selection);
	}

	.select__option--active:active:not([aria-disabled='true']) {
		background: var(--pau-surface);
	}

	.select__option[aria-disabled='true'] {
		color: var(--pau-text-muted);
	}

	.select__option :global(.select__check) {
		flex: none;
		color: var(--pau-accent);
		visibility: hidden;
	}

	.select__option[aria-selected='true'] :global(.select__check) {
		visibility: visible;
	}

	.select__text {
		display: grid;
		gap: 2px;
		min-width: 0;
	}

	.select__text small {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}

	.select__error {
		position: absolute;
		top: calc(100% + var(--pau-space-1));
		right: 0;
		z-index: 10;
		width: 16rem;
		max-width: 80vw;
		margin: 0;
		padding: var(--pau-space-2);
		color: var(--pau-danger);
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-surface);
		font-size: var(--pau-type-sm);
	}

	@keyframes select-enter {
		from {
			opacity: 0;
			transform: scale(var(--pau-motion-scale-enter));
		}
	}

	@media (forced-colors: active) {
		.select__option--active {
			outline: 2px solid Highlight;
			outline-offset: -2px;
		}
	}
</style>
