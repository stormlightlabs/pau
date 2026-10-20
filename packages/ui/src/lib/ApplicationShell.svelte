<script lang="ts">
	import type { Snippet } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';

	import type { IconKind } from '../icons';
	import '../styles/tokens.css';
	import { themeCssProperties, type ThemeName, type UiFontName } from '../theme';
	import type { PaletteEntry } from './command-palette';
	import CommandPalette from './CommandPalette.svelte';
	import { createFocusReturn } from './focus-return';
	import Icon from './Icon.svelte';
	import { getKeymap, useKeyActions } from './keymap.svelte';
	import PaneResizer from './PaneResizer.svelte';

	/**
	 * One destination in the product or contextual rail.
	 *
	 * An item without `href` cannot be opened. The rail shows it disabled and
	 * explains why with `unavailable`, so a view that does not work yet never
	 * opens as an empty page.
	 */
	export type ShellNavItem = {
		/** Stable identity for keyed rendering and tests. */
		id: string;
		label: string;
		/** Where the item navigates. */
		href?: string;
		/** Why the item cannot be opened. Defaults to "Coming soon". */
		unavailable?: string;
		icon?: IconKind;
		status?: string;
		attention?: boolean;
		active?: boolean;
	};

	/**
	 * Operator-chosen widths of the resizable panes in CSS pixels. `null`
	 * keeps a pane at its default width.
	 */
	export type ShellPaneWidths = { contextRail: number | null; inspector: number | null };

	type Props = {
		workspaceName: string;
		contextLabel: string;
		productItems: ShellNavItem[];
		contextItems: ShellNavItem[];
		disconnected?: boolean;
		/**
		 * Whether the inspector starts open where it docks beside the main
		 * surface. Narrower windows keep it closed until the operator opens it,
		 * because there it would cover the main surface.
		 */
		inspectorOpen?: boolean;
		theme?: ThemeName;
		uiFont?: UiFontName;
		/** Saved pane widths to apply. The shell keeps no copy of its own across launches. */
		paneWidths?: ShellPaneWidths;
		/** Called when a resize ends or a keyboard step lands, with every pane's width. */
		onResize?: (widths: ShellPaneWidths) => void;
		/**
		 * Workspaces and sessions the command palette lists. The palette adds the
		 * product rail views and the key map's actions itself.
		 */
		paletteEntries?: PaletteEntry[];
		children?: Snippet;
		context?: Snippet;
		inspector?: Snippet;
	};

	let {
		workspaceName,
		contextLabel,
		productItems,
		contextItems,
		disconnected = false,
		inspectorOpen = true,
		theme = 'eldritch',
		uiFont = 'overpass',
		paneWidths = { contextRail: null, inspector: null },
		onResize,
		paletteEntries = [],
		children,
		context,
		inspector
	}: Props = $props();

	const keymap = getKeymap();
	let paletteOpen = $state(false);
	let paletteEntrance = $state<'keyboard' | 'pointer'>('keyboard');
	/** Actions that the palette lists. A range action is reached through its own entries, such as sessions. */
	const actionEntries = $derived<PaletteEntry[]>(
		(keymap?.actions ?? [])
			.filter((action) => !action.range && action.palette !== false)
			.map((action) => ({
				id: `action:${action.id}`,
				label: action.label,
				group: 'Actions',
				shortcut: keymap?.shortcut(action.id),
				disabled: keymap?.canRun(action.id) ? undefined : (action.unavailable ?? 'Not available in this view'),
				run: () => keymap?.run(action.id)
			}))
	);
	const viewEntries = $derived<PaletteEntry[]>(
		productItems.map((item) => ({
			id: `view:${item.id}`,
			label: item.label,
			group: 'Views',
			detail: item.active ? 'Current view' : undefined,
			href: item.href,
			disabled: item.href ? undefined : (item.unavailable ?? 'Coming soon')
		}))
	);
	const paletteKeys = $derived(keymap?.actions.find((action) => action.id === 'palette.open')?.keys ?? []);
	const paletteShortcut = $derived(keymap?.shortcut('palette.open'));

	/** Whether the contextual rail shows as an overlay on narrow windows. */
	let contextOpen = $state(false);
	/** Whether the operator hid the contextual rail on wide windows. */
	let contextHidden = $state(false);
	let hasContext = $derived(Boolean(context) || contextItems.length > 0);

	/** Narrow windows show the contextual rail as an overlay instead of a column. */
	const narrow = new MediaQuery('max-width: 48rem');
	/** Below this width the inspector leaves the grid and opens over the main surface; matches the 74rem CSS query. */
	const inspectorOverlay = new MediaQuery('max-width: 74rem');
	let inspectorDocked = $derived(!inspectorOverlay.current);
	/**
	 * The operator's toggle overrides this until the window crosses the docking
	 * width or `inspectorOpen` changes. An overlay never opens on its own.
	 */
	let inspectorVisible = $derived(inspectorOpen && inspectorDocked);

	const contextFocus = createFocusReturn();
	const inspectorFocus = createFocusReturn();

	/** Opens or closes the overlay rail. Closing returns focus to whatever opened it. */
	function toggleContextOverlay(): void {
		contextHidden = false;
		if (contextOpen) closeContext();
		else {
			contextFocus.capture();
			contextOpen = true;
		}
	}

	/** Opens the overlay rail on narrow windows and hides or shows the rail column on wide ones. */
	function toggleContext(): void {
		if (narrow.current) toggleContextOverlay();
		else contextHidden = !contextHidden;
	}

	/** Labels a top bar toggle's tooltip with its key map shortcut when it has one. */
	function withShortcut(label: string, actionId: string): string {
		const shortcut = keymap?.shortcut(actionId);
		return shortcut ? `${label} (${shortcut})` : label;
	}

	/** Narrow windows open the rail as an overlay, so the toggle names that action instead of hiding a column. */
	const contextToggleLabel = $derived(
		narrow.current ? 'Open navigation' : contextHidden ? 'Show navigation' : 'Hide navigation'
	);
	const inspectorToggleLabel = $derived(inspectorVisible ? 'Hide inspector' : 'Show inspector');

	function closeContext(): void {
		contextOpen = false;
		contextFocus.restore();
	}

	function toggleInspector(): void {
		if (inspectorVisible) closeInspector();
		else {
			inspectorFocus.capture();
			inspectorVisible = true;
		}
	}

	function closeInspector(): void {
		inspectorVisible = false;
		inspectorFocus.restore();
	}

	/** Closes an open overlay rail on Escape. */
	function closeOnEscape(event: KeyboardEvent, close: () => void): void {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		event.stopPropagation();
		close();
	}

	useKeyActions({
		'palette.open': () => {
			paletteEntrance = 'keyboard';
			paletteOpen = !paletteOpen;
		},
		'panel.context': () => {
			if (hasContext) toggleContext();
		},
		'panel.inspector': () => {
			if (inspector) toggleInspector();
		}
	});
	/** Narrowest a resizable pane may be. */
	const MIN_PANE_WIDTH = 160;
	/** Width the main surface keeps, matching the `minmax(24rem, 1fr)` grid track. */
	const MIN_MAIN_WIDTH = 384;

	let shell = $state<HTMLElement>();
	let shellWidth = $state(0);
	let railWidth = $state(0);
	let contextWidth = $state(0);
	let inspectorWidth = $state(0);
	let contextDragging = $state(false);
	let inspectorDragging = $state(false);
	/** Widths kept by the latest resize. They stay in effect until `paneWidths` changes. */
	let kept = $derived<ShellPaneWidths>({ ...paneWidths });

	/** Largest width a pane can take while the main surface keeps its minimum. */
	function maxPaneWidth(pane: keyof ShellPaneWidths): number {
		const sibling = pane === 'contextRail' ? (inspectorDocked ? inspectorWidth : 0) : hasContext ? contextWidth : 0;
		return Math.max(MIN_PANE_WIDTH, shellWidth - railWidth - sibling - MIN_MAIN_WIDTH);
	}

	/**
	 * Applies a saved width, shrinking it when the window can no longer fit it.
	 *
	 * The context rail claims space first and leaves the docked inspector its
	 * minimum. Neither bound reads a width this function sets, so applying a
	 * width never changes the width it was measured against.
	 */
	function appliedWidth(pane: keyof ShellPaneWidths): number | null {
		const width = kept[pane];
		if (width === null || shellWidth === 0) return width;
		const available = shellWidth - railWidth - MIN_MAIN_WIDTH;
		if (pane === 'contextRail')
			return Math.max(MIN_PANE_WIDTH, Math.min(width, available - (inspectorDocked ? MIN_PANE_WIDTH : 0)));
		const context = hasContext ? (appliedWidth('contextRail') ?? contextWidth) : 0;
		return Math.max(MIN_PANE_WIDTH, Math.min(width, available - context));
	}

	const widthProperty = { contextRail: '--shell-context-width', inspector: '--shell-inspector-width' } as const;

	let paneProperties = $derived(
		Object.fromEntries(
			(['contextRail', 'inspector'] as const).flatMap((pane) => {
				const width = appliedWidth(pane);
				return width === null ? [] : [[widthProperty[pane], `${width}px`]];
			})
		)
	);

	/** Moves a pane's edge for the current frame without re-rendering the shell. */
	function previewWidth(pane: keyof ShellPaneWidths, width: number) {
		shell?.style.setProperty(widthProperty[pane], `${width}px`);
	}

	/** Puts the pane back where the last kept width placed it. */
	function cancelPreview(pane: keyof ShellPaneWidths) {
		const width = appliedWidth(pane);
		if (width === null) shell?.style.removeProperty(widthProperty[pane]);
		else shell?.style.setProperty(widthProperty[pane], `${width}px`);
	}

	function keepWidth(pane: keyof ShellPaneWidths, width: number | null) {
		kept = { ...kept, [pane]: width };
		if (width === null) shell?.style.removeProperty(widthProperty[pane]);
		onResize?.({ ...kept });
	}

	let shellStyle = $derived(
		Object.entries({ ...themeCssProperties(theme, uiFont), ...paneProperties })
			.map(([property, value]) => `${property}: ${value}`)
			.join('; ')
	);
