<script lang="ts">
	import '../styles/tokens.css';
	import { onMount, tick } from 'svelte';

	import { keyboardAnchor, type ContextMenuRequest } from './context-menu';
	import { dismissible } from './dismissal';
	import { returnFocus } from './focus-return';

	type Props = {
		request: ContextMenuRequest;
		/** Called when the menu closes, with or without a choice. */
		onClose: () => void;
	};

	let { request, onClose }: Props = $props();

	/** Gap kept between the menu and the viewport edge. */
	const edge = 8;
	const menuId = $props.id();

	let menu = $state<HTMLElement>();
	let left = $state(0);
	let top = $state(0);
	/** Corner the entry animation grows from, which stays at the anchor after a flip. */
	let origin = $state('top left');
	let closed = false;

	onMount(() => {
		// The top layer keeps the menu above every pane, including a rail that
		// is translated into view, while it still inherits the theme tokens.
		menu?.showPopover();
		place(request.x, request.y);
		void tick().then(() => focusItem(firstFocusable()));
		// A keyboard anchor was measured from a row that may still be moving,
		// such as a rail sliding in, so the menu moves to the row once it stops.
		if (!request.keyboard) return;
		const { invoker } = request;
		void settled(invoker).then((moved) => {
			if (!moved || closed) return;
			const anchor = keyboardAnchor(invoker);
			place(anchor.x, anchor.y);
		});
	});

	/**
	 * Waits for every finite animation and transition on the element or its
	 * ancestors to end, and reports whether there were any. Endless ones, such
	 * as a spinner, never end and are skipped.
	 */
	async function settled(element: Element): Promise<boolean> {
		const moving = document.getAnimations().filter((animation) => {
			const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
			return target?.contains(element) && animation.effect?.getComputedTiming().endTime !== Infinity;
		});
		await Promise.allSettled(moving.map((animation) => animation.finished));
		return moving.length > 0;
	}

	/**
	 * Opens the menu at an anchor, flipping it to the left or above when it
	 * would overflow, then holds it inside all four viewport edges. A keyboard
	 * anchor can start off screen, such as a row in a rail that is still
	 * sliding in.
	 */
	function place(x: number, y: number): void {
		if (!menu) return;
		const { width, height } = menu.getBoundingClientRect();
		const preferredLeft = x + width + edge > innerWidth ? x - width : x;
		const preferredTop = y + height + edge > innerHeight ? y - height : y;
		left = Math.max(edge, Math.min(preferredLeft, innerWidth - width - edge));
		top = Math.max(edge, Math.min(preferredTop, innerHeight - height - edge));
		origin = `${top < y ? 'bottom' : 'top'} ${left < x ? 'right' : 'left'}`;
	}

	function items(): HTMLElement[] {
		return [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
	}

	function firstFocusable(): number {
		const index = request.items.findIndex((item) => !item.disabled);
		return index === -1 ? 0 : index;
	}

	function focusItem(index: number): void {
		items()[index]?.focus();
	}

	/** Closes the menu. Focus returns to the invoker unless a press outside the menu moved it elsewhere. */
	function close(restoreFocus = true): void {
		if (closed) return;
		closed = true;
		if (restoreFocus) returnFocus(request.invoker);
		onClose();
	}

	function choose(index: number): void {
		const item = request.items[index];
		if (!item || item.disabled) return;
		// Closing clears the owner's request, so keep the handler first.
		const { onSelect } = request;
		close();
		onSelect(item.id);
	}

	/** Index of the item a navigation key moves focus to, or `undefined` for any other key. */
	function targetIndex(event: KeyboardEvent, current: number, count: number): number | undefined {
		switch (event.key) {
			case 'ArrowDown': {
				return (current + 1) % count;
			}
			case 'ArrowUp': {
				return (current - 1 + count) % count;
			}
			case 'Home': {
				return 0;
			}
			case 'End': {
				return count - 1;
			}
		}
		if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return undefined;
		// Typeahead moves to the next item whose label starts with the typed character.
		const key = event.key.toLowerCase();
		const order = request.items.map((_, index) => (current + 1 + index) % count);
		return order.find((index) => request.items[index]?.label.toLowerCase().startsWith(key));
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Tab') {
			event.preventDefault();
			event.stopPropagation();
			close();
			return;
		}
		const all = items();
		const current = all.indexOf(document.activeElement as HTMLElement);
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			choose(current);
			return;
		}
		const next = targetIndex(event, current, all.length);
		if (next === undefined) return;
		event.preventDefault();
		focusItem(next);
	}
