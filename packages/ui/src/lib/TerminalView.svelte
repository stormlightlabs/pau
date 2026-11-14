<script lang="ts">
	import '../styles/tokens.css';
	import '@xterm/xterm/css/xterm.css';
	import { FitAddon } from '@xterm/addon-fit';
	import { SearchAddon, type ISearchOptions, type ISearchResultChangeEvent } from '@xterm/addon-search';
	import { Unicode11Addon } from '@xterm/addon-unicode11';
	import { WebLinksAddon } from '@xterm/addon-web-links';
	import { Terminal } from '@xterm/xterm';
	import { onMount, tick } from 'svelte';

	import { terminalTheme, THEMES, type ThemeName } from '../theme';
	import { useExternalLinks } from './external-links';
	import Icon from './Icon.svelte';
	import { detectPlatform, eventChord, getKeymap, type KeyPlatform } from './keymap.svelte';
	import { createTerminalPathLinks } from './terminal-links';
	import type { TerminalConnection, TerminalConnectionEvents, TerminalExit, TerminalFileLinks } from './types/terminal';

	type Props = {
		/** Accessible name of the terminal region. */
		label: string;
		theme?: ThemeName;
		/** Whether this terminal is the visible one. Activation fits and focuses it. */
		active?: boolean;
		connect: (events: TerminalConnectionEvents) => TerminalConnection;
		onexit?: (status: TerminalExit) => void;
		ondisconnect?: () => void;
		onselectionchange?: (hasSelection: boolean) => void;
		/** Called when live output arrives. Scrollback replayed on connect does not count. */
		onoutput?: () => void;
		/** Turns workspace file paths in the output into links. Without it, paths stay plain text. */
		fileLinks?: TerminalFileLinks;
		/** Platform whose find shortcut opens search. Tests set it. */
		platform?: KeyPlatform;
	};

	let {
		label,
		theme = 'eldritch',
		active = true,
		connect,
		onexit,
		ondisconnect,
		onselectionchange,
		onoutput,
		fileLinks,
		platform = detectPlatform()
	}: Props = $props();

	/** Installed monospace faces that xterm can measure before the bundled code font loads. */
	const SYSTEM_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

	const links = useExternalLinks();
	const keymap = getKeymap();

	/**
	 * The terminal sends every key to its program, except the dock shortcut,
	 * which a keyboard operator needs to leave a docked terminal.
	 */
	function isDockChord(event: KeyboardEvent): boolean {
		const chord = eventChord(event);
		const dock = keymap?.actions.find((action) => action.id === 'panel.dock');
		return chord !== undefined && Boolean(dock?.keys.includes(chord)) && Boolean(keymap?.canRun('panel.dock'));
	}
	/** The search addon stops counting and highlighting past this many matches. */
	const MATCH_LIMIT = 1000;

	let host: HTMLDivElement;
	let terminal = $state.raw<Terminal>();
	let fitAddon: FitAddon | undefined;
	let searchAddon: SearchAddon | undefined;

	let searching = $state(false);
	let query = $state('');
	let results = $state<ISearchResultChangeEvent>();
	let searchInput = $state<HTMLInputElement>();

	const matchCount = $derived.by(() => {
		if (!query || !results) return '';
		if (results.resultCount === 0) return 'No matches';
		if (results.resultIndex < 0) return `${MATCH_LIMIT}+ matches`;
		return `${results.resultIndex + 1} of ${results.resultCount}`;
	});

	/** Fits the grid to the container. A hidden container has no size to measure. */
	/** Sends the measured grid to the program once per connection. Set while connected. */
	let reportSize: (() => void) | undefined;

	function fit(): void {
		if (!host.clientWidth || !host.clientHeight) return;
		fitAddon?.fit();
		reportSize?.();
	}

	/** Copies the current selection to the system clipboard. Returns whether text was selected. */
	export async function copySelection(): Promise<boolean> {
		const text = terminal?.getSelection() ?? '';
		if (!text) return false;
		await navigator.clipboard.writeText(text);
		return true;
	}

	/** Pastes clipboard text as terminal input, using bracketed paste when the program asks for it. */
	export async function paste(): Promise<void> {
		const text = await navigator.clipboard.readText();
		if (text) terminal?.paste(text);
	}

	export function focus(): void {
		terminal?.focus();
	}

	/**
	 * ⌘F on macOS. Elsewhere Ctrl+F belongs to the shell, so search follows
	 * the Ctrl+Shift convention of copy and paste.
	 */
	function isFindChord(event: KeyboardEvent): boolean {
		if (event.key.toLowerCase() !== 'f' || event.altKey) return false;
		return platform === 'mac'
			? event.metaKey && !event.ctrlKey && !event.shiftKey
			: event.ctrlKey && event.shiftKey && !event.metaKey;
	}

	/** Match colors come from the theme's terminal palette, in the `#RRGGBB` form the addon requires. */
	function searchOptions(): ISearchOptions {
		const { selection, cursor } = THEMES[theme].terminal;
		return {
			decorations: {
				matchBackground: selection,
				matchOverviewRuler: selection,
				activeMatchBackground: selection,
				activeMatchBorder: cursor,
				activeMatchColorOverviewRuler: cursor
			}
		};
	}

	/**
	 * Moves to the next or previous match across the scrollback. Typing
	 * searches incrementally, so the current match grows with the query.
	 */
	function find(direction: 'next' | 'previous', incremental = false): void {
		if (!searchAddon) return;
		if (!query) {
			searchAddon.clearDecorations();
			results = undefined;
			return;
		}
		if (direction === 'next') searchAddon.findNext(query, { ...searchOptions(), incremental });
		else searchAddon.findPrevious(query, searchOptions());
	}

	/**
	 * Opens the find bar, or focuses it when it is already open. The field
	 * keeps the previous query selected, so typing replaces it.
	 */
	export async function openSearch(): Promise<void> {
		const reopening = !searching;
		searching = true;
		await tick();
		searchInput?.focus();
		searchInput?.select();
		if (reopening && query) find('next', true);
	}

	/** Closes the find bar, clears the highlights, and returns focus to the terminal. */
	function closeSearch(): void {
		searching = false;
		results = undefined;
		searchAddon?.clearDecorations();
		terminal?.focus();
	}

	function handleSearchKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			closeSearch();
		} else if (event.key === 'Enter' && event.target === searchInput) {
			event.preventDefault();
			find(event.shiftKey ? 'previous' : 'next');
		} else if (isFindChord(event)) {
			event.preventDefault();
			void openSearch();
		}
	}

	onMount(() => {
		const instance = new Terminal({
			allowProposedApi: true,
			cursorBlink: true,
			fontFamily: SYSTEM_MONO,
			fontSize: 13,
			// Programs mark hyperlinks with OSC 8. The shared handler checks the
			// scheme, so mailto links can pass xterm's own http-only filter.
			linkHandler: { activate: (_event, uri) => links.open(uri), allowNonHttpProtocols: true },
			theme: terminalTheme(theme)
		});
		const fitter = new FitAddon();
		instance.loadAddon(fitter);
		instance.loadAddon(new Unicode11Addon());
		instance.unicode.activeVersion = '11';
		const search = new SearchAddon({ highlightLimit: MATCH_LIMIT });
		instance.loadAddon(search);
		// Plain-text URLs open through the same handler as OSC 8 links.
		instance.loadAddon(new WebLinksAddon((_event, uri) => links.open(uri)));
		const pathLinks = fileLinks && instance.registerLinkProvider(createTerminalPathLinks(instance, fileLinks));
		// The clipboard addon's bundle reads `self` when it loads, so importing it
		// at module scope breaks Node consumers of the package index.
		void import('@xterm/addon-clipboard').then(({ ClipboardAddon }) => {
			if (terminal === instance) instance.loadAddon(new ClipboardAddon());
		});
		// macOS copy and paste shortcuts reach xterm.js as native clipboard events.
		// Elsewhere Ctrl+C belongs to the shell, so use the Ctrl+Shift convention.
		instance.attachCustomKeyEventHandler((event) => {
			if (event.type !== 'keydown') return true;
			if (isDockChord(event)) {
				event.preventDefault();
				keymap?.run('panel.dock');
				return false;
			}
			if (isFindChord(event)) {
				event.preventDefault();
				void openSearch();
				return false;
			}
			if (!event.ctrlKey || !event.shiftKey) return true;
			const key = event.key.toLowerCase();
			if (key !== 'c' && key !== 'v') return true;
			event.preventDefault();
			void (key === 'c' ? copySelection() : paste());
			return false;
		});
		instance.open(host);
		fitAddon = fitter;
		searchAddon = search;
		terminal = instance;
		fit();
		// xterm measures its cell grid only when the font option changes, so it
		// switches to the bundled code font after that face has loaded.
		const codeFont = getComputedStyle(host).getPropertyValue('--pau-font-code').trim();
		if (codeFont && 'fonts' in document) {
			void document.fonts.load(`13px ${codeFont}`).then(() => {
				if (terminal !== instance) return;
				instance.options.fontFamily = codeFont;
				fit();
			});
		}

		const encoder = new TextEncoder();
		// xterm.js answers queries as it parses them, through the same events
		// as typed input. While a replay is parsing, those answers belong to a
		// program that asked long ago, so they are dropped. Input typed in that
		// short window is dropped with them.
		let replays = 0;
		const connection = connect({
			replay: (bytes) => {
				replays += 1;
				instance.write(bytes, () => (replays -= 1));
			},
			output: (bytes) => {
				instance.write(bytes);
				onoutput?.();
			},
			reset: () => instance.reset(),
			exit: (status) => {
				instance.options.disableStdin = true;
				instance.options.cursorBlink = false;
				onexit?.(status);
			},
			disconnect: () => ondisconnect?.()
		});
		// A hidden tab has no size to measure, so xterm holds its 80×24 default.
		// Sending that would shrink the program, and its redraw would read as
		// new output. The size goes out once the tab shows and has been fitted.
		let sized = false;
		reportSize = () => {
			if (sized) return;
			sized = true;
			connection.resize(instance.cols, instance.rows);
		};
		if (host.clientWidth && host.clientHeight) reportSize();
		const subscriptions = [
			instance.onData((data) => {
				if (replays === 0) connection.write(encoder.encode(data));
			}),
			// Binary events carry one byte per character, such as legacy mouse reports.
			instance.onBinary((data) => {
				if (replays === 0) {
					connection.write(Uint8Array.from(data, (character) => character.codePointAt(0) ?? 0));
				}
			}),
			instance.onResize(({ cols, rows }) => {
				sized = true;
				connection.resize(cols, rows);
			}),
			instance.onSelectionChange(() => onselectionchange?.(instance.hasSelection())),
			// The addon reports counts only for searches that draw decorations.
			search.onDidChangeResults((change) => (results = change))
		];
		const observer = new ResizeObserver(() => fit());
		observer.observe(host);

		return () => {
			observer.disconnect();
			for (const subscription of subscriptions) subscription.dispose();
			pathLinks?.dispose();
			reportSize = undefined;
			connection.close();
			instance.dispose();
			terminal = undefined;
			fitAddon = undefined;
			searchAddon = undefined;
		};
	});

	$effect(() => {
		if (terminal) terminal.options.theme = terminalTheme(theme);
	});

	$effect(() => {
		if (!terminal || !active) return;
		fit();
		terminal.focus();
	});
