<script lang="ts">
	import { flushSync, type Snippet } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';

	import type { IconKind } from '../icons';
	import '../styles/tokens.css';
	import { themeCssProperties, type ThemeName, type UiFontName } from '../theme';
	import type { PaletteEntry } from './command-palette';
	import CommandPalette from './CommandPalette.svelte';
	import { createFocusReturn, returnFocus } from './focus-return';
	import Icon from './Icon.svelte';
	import { getKeymap, useKeyActions } from './keymap.svelte';
	import PaneResizer from './PaneResizer.svelte';
	import { getShellBay } from './shell-bay';
	import { getShellStatusBar } from './shell-status-bar';
	import { setWorkspaceColumn } from './workspace-column';

	/**
	 * One view in the view row, or one row in a view's section column, such
	 * as a Settings section.
	 *
	 * An item without `href` cannot be opened. The view row shows it disabled
	 * and explains why with `unavailable`, so a view that does not work yet
	 * never opens as an empty page.
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
		/** Key map action that opens the view, whose chord the tooltip shows. */
		action?: string;
		status?: string;
		/** Number of entries behind the item, shown after the label without a state dot. */
		count?: number;
		attention?: boolean;
		active?: boolean;
		/**
		 * Lists the view only in the command palette, for destinations that
		 * another view links to, such as Agent sandbox from Settings.
		 */
		paletteOnly?: boolean;
	};

	/**
	 * Operator-chosen widths of the resizable columns in CSS pixels: the bay
	 * (`contextRail`) and the workspace column (`inspector`). `null` keeps a
	 * column at its default width.
	 */
	export type ShellPaneWidths = { contextRail: number | null; inspector: number | null };

	type Props = {
		/** Names the view's section column, such as Sections in Settings. */
		contextLabel: string;
		/** The views in the view row at the foot of the left column. */
		productItems: ShellNavItem[];
		/** Rows of the section column when there is no `context`, such as Settings sections. */
		contextItems?: ShellNavItem[];
		disconnected?: boolean;
		theme?: ThemeName;
		uiFont?: UiFontName;
		/** Saved column widths to apply. The shell keeps no copy of its own across launches. */
		paneWidths?: ShellPaneWidths;
		/** Called when a resize ends or a keyboard step lands, with every column's width. */
		onResize?: (widths: ShellPaneWidths) => void;
		/**
		 * Workspaces and sessions the command palette lists. The palette adds the
		 * views and the key map's actions itself.
		 */
		paletteEntries?: PaletteEntry[];
		children?: Snippet;
		/**
		 * The strip bay: the whole left column above the view row, from its
		 * 48px top bar to its scrolling strips. Without it, the shell uses the
		 * bay an ancestor shares through `setShellBay`.
		 */
		bay?: Snippet;
		/**
		 * The view's section column, under a heading that names it, such as
		 * the Files tree. With a bay it opens the main surface. Without one it
		 * fills the left column in the bay's place.
		 */
		context?: Snippet;
		/**
		 * Floating content that opens from anywhere in the shell, such as a
		 * context menu. It renders outside the regions an open overlay makes
		 * inert, so a menu opened from the overlay still takes the keyboard.
		 */
		layer?: Snippet;
		/**
		 * Detail for the open item, such as a session's changes and branch. It
		 * docks beside the main surface from 1200px and opens as an overlay below.
		 */
		workspace?: Snippet;
		/** Accessible name of the workspace column and the title in its header. */
		workspaceLabel?: string;
		/** Header content of the workspace column in place of `workspaceLabel`. */
		workspaceHeader?: Snippet;
		/**
		 * Terminals docked below the main surface content. With it, the key
		 * map's dock shortcut works. Narrow windows give an open dock the whole
		 * main surface instead of a strip.
		 */
		dock?: Snippet;
		/** Whether the dock shows. The app owns it, so the dock can stay open across views. */
		dockOpen?: boolean;
		/** Called when the operator shows or hides the dock. */
		onDockToggle?: (open: boolean) => void;
		/** Operator-chosen dock height in CSS pixels. `null` keeps the default. */
		dockHeight?: number | null;
		/** Called with the new height after the operator resizes the dock, or `null` after a reset. */
		onDockResize?: (height: number | null) => void;
	};

	let {
		contextLabel,
		productItems,
		contextItems = [],
		disconnected = false,
		theme = 'eldritch',
		uiFont = 'overpass',
		paneWidths = { contextRail: null, inspector: null },
		onResize,
		paletteEntries = [],
		children,
		bay: ownBay,
		context,
		layer,
		workspace,
		workspaceLabel = 'Workspace',
		workspaceHeader,
		dock,
		dockOpen = false,
		onDockToggle,
		dockHeight = null,
		onDockResize
	}: Props = $props();

	const sharedBay = getShellBay();
	const bay = $derived(ownBay ?? sharedBay);
	/** The status bar an ancestor shares, which spans the foot of every view. */
	const statusBar = getShellStatusBar();
	/** Whether the view has a section column. With a bay, it opens the main surface. */
	const sectioned = $derived(Boolean(context) || contextItems.length > 0);
	const keymap = getKeymap();
	let paletteOpen = $state(false);
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

	/** Whether any left column row has a state to mark. Then every row keeps the dot column, so all labels share one edge. */
	let contextMarked = $derived(contextItems.some((item) => item.status !== undefined || item.attention));

	/** Below 1200px the workspace column leaves the grid and opens over the main surface. */
	const narrow = new MediaQuery('max-width: 1199.98px');
	/** Whether the operator hid the docked column. Only the key map can, since the column holds detail, not navigation. */
	let workspaceHidden = $state(false);
	/** Whether the overlay is open. It never opens on its own, so new detail never covers the main surface. */
	let overlayOpen = $state(false);
	let workspaceVisible = $derived(Boolean(workspace) && (narrow.current ? overlayOpen : !workspaceHidden));
	/** Whether the overlay covers the page, which then leaves the keyboard and pointer to it. */
	let overlayShown = $derived(workspaceVisible && narrow.current);

	const workspaceFocus = createFocusReturn();
	const dockFocus = createFocusReturn();
	let workspacePanel = $state<HTMLElement>();

	function toggleWorkspace(): void {
		if (!workspace) return;
		if (!narrow.current) {
			workspaceHidden = !workspaceHidden;
			return;
		}
		if (overlayOpen) closeOverlay();
		else {
			workspaceFocus.capture();
			overlayOpen = true;
		}
	}

	function closeOverlay(): void {
		overlayOpen = false;
		// The page behind leaves `inert` only once the update applies, and an inert control cannot take focus.
		flushSync();
		workspaceFocus.restore();
	}

	/** Elements Tab can reach, in document order. */
	const TAB_STOPS =
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

	/**
	 * Closes the overlay on Escape and keeps Tab inside it. The page behind is
	 * inert, so without the wrap Tab past the last control leaves focus on the
	 * document body, outside the modal panel.
	 */
	function handleOverlayKeydown(event: KeyboardEvent): void {
		if (!workspacePanel || event.defaultPrevented || !narrow.current) return;
		if (event.key === 'Escape') {
			event.stopPropagation();
			closeOverlay();
			return;
		}
		if (event.key !== 'Tab') return;
		const stops = [...workspacePanel.querySelectorAll<HTMLElement>(TAB_STOPS)].filter((stop) => stop.checkVisibility());
		const first = stops[0];
		const last = stops.at(-1);
		if (!first || !last) {
			event.preventDefault();
			return;
		}
		const active = document.activeElement;
		if (event.shiftKey && (active === first || active === workspacePanel)) {
			event.preventDefault();
			last.focus();
		} else if (active === last && !event.shiftKey) {
			event.preventDefault();
			first.focus();
		}
	}

	// The overlay takes focus as it opens, so the keyboard lands inside it.
	$effect(() => {
		if (!workspacePanel || !overlayOpen || !narrow.current) return;
		workspacePanel.focus({ preventScroll: true });
	});

	// Widening the window docks the column, so an open overlay closes without moving focus.
	$effect(() => {
		if (!narrow.current) overlayOpen = false;
	});

	setWorkspaceColumn({
		get available() {
			return Boolean(workspace);
		},
		get overlay() {
			return narrow.current;
		},
		get visible() {
			return workspaceVisible;
		},
		get label() {
			return workspaceLabel;
		},
		toggle: toggleWorkspace
	});

	/** Shows or hides the dock. The terminal takes focus as it opens. */
	function toggleDock(): void {
		if (!dockOpen) dockFocus.capture();
		onDockToggle?.(!dockOpen);
	}

	/**
	 * However the dock closes, from the toggle, its shortcut or a control
	 * inside it, focus goes back to whatever opened it. A dock that was
	 * already open when the view mounted has no opener, so focus goes to the
	 * composer.
	 */
	let dockWasOpen = false;
	$effect(() => {
		const open = Boolean(dock && dockOpen);
		if (dockWasOpen && !open) {
			dockFocus.restore();
			if (!document.activeElement || document.activeElement === document.body) returnFocus(null);
		}
		dockWasOpen = open;
	});

	useKeyActions({
		'palette.open': () => {
			paletteOpen = !paletteOpen;
		},
		'panel.inspector': toggleWorkspace
	});

	// The dock shortcut exists only while there is a dock to toggle. A shell
	// without one leaves Ctrl+` to the program in a terminal, where it sends NUL.
	$effect(() => {
		if (dock) return keymap?.register('panel.dock', toggleDock);
	});

	/** Labels a view's tooltip with the chord of its key map action. */
	function viewShortcut(item: ShellNavItem): string | undefined {
		return item.action ? keymap?.shortcut(item.action) : undefined;
	}

	/** Shortest the dock may be, enough for its tab bar and a few lines. */
	const MIN_DOCK_HEIGHT = 120;
	/** Height the content above an open dock keeps. */
	const MIN_ABOVE_DOCK = 160;
	let mainHeight = $state(0);
	let dockMeasured = $state(0);
	let dockDragging = $state(false);
	let maxDockHeight = $derived(Math.max(MIN_DOCK_HEIGHT, mainHeight - MIN_ABOVE_DOCK));
	/** The kept height, shrunk when the window can no longer fit it. */
	let appliedDockHeight = $derived(
		dockHeight === null || mainHeight === 0
			? dockHeight
			: Math.min(Math.max(dockHeight, MIN_DOCK_HEIGHT), maxDockHeight)
	);
	let mainElement = $state<HTMLElement>();

	/** Puts the dock back at its kept height after a cancelled drag. */
	function restoreDockHeight(): void {
		if (appliedDockHeight === null) mainElement?.style.removeProperty('--pau-shell-dock-height');
		else mainElement?.style.setProperty('--pau-shell-dock-height', `${appliedDockHeight}px`);
	}

	/** Narrowest each column may be: the bay keeps its narrow width, and the workspace column its rows. */
	const MIN_WIDTH = { contextRail: 288, inspector: 240 } as const;
	/** Width the main surface keeps, matching the `minmax(24rem, 1fr)` grid track. */
	const MIN_MAIN_WIDTH = 384;

	let shell = $state<HTMLElement>();
	let shellWidth = $state(0);
	let bayWidth = $state(0);
	let workspaceWidth = $state(0);
	let bayDragging = $state(false);
	let workspaceDragging = $state(false);
	/** Widths kept by the latest resize. They stay in effect until `paneWidths` changes. */
	let kept = $derived<ShellPaneWidths>({ ...paneWidths });
	let workspaceDocked = $derived(Boolean(workspace) && !narrow.current && !workspaceHidden);

	/** Largest width a column can take while the main surface keeps its minimum. */
	function maxPaneWidth(pane: keyof ShellPaneWidths): number {
		const sibling = pane === 'contextRail' ? (workspaceDocked ? workspaceWidth : 0) : bayWidth;
		return Math.max(MIN_WIDTH[pane], shellWidth - sibling - MIN_MAIN_WIDTH);
	}

	/**
	 * Applies a saved width, shrinking it when the window can no longer fit it.
	 * The bay claims space first and leaves the docked workspace column its
	 * minimum. A narrow window keeps the bay at its narrow width, so a wide
	 * saved bay never squeezes the transcript.
	 */
	function appliedWidth(pane: keyof ShellPaneWidths): number | null {
		const width = kept[pane];
		if (width === null || shellWidth === 0) return width;
		if (pane === 'contextRail' && narrow.current) return null;
		const available = shellWidth - MIN_MAIN_WIDTH;
		if (pane === 'contextRail')
			return Math.max(MIN_WIDTH.contextRail, Math.min(width, available - (workspaceDocked ? MIN_WIDTH.inspector : 0)));
		const left = appliedWidth('contextRail') ?? bayWidth;
		return Math.max(MIN_WIDTH.inspector, Math.min(width, available - left));
	}

	const widthProperty = { contextRail: '--pau-shell-bay-width', inspector: '--pau-shell-workspace-width' } as const;

	let paneProperties = $derived(
		Object.fromEntries(
			(['contextRail', 'inspector'] as const).flatMap((pane) => {
				const width = appliedWidth(pane);
				return width === null ? [] : [[widthProperty[pane], `${width}px`]];
			})
		)
	);

	/** Moves a column's edge for the current frame without re-rendering the shell. */
	function previewWidth(pane: keyof ShellPaneWidths, width: number) {
		shell?.style.setProperty(widthProperty[pane], `${width}px`);
	}

	/** Puts the column back where the last kept width placed it. */
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