</script>

<svelte:window
	onresize={() => close(false)}
	onwheelcapture={(event) => {
		if (menu && !menu.contains(event.target as Node)) close(false);
	}} />

<div
	bind:this={menu}
	popover="manual"
	role="menu"
	tabindex="-1"
	aria-label={request.label}
	class="context-menu"
	class:context-menu--keyboard={request.keyboard}
	style:left={`${left}px`}
	style:top={`${top}px`}
	style:transform-origin={origin}
	{@attach dismissible({
		close: () => close(false),
		// Closing unmounts the menu before a press restores focus, so the invoker is read now.
		restoreFocus: returnFocus.bind(undefined, request.invoker)
	})}
	onkeydown={handleKeydown}
	oncontextmenu={(event) => event.preventDefault()}>
	{#each request.items as item, index (item.id)}
		{#if item.separatorBefore && index > 0}<div role="separator" class="context-menu__separator"></div>{/if}
		<button
			type="button"
			role="menuitem"
			tabindex="-1"
			class="context-menu__item pau-option"
			aria-disabled={item.disabled ? 'true' : undefined}
			aria-labelledby={`${menuId}-${item.id}-label`}
			aria-describedby={item.disabled && item.reason ? `${menuId}-${item.id}-reason` : undefined}
			onpointermove={() => focusItem(index)}
			onclick={() => choose(index)}>
			<span id={`${menuId}-${item.id}-label`}>{item.label}</span>
			{#if item.disabled && item.reason}
				<small id={`${menuId}-${item.id}-reason`}>{item.reason}</small>
			{/if}
		</button>
	{/each}
</div>

<style>
	.context-menu {
		position: fixed;
		inset: auto;
		display: grid;
		min-width: 12rem;
		max-width: min(20rem, calc(100vw - 1rem));
		margin: 0;
		padding: var(--pau-space-1);
		overflow: visible;
		color: var(--pau-text);
		font: inherit;
		font-size: var(--pau-type-md);
		background: var(--pau-surface-raised);
		border: var(--pau-border-thin, 1px) solid var(--pau-border);
		border-radius: var(--pau-radius-surface);
		box-shadow: 0 0.5rem 1.5rem rgb(0 0 0 / 28%);
		animation: context-menu-enter var(--pau-duration-small) var(--pau-ease-enter);
	}

	.context-menu--keyboard {
		animation: none;
	}

	.context-menu__item {
		display: grid;
		gap: 2px;
		min-height: var(--pau-size-row-sm);
		padding: var(--pau-space-1) var(--pau-space-2);
		font: inherit;
		text-align: left;
		border: 0;
		border-radius: var(--pau-radius-control);
		cursor: default;
	}

	.context-menu__item:focus {
		outline: none;
	}

	.context-menu__item:focus-visible,
	.context-menu__item:focus {
		background-color: var(--pau-selection);
	}

	.context-menu__item:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset-inset);
	}

	.context-menu__item small {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}

	.context-menu__separator {
		height: 0;
		margin: var(--pau-space-1) 0;
		border-top: var(--pau-border-thin, 1px) solid var(--pau-border);
	}

	@keyframes context-menu-enter {
		from {
			opacity: 0;
			transform: scale(var(--pau-motion-scale-enter));
		}
	}

	@media (forced-colors: active) {
		.context-menu__item:focus {
			outline: var(--pau-focus-width) solid Highlight;
		}
	}
</style>