</script>

<div class="terminal-view">
	<div
		class="terminal-view__screen"
		role="group"
		aria-label={label}
		data-theme={theme}
		style:background={THEMES[theme].terminal.background}
		bind:this={host}>
	</div>
	{#if searching}
		<!-- Escape is handled on the bar so it closes from the buttons too. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div class="terminal-view__search" role="search" aria-label="Find in terminal" onkeydown={handleSearchKeydown}>
			<div class="terminal-view__field">
				<Icon name="search" size={16} />
				<input
					bind:this={searchInput}
					bind:value={query}
					oninput={() => find('next', true)}
					type="text"
					placeholder="Find in terminal"
					aria-label="Find in terminal"
					autocomplete="off"
					spellcheck="false" />
				<span class={['terminal-view__count', { empty: results?.resultCount === 0 }]} role="status">
					{matchCount}
				</span>
			</div>
			<button
				type="button"
				class="pau-button pau-button--quiet"
				aria-label="Previous match"
				disabled={!results?.resultCount}
				onclick={() => find('previous')}>
				<Icon name="arrowUp" size={16} />
			</button>
			<button
				type="button"
				class="pau-button pau-button--quiet"
				aria-label="Next match"
				disabled={!results?.resultCount}
				onclick={() => find('next')}>
				<Icon name="arrowDown" size={16} />
			</button>
			<button type="button" class="pau-button pau-button--quiet" aria-label="Close find" onclick={closeSearch}>
				<Icon name="close" size={16} />
			</button>
		</div>
	{/if}
</div>

<style>
	.terminal-view {
		position: relative;
		min-width: 0;
		min-height: 0;
	}

	.terminal-view__screen {
		width: 100%;
		height: 100%;
		overflow: hidden;
	}

	/* Fit subtracts the terminal element's padding, not the container's. */
	.terminal-view__screen :global(.xterm) {
		height: 100%;
		padding: var(--pau-space-2);
	}

	/*
	 * xterm.css paints the viewport black, and the viewport spans the padding
	 * above. Leave it clear so the screen's theme background fills the frame.
	 */
	.terminal-view__screen :global(.xterm-viewport) {
		background-color: transparent;
	}

	/*
	 * The bar floats over the top of the output instead of taking a row, so
	 * opening it never resizes the PTY or reflows the lines being searched.
	 * It is not a dismissible overlay: selecting output or switching windows
	 * keeps the query and highlights until Escape or Close.
	 */
	.terminal-view__search {
		position: absolute;
		top: var(--pau-space-2);
		right: var(--pau-space-4);
		display: flex;
		align-items: center;
		gap: var(--pau-space-1);
		max-width: calc(100% - 2 * var(--pau-space-4));
		padding: var(--pau-space-1);
		background: var(--pau-surface-raised);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-surface);
		box-shadow: 0 0.5rem 1.5rem rgb(0 0 0 / 28%);
	}

	.terminal-view__field {
		display: flex;
		flex: 0 1 auto;
		align-items: center;
		/* A fixed width keeps the buttons still while the count changes. */
		width: 20rem;
		gap: var(--pau-space-2);
		min-width: 0;
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-2);
		color: var(--pau-text-muted);
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
	}

	.terminal-view__field:focus-within {
		border-color: var(--pau-focus);
		box-shadow: 0 0 0 1px var(--pau-focus);
	}

	.terminal-view__field input {
		flex: 1;
		min-width: 0;
		color: var(--pau-text);
		background: transparent;
		border: 0;
		outline: 0;
		font: inherit;
		font-size: var(--pau-type-md);
	}

	.terminal-view__field input::placeholder {
		color: var(--pau-text-muted);
	}

	.terminal-view__count {
		flex: none;
		font-size: var(--pau-type-xs);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.terminal-view__count.empty {
		color: var(--pau-danger);
	}

	@media (pointer: coarse) {
		.terminal-view__field {
			min-height: var(--pau-size-target-touch);
		}
	}
</style>