{#snippet sectionColumn()}
	<aside class="app-shell__context" aria-label={contextLabel}>
		<!-- The aside already carries the name, so the label is not a second heading. -->
		<div class="app-shell__context-heading pau-bay-heading" aria-hidden="true">
			<span class="pau-section-label">{contextLabel}</span>
		</div>
		<div class="app-shell__context-content">
			{#if context}
				{@render context()}
			{:else}
				<ul class:app-shell__context-list--marked={contextMarked}>
					{#each contextItems as item (item.id)}
						<li>
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the app owner resolves destinations -->
							<a
								href={item.href}
								class="pau-row"
								class:active={item.active}
								aria-current={item.active ? 'page' : undefined}>
								<!-- The dot marks an item's state. An item without one gets an empty cell in a list that shows dots. -->
								{#if contextMarked}
									<span
										class:app-shell__item-dot={item.status !== undefined || item.attention}
										class:attention={item.attention}></span>
								{/if}
								<span class="pau-cap pau-cap--truncate">{item.label}</span>
								{#if item.status}<small class="pau-cap">{item.status}</small>{:else if item.count !== undefined}<small
										class="pau-count">{item.count}</small
									>{/if}
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</aside>
{/snippet}

<a class="app-shell__skip-link" href="#main-surface" inert={overlayShown}>Skip to main surface</a>
<div
	class:app-shell--with-workspace={workspaceDocked}
	class:app-shell--resizing={bayDragging || workspaceDragging}
	class:app-shell--resizing-rows={dockDragging}
	bind:this={shell}
	bind:offsetWidth={shellWidth}
	class="app-shell"
	data-theme={theme}
	data-ui-font={uiFont}
	style={shellStyle}>
	<CommandPalette
		bind:open={paletteOpen}
		entries={[...actionEntries, ...paletteEntries, ...viewEntries]}
		entrance="keyboard"
		toggleKeys={paletteKeys} />

	<div id="shell-bay" class="app-shell__bay" inert={overlayShown} bind:offsetWidth={bayWidth}>
		{#if bay}
			{@render bay()}
		{:else}
			{@render sectionColumn()}
		{/if}

		<nav class="app-shell__views" aria-label="Views">
			<ul>
				{#each productItems.filter((candidate) => !candidate.paletteOnly) as item (item.id)}
					{@const reason = item.href ? undefined : (item.unavailable ?? 'Coming soon')}
					{@const shortcut = viewShortcut(item)}
					<li>
						{#if item.href}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the app owner resolves destinations -->
							<a
								href={item.href}
								class="app-shell__view pau-utility-button"
								aria-current={item.active ? 'page' : undefined}
								aria-label={item.label}
								aria-describedby={`view-${item.id}-tip`}>
								<Icon name={item.icon ?? 'agents'} size={16} />
								{#if item.attention}<span class="app-shell__attention" role="img" aria-label="Needs attention"></span
									>{/if}
							</a>
						{:else}
							<button
								type="button"
								class="app-shell__view pau-utility-button"
								aria-current={item.active ? 'page' : undefined}
								aria-disabled="true"
								aria-label={item.label}
								aria-describedby={`view-${item.id}-tip`}>
								<Icon name={item.icon ?? 'agents'} size={16} />
							</button>
						{/if}
						<span class="app-shell__tip" role="tooltip" id={`view-${item.id}-tip`}>
							<span class="app-shell__tip-line"
								><span class="pau-cap">{item.label}</span>{#if shortcut}<kbd class="pau-kbd"
										><span>{shortcut}</span></kbd
									>{/if}</span>
							{#if reason}<span class="app-shell__tip-reason">{reason}</span>{/if}
						</span>
					</li>
				{/each}
			</ul>
			<!-- A healthy connection stays silent so the shell never implies Pi itself works. -->
			{#if disconnected}
				<p class="app-shell__connection pau-state pau-tone-danger" role="status">
					<span class="pau-mark pau-mark--failed" aria-hidden="true"></span><span>Disconnected</span>
				</p>
			{/if}
		</nav>
	</div>
	<div class="app-shell__resizer app-shell__resizer--bay" inert={overlayShown}>
		<PaneResizer
			label="Resize the session bay"
			controls="shell-bay"
			value={bayWidth}
			min={MIN_WIDTH.contextRail}
			max={maxPaneWidth('contextRail')}
			direction={1}
			bind:dragging={bayDragging}
			onPreview={(width) => previewWidth('contextRail', width)}
			onCommit={(width) => keepWidth('contextRail', width)}
			onCancel={() => cancelPreview('contextRail')} />
	</div>

	<main
		id="main-surface"
		class="app-shell__main"
		class:app-shell__main--docked={dock && dockOpen}
		class:app-shell__main--sectioned={bay && sectioned}
		inert={overlayShown}
		tabindex="-1"
		style:--pau-shell-dock-height={dock && dockOpen && appliedDockHeight !== null
			? `${appliedDockHeight}px`
			: undefined}
		bind:this={mainElement}
		bind:clientHeight={mainHeight}>
		{#if bay && sectioned}{@render sectionColumn()}{/if}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div class="app-shell__main-content" role="region" aria-label="Main surface content" tabindex="0">
			{#if children}{@render children()}{/if}
		</div>
		{#if dock && dockOpen}
			<div class="app-shell__resizer app-shell__resizer--dock">
				<PaneResizer
					label="Resize terminal dock"
					controls="shell-dock"
					orientation="horizontal"
					value={dockMeasured}
					min={MIN_DOCK_HEIGHT}
					max={maxDockHeight}
					direction={-1}
					bind:dragging={dockDragging}
					onPreview={(height) => mainElement?.style.setProperty('--pau-shell-dock-height', `${height}px`)}
					onCommit={(height) => {
						if (height === null) mainElement?.style.removeProperty('--pau-shell-dock-height');
						onDockResize?.(height);
					}}
					onCancel={() => restoreDockHeight()} />
			</div>
			<section id="shell-dock" class="app-shell__dock" aria-label="Terminal dock" bind:offsetHeight={dockMeasured}>
				{@render dock()}
			</section>
		{/if}
	</main>

	{#if workspace && workspaceVisible}
		{#if narrow.current}
			<button
				type="button"
				class="app-shell__scrim"
				tabindex="-1"
				aria-label={`Close ${workspaceLabel.toLowerCase()}`}
				onclick={closeOverlay}></button>
		{/if}
		<!-- Escape and Tab bubble from the controls inside the overlay. -->
		<aside
			id="shell-workspace"
			class="app-shell__workspace"
			class:app-shell__workspace--overlay={narrow.current}
			role={narrow.current ? 'dialog' : undefined}
			aria-modal={narrow.current ? 'true' : undefined}
			aria-label={workspaceLabel}
			tabindex="-1"
			bind:this={workspacePanel}
			bind:offsetWidth={workspaceWidth}
			onkeydown={handleOverlayKeydown}>
			<header class="app-shell__workspace-head">
				{#if workspaceHeader}
					{@render workspaceHeader()}
				{:else}
					<h2 class="app-shell__workspace-title pau-cap pau-cap--truncate">{workspaceLabel}</h2>
				{/if}
				{#if narrow.current}
					<button
						type="button"
						class="app-shell__workspace-close pau-utility-button"
						aria-label={`Close ${workspaceLabel.toLowerCase()}`}
						onclick={closeOverlay}>
						<Icon name="close" size={16} />
					</button>
				{/if}
			</header>
			<div class="app-shell__workspace-body">{@render workspace()}</div>
		</aside>
		{#if !narrow.current}
			<div class="app-shell__resizer app-shell__resizer--workspace">
				<PaneResizer
					label={`Resize the ${workspaceLabel.toLowerCase()} column`}
					controls="shell-workspace"
					value={workspaceWidth}
					min={MIN_WIDTH.inspector}
					max={maxPaneWidth('inspector')}
					direction={-1}
					bind:dragging={workspaceDragging}
					onPreview={(width) => previewWidth('inspector', width)}
					onCommit={(width) => keepWidth('inspector', width)}
					onCancel={() => cancelPreview('inspector')} />
			</div>
		{/if}
	{/if}
	{#if statusBar}
		<div class="app-shell__status" inert={overlayShown}>{@render statusBar()}</div>
	{/if}
	{#if layer}{@render layer()}{/if}
</div>

<style>
	:global(*) {
		box-sizing: border-box;
	}

	.app-shell {
		--pau-shell-bay-width: var(--pau-size-bay);
		--pau-shell-workspace-width: var(--pau-size-workspace);
		/*
		 * The main surface's padding. A view that runs edge to edge, such as
		 * Files or Terminals, cancels it with this value, so the two never drift
		 * apart.
		 */
		--pau-shell-padding: var(--pau-space-5);
		/*
		 * Where content starts inside the bay, the workspace column or an
		 * edge-to-edge view: headings, rows, view titles, and the bars under
		 * them share this leading edge.
		 */
		--pau-shell-inset: var(--pau-space-4);
		display: grid;
		grid-template-areas:
			'bay main'
			'status status';
		grid-template-columns: var(--pau-shell-bay-width) minmax(0, 1fr);
		grid-template-rows: minmax(0, 1fr) auto;
		height: 100dvh;
		overflow: hidden;
		color: var(--pau-text);
		background-color: var(--pau-canvas);
		font-family: var(--pau-font-ui);
		font-size: var(--pau-type-md);
		line-height: var(--pau-leading-row);
	}

	.app-shell--with-workspace {
		grid-template-areas:
			'bay main workspace'
			'status status status';
		grid-template-columns: var(--pau-shell-bay-width) minmax(24rem, 1fr) var(--pau-shell-workspace-width);
	}

	/* Resize handles sit over the column edges. They are separate grid items so scrolling a column never moves them. */
	.app-shell__resizer {
		display: grid;
		align-self: stretch;
		min-width: 0;
	}

	.app-shell__resizer--bay {
		grid-area: bay;
		justify-self: end;
	}

	.app-shell__resizer--workspace {
		grid-area: workspace;
		justify-self: start;
	}

	/* The dock's handle overlaps the top edge of the dock, inside the main column. */
	.app-shell__resizer--dock {
		grid-row: 2;
		height: 0;
		align-self: start;
	}

	.app-shell__resizer--dock :global(.pane-resizer) {
		translate: 0 -50%;
	}

	/* Dragging must follow the pointer exactly, so nothing animates or selects. */
	.app-shell--resizing {
		cursor: col-resize;
		user-select: none;
	}

	.app-shell--resizing-rows {
		cursor: row-resize;
		user-select: none;
	}

	.app-shell--resizing * {
		transition: none !important;
	}

	.app-shell__skip-link {
		position: fixed;
		top: var(--pau-space-2);
		left: var(--pau-space-2);
		z-index: 20;
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--pau-canvas);
		background-color: var(--pau-focus);
		transform: translateY(-150%);
	}

	.app-shell__skip-link:focus {
		transform: translateY(0);
	}

	/* The bay and its view row. The bay's own content scrolls; the view row stays at the foot. */
	.app-shell__bay {
		grid-area: bay;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		background-color: var(--pau-surface);
		border-right: 1px solid var(--pau-border);
	}

	.app-shell__bay > :global(:first-child) {
		flex: 1;
		min-height: 0;
	}

	.app-shell__context {
		display: flex;
		flex-direction: column;
	}

	/* A view without a bay names its left column on the same 48px line as the other column headers. */
	.app-shell__context-heading {
		flex: none;
		height: var(--pau-size-header);
		padding-top: 0;
		border-bottom: 1px solid var(--pau-border);
	}

	.app-shell__context-content {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	.app-shell__context ul {
		display: grid;
		gap: var(--pau-space-1);
		margin: 0;
		padding: var(--pau-space-2) 0;
		list-style: none;
	}

	.app-shell__context li {
		padding-inline: var(--pau-space-2);
	}

	.app-shell__context a {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--pau-space-2);
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-2);
		text-decoration: none;
	}

	.app-shell__context-list--marked a {
		grid-template-columns: 0.5rem minmax(0, 1fr) auto;
	}

	.app-shell__context a.active {
		color: var(--pau-text);
		background-color: var(--pau-surface-selected);
		box-shadow: inset 0 0 0 1px var(--pau-border-control);
	}

	@media (pointer: coarse) {
		.app-shell__context a {
			min-height: var(--pau-size-target-touch);
		}
	}

	.app-shell__context small {
		color: var(--pau-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.app-shell__item-dot {
		width: 0.5rem;
		height: 0.5rem;
		background-color: var(--pau-text-muted);
		border-radius: 50%;
	}

	.app-shell__item-dot.attention {
		background-color: var(--pau-accent);
	}

	/*
	 * The view row: one 32px quiet icon button per view across the bay's
	 * foot, on the 48px line of the other column edges. The current view takes
	 * the selected treatment.
	 */
	.app-shell__views {
		display: flex;
		flex: none;
		align-items: center;
		gap: var(--pau-space-2);
		min-height: var(--pau-size-header);
		padding-inline: var(--pau-space-4);
		border-top: 1px solid var(--pau-border);
	}

	.app-shell__views ul {
		display: flex;
		gap: var(--pau-space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.app-shell__views li {
		position: relative;
	}

	.app-shell__view {
		position: relative;
		display: grid;
		place-items: center;
		width: var(--pau-size-row-md);
		height: var(--pau-size-row-md);
		padding: 0;
		border: 0;
		border-radius: var(--pau-radius-control);
		text-decoration: none;
	}

	@media (pointer: coarse) {
		.app-shell__view {
			width: var(--pau-size-target-touch);
			height: var(--pau-size-target-touch);
		}
	}

	.app-shell__view[aria-current='page'] {
		color: var(--pau-text);
		background-color: var(--pau-surface-selected);
		box-shadow: inset 0 0 0 1px var(--pau-border-control);
	}

	.app-shell__view[aria-disabled='true'] {
		cursor: not-allowed;
	}

	.app-shell__view:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset);
	}

	/* An 8px accent dot on the view that holds sessions waiting on the operator. */
	.app-shell__attention {
		position: absolute;
		top: var(--pau-space-1);
		right: var(--pau-space-1);
		width: 0.375rem;
		height: 0.375rem;
		background-color: var(--pau-accent);
		border-radius: 50%;
	}

	/*
	 * The view's name, chord and, when it cannot open, the reason. It opens
	 * above the button on hover and keyboard focus, so the pointer and the
	 * keyboard read the same thing. The first views anchor it at their left
	 * edge and the last at their right, so it never leaves the bay.
	 */
	.app-shell__tip {
		position: absolute;
		bottom: calc(100% + var(--pau-space-2));
		left: 0;
		z-index: 10;
		display: none;
		gap: var(--pau-space-1);
		width: max-content;
		max-width: 16rem;
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--pau-text);
		background-color: var(--pau-surface-overlay);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-overlay);
		box-shadow: var(--pau-shadow-overlay);
		font-size: var(--pau-type-xs);
		line-height: var(--pau-leading-tight);
		pointer-events: none;
	}

	.app-shell__views li:nth-child(n + 4) .app-shell__tip {
		right: 0;
		left: auto;
	}

	.app-shell__views li:has(> .app-shell__view:focus-visible) .app-shell__tip {
		display: grid;
	}

	@media (hover: hover) {
		.app-shell__views li:has(> .app-shell__view:hover) .app-shell__tip {
			display: grid;
		}
	}

	.app-shell__tip-line {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
	}

	.app-shell__tip-reason {
		color: var(--pau-text-muted);
	}

	.app-shell__connection {
		margin: 0 0 0 auto;
		white-space: nowrap;
	}

	.app-shell__main {
		grid-area: main;
		display: grid;
		grid-template-rows: minmax(0, 1fr);
		min-width: 0;
		overflow: hidden;
		background-color: var(--pau-canvas);
	}

	/*
	 * A view's section column opens the main surface when the bay holds the
	 * left column, as Settings sections and the Files tree do.
	 */
	.app-shell__main--sectioned {
		grid-template-columns: var(--pau-size-section-nav) minmax(0, 1fr);
	}

	.app-shell__main--sectioned > .app-shell__context {
		grid-row: 1;
		min-height: 0;
		background-color: var(--pau-surface);
		border-right: 1px solid var(--pau-border);
	}

	.app-shell__main--sectioned > :is(.app-shell__resizer--dock, .app-shell__dock) {
		grid-column: 1 / -1;
	}

	.app-shell__main-content {
		grid-row: 1;
		min-height: 0;
		padding: var(--pau-shell-padding);
		overflow: auto;
	}

	/* A percentage row resolves against the main surface's height. */
	.app-shell__main--docked {
		grid-template-rows: minmax(0, 1fr) 0 var(--pau-shell-dock-height, 40%);
	}

	.app-shell__dock {
		grid-row: 3;
		min-height: 0;
		border-top: 1px solid var(--pau-border);
		background-color: var(--pau-canvas);
	}

	.app-shell__status {
		grid-area: status;
		min-width: 0;
	}

	.app-shell__workspace {
		grid-area: workspace;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		background-color: var(--pau-surface);
		border-left: 1px solid var(--pau-border);
	}

	.app-shell__workspace:focus-visible {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset-inset);
	}

	.app-shell__workspace-head {
		display: flex;
		flex: none;
		align-items: center;
		gap: var(--pau-space-2);
		min-width: 0;
		height: var(--pau-size-header);
		padding: 0 var(--pau-space-2) 0 var(--pau-shell-inset);
		border-bottom: 1px solid var(--pau-border);
	}

	.app-shell__workspace-head > :global(:first-child) {
		flex: 1;
	}

	.app-shell__workspace-title {
		margin: 0;
		font-size: var(--pau-type-md);
		font-weight: var(--pau-weight-semibold);
		line-height: var(--pau-leading-tight);
	}

	.app-shell__workspace-close {
		display: grid;
		flex: none;
		place-items: center;
		width: var(--pau-size-row-md);
		height: var(--pau-size-row-md);
		padding: 0;
		border: 0;
		border-radius: var(--pau-radius-control);
	}

	.app-shell__workspace-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.app-shell__scrim {
		display: none;
	}

	:global(.app-shell a:focus-visible),
	:global(.app-shell button:focus-visible),
	:global(.app-shell textarea:focus-visible),
	:global(.app-shell select:focus-visible) {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset-inset);
	}

	/*
	 * Narrow, 900 to 1199px: the bay narrows to 288px and hides the agent
	 * name on strips, the workspace column becomes an overlay that slides in
	 * from the right over a scrim, and an open dock takes the whole main
	 * surface.
	 */
	@media (max-width: 1199.98px) {
		.app-shell {
			--pau-shell-bay-width: var(--pau-size-bay-narrow);
		}

		.app-shell__bay :global(.pau-strip__agent) {
			display: none;
		}

		.app-shell__workspace--overlay {
			position: fixed;
			top: 0;
			right: 0;
			bottom: 0;
			z-index: 30;
			width: min(var(--pau-size-workspace), 100vw);
			border-left-color: var(--pau-border-control);
			box-shadow: var(--pau-shadow-overlay);
			animation: app-shell-overlay-in var(--pau-duration-move) var(--pau-ease-out);
		}

		.app-shell__scrim {
			position: fixed;
			inset: 0;
			z-index: 25;
			display: block;
			padding: 0;
			background-color: rgb(6 8 14 / 56%);
			border: 0;
			animation: app-shell-scrim-in var(--pau-duration-move) var(--pau-ease-out);
		}

		.app-shell__main--docked {
			grid-template-rows: 0 0 minmax(0, 1fr);
		}

		.app-shell__main--docked > :is(.app-shell__main-content, .app-shell__context),
		.app-shell__resizer--dock {
			display: none;
		}

		.app-shell__dock {
			border-top: 0;
		}

		.app-shell__resizer--bay {
			display: none;
		}
	}

	/* Under reduced motion the travel is zero, so the overlay fades in. */
	@keyframes app-shell-overlay-in {
		from {
			opacity: 0;
			transform: translateX(calc(2rem * var(--pau-motion-travel)));
		}
	}

	@keyframes app-shell-scrim-in {
		from {
			opacity: 0;
		}
	}
</style>