</script>

<a class="app-shell__skip-link" href="#main-surface">Skip to main surface</a>
<div
	class:app-shell--with-inspector={inspectorVisible && inspector}
	class:app-shell--without-context={!hasContext || contextHidden}
	class:app-shell--resizing={contextDragging || inspectorDragging}
	bind:this={shell}
	bind:offsetWidth={shellWidth}
	class="app-shell"
	data-theme={theme}
	data-ui-font={uiFont}
	style={shellStyle}>
	<header class="app-shell__command-bar">
		<div class="app-shell__identity">
			<svg class="app-shell__mark" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
				<path d="M9.5 6.5H41A13.5 13.5 0 0 1 41 33.5H23.5V26.5H41A6.5 6.5 0 0 0 41 13.5H9.5Z" />
				<path d="M23.5 6.5V48A9.5 9.5 0 0 0 33 57.5H38.5V50.5H33A2.5 2.5 0 0 1 30.5 48V6.5Z" />
			</svg>
			<strong>Pau</strong>
			<span>/</span>
			<span>{workspaceName}</span>
		</div>

		<!-- A healthy connection stays silent so the bar never implies Pi itself works. -->
		{#if disconnected}
			<p class="app-shell__connection" role="status"><span></span>Disconnected</p>
		{/if}

		<div class="app-shell__panel-toggles">
			{#if hasContext}
				<button
					type="button"
					class="app-shell__icon-button"
					aria-label={contextToggleLabel}
					aria-expanded={narrow.current ? contextOpen : !contextHidden}
					title={withShortcut(contextToggleLabel, 'panel.context')}
					onclick={toggleContext}>
					<Icon name="sidebar" size={18} />
				</button>
			{/if}
			{#if inspector}
				<button
					type="button"
					class="app-shell__icon-button"
					aria-label={inspectorToggleLabel}
					aria-expanded={inspectorVisible}
					title={withShortcut(inspectorToggleLabel, 'panel.inspector')}
					onclick={toggleInspector}>
					<Icon name="panel" size={18} />
				</button>
			{/if}
		</div>

		<button
			type="button"
			class="app-shell__command-input"
			aria-haspopup="dialog"
			onclick={(event) => {
				// A click from Enter or Space reports no pointer detail and opens at once.
				paletteEntrance = event.detail > 0 ? 'pointer' : 'keyboard';
				paletteOpen = true;
			}}>
			<span class="app-shell__search-icon" aria-hidden="true"></span>
			<span class="app-shell__command-placeholder">Search or run a command</span>
			{#if paletteShortcut}<kbd>{paletteShortcut}</kbd>{/if}
		</button>
	</header>

	<CommandPalette
		bind:open={paletteOpen}
		entries={[...actionEntries, ...paletteEntries, ...viewEntries]}
		entrance={paletteEntrance}
		toggleKeys={paletteKeys} />

	<nav class="app-shell__product-rail" aria-label="Product" bind:offsetWidth={railWidth}>
		<ul>
			{#each productItems as item (item.id)}
				<li>
					{#if item.href}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the app owner resolves rail destinations -->
						<a
							href={item.href}
							class:active={item.active}
							aria-current={item.active ? 'page' : undefined}
							aria-label={item.label}
							title={item.label}>
							<Icon name={item.icon ?? 'agents'} size={20} />
							{#if item.attention}<span class="app-shell__attention" role="img" aria-label="Needs attention"></span
								>{/if}
						</a>
					{:else}
						{@const reason = item.unavailable ?? 'Coming soon'}
						<button
							type="button"
							class="app-shell__unavailable"
							class:active={item.active}
							aria-current={item.active ? 'page' : undefined}
							aria-disabled="true"
							aria-label={item.label}
							aria-describedby={`product-${item.id}-unavailable`}
							title={`${item.label}: ${reason}`}>
							<Icon name={item.icon ?? 'agents'} size={20} />
						</button>
						<span id={`product-${item.id}-unavailable`} class="app-shell__sr-only">{reason}</span>
					{/if}
				</li>
			{/each}
		</ul>
	</nav>

	{#if hasContext && !contextHidden}
		<!-- Escape bubbles from the controls inside the rail -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<aside
			id="shell-context-rail"
			class:open={contextOpen}
			class="app-shell__context-rail"
			aria-label={contextLabel}
			onkeydown={(event) => contextOpen && closeOnEscape(event, closeContext)}
			bind:offsetWidth={contextWidth}>
			<div class="app-shell__rail-heading">
				<span>{contextLabel}</span>
				<button type="button" aria-label="Close navigation" onclick={closeContext}>
					<Icon name="close" size={18} />
				</button>
			</div>
			{#if context}
				<div class="app-shell__context-content">{@render context()}</div>
			{:else}
				<ul>
					{#each contextItems as item (item.id)}
						<li>
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the app owner resolves rail destinations -->
							<a href={item.href} class:active={item.active} aria-current={item.active ? 'page' : undefined}>
								<span class:attention={item.attention} class="app-shell__item-dot"></span>
								<span>{item.label}</span>
								{#if item.status}<small>{item.status}</small>{/if}
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</aside>
		<div class="app-shell__resizer app-shell__resizer--context">
			<PaneResizer
				label="Resize {contextLabel.toLowerCase()}"
				controls="shell-context-rail"
				value={contextWidth}
				min={MIN_PANE_WIDTH}
				max={maxPaneWidth('contextRail')}
				direction={1}
				bind:dragging={contextDragging}
				onPreview={(width) => previewWidth('contextRail', width)}
				onCommit={(width) => keepWidth('contextRail', width)}
				onCancel={() => cancelPreview('contextRail')} />
		</div>
	{/if}

	<main id="main-surface" class="app-shell__main" tabindex="-1">
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div class="app-shell__main-content" role="region" aria-label="Main surface content" tabindex="0">
			{#if children}{@render children()}{/if}
		</div>
	</main>

	{#if inspector && inspectorVisible}
		<button type="button" class="app-shell__backdrop" aria-label="Close inspector" onclick={closeInspector}></button>
		<!-- Escape bubbles from the controls inside the rail -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<aside
			id="shell-inspector"
			class="app-shell__inspector"
			aria-label="Inspector"
			onkeydown={(event) => !inspectorDocked && closeOnEscape(event, closeInspector)}
			bind:offsetWidth={inspectorWidth}>
			<div class="app-shell__rail-heading">
				<span>Inspector</span>
				<button type="button" aria-label="Close inspector" onclick={closeInspector}>
					<Icon name="close" size={18} />
				</button>
			</div>
			<div class="app-shell__inspector-content">{@render inspector()}</div>
		</aside>
		<div class="app-shell__resizer app-shell__resizer--inspector">
			<PaneResizer
				label="Resize inspector"
				controls="shell-inspector"
				value={inspectorWidth}
				min={MIN_PANE_WIDTH}
				max={maxPaneWidth('inspector')}
				direction={-1}
				bind:dragging={inspectorDragging}
				onPreview={(width) => previewWidth('inspector', width)}
				onCommit={(width) => keepWidth('inspector', width)}
				onCancel={() => cancelPreview('inspector')} />
		</div>
	{/if}
</div>

<style>
	:global(*) {
		box-sizing: border-box;
	}

	.app-shell {
		--shell-bg: var(--pau-canvas);
		--shell-surface: var(--pau-surface);
		--shell-surface-raised: var(--pau-surface-raised);
		--shell-border: var(--pau-border);
		--shell-text: var(--pau-text);
		--shell-muted: var(--pau-text-muted);
		--shell-faint: var(--pau-text-muted);
		--shell-accent: var(--pau-accent);
		--shell-warning: var(--pau-warning);
		--shell-danger: var(--pau-danger);
		--shell-focus: var(--pau-focus);
		--shell-context-width: var(--pau-size-rail-context);
		--shell-inspector-width: var(--pau-size-rail-inspector);
		display: grid;
		grid-template-areas:
			'command command command'
			'product context main';
		grid-template-columns: var(--pau-size-rail-product) var(--shell-context-width) minmax(0, 1fr);
		grid-template-rows: 2.75rem minmax(0, 1fr);
		min-width: 20rem;
		height: 100dvh;
		overflow: hidden;
		color: var(--shell-text);
		background: var(--shell-bg);
		font-family: var(--pau-font-ui);
		font-size: var(--pau-type-md);
		line-height: 1.4;
	}

	.app-shell--with-inspector {
		grid-template-areas:
			'command command command command'
			'product context main inspector';
		grid-template-columns: var(--pau-size-rail-product) var(--shell-context-width) minmax(24rem, 1fr) var(
				--shell-inspector-width
			);
	}

	/* Views without a contextual rail give its column to the main surface. */
	.app-shell--without-context {
		grid-template-areas:
			'command command'
			'product main';
		grid-template-columns: var(--pau-size-rail-product) minmax(0, 1fr);
	}

	.app-shell--without-context.app-shell--with-inspector {
		grid-template-areas:
			'command command command'
			'product main inspector';
		grid-template-columns: var(--pau-size-rail-product) minmax(24rem, 1fr) var(--shell-inspector-width);
	}

	/* Resize handles sit over the pane edges. They are separate grid items so scrolling a pane never moves them. */
	.app-shell__resizer {
		display: grid;
		align-self: stretch;
		min-width: 0;
	}

	.app-shell__resizer--context {
		grid-area: context;
		justify-self: end;
	}

	.app-shell__resizer--inspector {
		grid-area: inspector;
		justify-self: start;
	}

	/* Dragging must follow the pointer exactly, so nothing animates or selects. */
	.app-shell--resizing {
		cursor: col-resize;
		user-select: none;
	}

	.app-shell--resizing * {
		transition: none !important;
	}

	.app-shell__skip-link {
		position: fixed;
		top: 0.5rem;
		left: 0.5rem;
		z-index: 20;
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--shell-bg);
		background: var(--shell-focus);
		transform: translateY(-150%);
	}

	.app-shell__skip-link:focus {
		transform: translateY(0);
	}

	.app-shell__command-bar {
		grid-area: command;
		display: flex;
		align-items: center;
		gap: var(--pau-space-3);
		padding-inline: var(--pau-space-3);
		border-bottom: 1px solid var(--shell-border);
		background: var(--shell-bg);
	}

	/*
	 * The identity takes the free space so the status, toggles, and command field sit at the trailing edge.
	 * It never shrinks below the mark, so a narrow bar shrinks the command field instead of drawing the
	 * toggles over the mark.
	 */
	.app-shell__identity {
		display: flex;
		flex: 1;
		align-items: center;
		gap: var(--pau-space-2);
		min-width: 1.5rem;
		color: var(--shell-muted);
	}

	.app-shell__identity strong {
		color: var(--shell-text);
	}

	.app-shell__mark {
		flex: none;
		width: 1.5rem;
		height: 1.5rem;
		padding: var(--pau-space-1);
		color: var(--shell-bg);
		background: var(--shell-accent);
	}

	.app-shell__command-input {
		display: flex;
		flex: 0 1 auto;
		align-items: center;
		width: min(23rem, 45vw);
		min-width: var(--pau-size-row-md);
		height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-3);
		border: 1px solid var(--shell-border);
		border-radius: var(--pau-radius-control);
		background: var(--shell-surface);
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.app-shell__search-icon {
		width: 0.75rem;
		height: 0.75rem;
		margin-right: var(--pau-space-2);
		border: 1.5px solid var(--shell-muted);
		border-radius: 50%;
	}

	.app-shell__search-icon::after {
		display: block;
		width: 0.35rem;
		margin: var(--pau-space-2) 0 0 var(--pau-space-2);
		border-top: 1.5px solid var(--shell-muted);
		content: '';
		transform: rotate(45deg);
	}

	.app-shell__command-placeholder {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		color: var(--shell-muted);
		text-align: start;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.app-shell__command-input:hover {
		border-color: var(--shell-muted);
	}

	.app-shell__command-input kbd {
		color: var(--shell-faint);
		font: inherit;
	}

	.app-shell__product-rail {
		grid-area: product;
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--shell-border);
		background: var(--shell-bg);
	}

	.app-shell__product-rail ul,
	.app-shell__context-rail ul {
		display: grid;
		gap: var(--pau-space-1);
		margin: 0;
		padding: var(--pau-space-3) 0;
		list-style: none;
	}

	.app-shell__product-rail a,
	.app-shell__product-rail button {
		position: relative;
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: var(--pau-size-target-touch);
		margin-inline: auto;
		padding: 0;
		color: var(--shell-muted);
		background: transparent;
		border: 0;
		text-decoration: none;
	}

	.app-shell__product-rail a:hover {
		color: var(--shell-text);
		background: var(--shell-surface-raised);
	}

	.app-shell__product-rail .active {
		color: var(--shell-accent);
		background: var(--shell-surface-raised);
	}

	.app-shell__product-rail .app-shell__unavailable {
		cursor: not-allowed;
		opacity: 0.45;
	}

	.app-shell__attention {
		position: absolute;
		top: 0.45rem;
		right: 0.45rem;
		width: 0.4rem;
		height: 0.4rem;
		background: var(--shell-warning);
		border-radius: 50%;
	}

	.app-shell__context-rail {
		grid-area: context;
		min-width: 0;
		overflow-y: auto;
		border-right: 1px solid var(--shell-border);
		background: var(--shell-bg);
	}

	.app-shell__context-content {
		min-width: 0;
	}

	.app-shell__rail-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: var(--pau-size-row-lg);
		padding-inline: var(--pau-space-4) var(--pau-space-2);
		color: var(--shell-muted);
		font-size: var(--pau-type-label);
		font-weight: var(--pau-weight-semibold);
		letter-spacing: 0.055em;
		text-transform: uppercase;
	}

	.app-shell__rail-heading span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.app-shell__rail-heading button {
		display: none;
	}

	.app-shell__context-rail li {
		padding-inline: var(--pau-space-2);
	}

	.app-shell__context-rail a {
		display: grid;
		grid-template-columns: 0.5rem minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--pau-space-2);
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-3);
		color: var(--shell-muted);
		text-decoration: none;
	}

	.app-shell__context-rail a:hover,
	.app-shell__context-rail a.active {
		color: var(--shell-text);
		background: var(--shell-surface-raised);
	}

	@media (pointer: coarse) {
		.app-shell__context-rail a {
			min-height: var(--pau-size-target-touch);
		}
	}

	.app-shell__context-rail small {
		color: var(--shell-muted);
	}

	.app-shell__item-dot {
		width: 0.4rem;
		height: 0.4rem;
		background: var(--shell-accent);
		border-radius: 50%;
	}

	.app-shell__item-dot.attention {
		background: var(--shell-warning);
	}

	.app-shell__main {
		grid-area: main;
		display: grid;
		grid-template-rows: minmax(0, 1fr);
		min-width: 0;
		overflow: hidden;
		background: var(--shell-surface);
	}

	.app-shell__panel-toggles {
		display: flex;
		flex: none;
		gap: var(--pau-space-1);
	}

	.app-shell__panel-toggles .app-shell__icon-button {
		display: grid;
		width: var(--pau-size-row-md);
		height: var(--pau-size-row-md);
		border-radius: var(--pau-radius-control);
	}

	/* An open pane shows as a pressed toggle, as in the design prototype. */
	.app-shell__panel-toggles .app-shell__icon-button[aria-expanded='true'] {
		color: var(--shell-accent);
		background: var(--shell-surface-raised);
	}

	.app-shell__icon-button,
	.app-shell__rail-heading button {
		place-items: center;
		width: 2.75rem;
		height: var(--pau-size-target-touch);
		padding: 0;
		color: var(--shell-muted);
		background: transparent;
		border: 0;
		cursor: pointer;
	}

	.app-shell__icon-button:hover,
	.app-shell__rail-heading button:hover {
		color: var(--shell-text);
		background: var(--shell-surface-raised);
	}

	.app-shell__connection {
		display: flex;
		align-items: center;
		flex: none;
		gap: var(--pau-space-2);
		margin: 0;
		color: var(--shell-danger);
		white-space: nowrap;
		font-size: var(--pau-type-xs);
	}

	.app-shell__connection span {
		width: 0.45rem;
		height: 0.45rem;
		background: currentColor;
		border-radius: 50%;
	}

	.app-shell__main-content {
		min-height: 0;
		padding: var(--pau-space-6);
		overflow: auto;
	}

	.app-shell__inspector {
		grid-area: inspector;
		min-width: 0;
		overflow: auto;
		border-left: 1px solid var(--shell-border);
		background: var(--shell-bg);
	}

	.app-shell__inspector-content {
		padding: var(--pau-space-2) var(--pau-space-4) var(--pau-space-4);
	}

	.app-shell__backdrop {
		display: none;
	}

	.app-shell__sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	:global(.app-shell a:focus-visible),
	:global(.app-shell button:focus-visible),
	:global(.app-shell textarea:focus-visible),
	:global(.app-shell select:focus-visible) {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset-inset);
	}

	@media (max-width: 74rem) {
		.app-shell,
		.app-shell--with-inspector {
			grid-template-areas:
				'command command command'
				'product context main';
			grid-template-columns: var(--pau-size-rail-product) var(--shell-context-width) minmax(0, 1fr);
		}

		.app-shell--without-context,
		.app-shell--without-context.app-shell--with-inspector {
			grid-template-areas:
				'command command'
				'product main';
			grid-template-columns: var(--pau-size-rail-product) minmax(0, 1fr);
		}

		.app-shell__inspector {
			position: fixed;
			top: 2.75rem;
			right: 0;
			bottom: 0;
			z-index: 5;
			width: min(var(--pau-size-rail-inspector), calc(100vw - var(--pau-size-rail-product)));
			box-shadow: -1rem 0 2rem rgb(0 0 0 / 24%);
		}

		.app-shell__backdrop {
			position: fixed;
			inset: 2.75rem 0 0 0;
			z-index: 4;
			display: block;
			width: auto;
			height: auto;
			padding: 0;
			background: rgb(7 8 15 / 55%);
			border: 0;
		}

		.app-shell__inspector .app-shell__rail-heading button {
			display: grid;
		}

		.app-shell__resizer--inspector {
			display: none;
		}

		.app-shell__main-content {
			padding: var(--pau-space-5);
		}
	}

	@media (max-width: 48rem) {
		.app-shell__main-content {
			padding: var(--pau-space-4);
		}

		.app-shell,
		.app-shell--with-inspector {
			grid-template-areas:
				'command command'
				'product main';
			grid-template-columns: var(--pau-size-rail-product) minmax(0, 1fr);
		}

		.app-shell__identity > span:last-child,
		.app-shell__identity > span:nth-last-child(2),
		.app-shell__command-input kbd {
			display: none;
		}

		.app-shell__command-input {
			width: min(20rem, calc(100vw - 8rem));
		}

		.app-shell__resizer--context {
			display: none;
		}

		.app-shell__context-rail {
			position: fixed;
			top: 2.75rem;
			bottom: 0;
			left: var(--pau-size-rail-product);
			z-index: 6;
			width: min(var(--pau-size-rail-context), calc(100vw - var(--pau-size-rail-product)));
			box-shadow: 1rem 0 2rem rgb(0 0 0 / 24%);
			transform: translateX(calc(-110% * var(--pau-motion-travel)));
			opacity: 0;
			visibility: hidden;
			transition:
				transform var(--pau-duration-medium) var(--pau-ease-standard),
				opacity var(--pau-duration-medium) var(--pau-ease-standard),
				visibility var(--pau-duration-medium);
		}

		/* 0% matches the closed value's unit when travel is 0, so reduced motion starts no transform transition. */
		.app-shell__context-rail.open {
			transform: translateX(0%);
			opacity: 1;
			visibility: visible;
		}

		.app-shell__context-rail .app-shell__rail-heading button {
			display: grid;
		}
	}

	@media (max-width: 30rem) {
		.app-shell,
		.app-shell--with-inspector,
		.app-shell--without-context,
		.app-shell--without-context.app-shell--with-inspector {
			grid-template-areas:
				'command'
				'main'
				'product';
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: 2.75rem minmax(0, 1fr) var(--pau-size-rail-product);
		}

		.app-shell__product-rail {
			border-top: 1px solid var(--shell-border);
			border-right: 0;
		}

		.app-shell__product-rail ul {
			display: flex;
			justify-content: space-around;
			padding: var(--pau-space-1);
		}

		.app-shell__product-rail a,
		.app-shell__product-rail button {
			margin: 0;
		}

		.app-shell__context-rail {
			left: 0;
			bottom: var(--pau-size-rail-product);
			width: min(var(--pau-size-rail-context), 88vw);
		}

		.app-shell__inspector {
			left: 0;
			bottom: var(--pau-size-rail-product);
			width: 100%;
		}

		.app-shell__identity strong {
			display: none;
		}
	}
</style>
