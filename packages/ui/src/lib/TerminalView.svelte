<script lang="ts">
	import '../styles/tokens.css';
	import '@xterm/xterm/css/xterm.css';
	import { FitAddon } from '@xterm/addon-fit';
	import { Unicode11Addon } from '@xterm/addon-unicode11';
	import { Terminal } from '@xterm/xterm';
	import { onMount } from 'svelte';

	import { terminalTheme, THEMES, type ThemeName } from '../theme';
	import { useExternalLinks } from './external-links';
	import type { TerminalConnection, TerminalConnectionEvents, TerminalExit } from './types/terminal';

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
	};

	let { label, theme = 'eldritch', active = true, connect, onexit, ondisconnect, onselectionchange }: Props = $props();

	/** Installed monospace faces that xterm can measure before the bundled code font loads. */
	const SYSTEM_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

	const links = useExternalLinks();

	let host: HTMLDivElement;
	let terminal = $state.raw<Terminal>();
	let fitAddon: FitAddon | undefined;

	/** Fits the grid to the container. A hidden container has no size to measure. */
	function fit(): void {
		if (!host.clientWidth || !host.clientHeight) return;
		fitAddon?.fit();
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
		// The clipboard addon's bundle reads `self` when it loads, so importing it
		// at module scope breaks Node consumers of the package index.
		void import('@xterm/addon-clipboard').then(({ ClipboardAddon }) => {
			if (terminal === instance) instance.loadAddon(new ClipboardAddon());
		});
		// macOS copy and paste shortcuts reach xterm.js as native clipboard events.
		// Elsewhere Ctrl+C belongs to the shell, so use the Ctrl+Shift convention.
		instance.attachCustomKeyEventHandler((event) => {
			if (event.type !== 'keydown' || !event.ctrlKey || !event.shiftKey) return true;
			const key = event.key.toLowerCase();
			if (key !== 'c' && key !== 'v') return true;
			event.preventDefault();
			void (key === 'c' ? copySelection() : paste());
			return false;
		});
		instance.open(host);
		fitAddon = fitter;
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
		const connection = connect({
			output: (bytes) => instance.write(bytes),
			exit: (status) => {
				instance.options.disableStdin = true;
				instance.options.cursorBlink = false;
				onexit?.(status);
			},
			disconnect: () => ondisconnect?.()
		});
		connection.resize(instance.cols, instance.rows);
		const subscriptions = [
			instance.onData((data) => connection.write(encoder.encode(data))),
			// Binary events carry one byte per character, such as legacy mouse reports.
			instance.onBinary((data) =>
				connection.write(Uint8Array.from(data, (character) => character.codePointAt(0) ?? 0))
			),
			instance.onResize(({ cols, rows }) => connection.resize(cols, rows)),
			instance.onSelectionChange(() => onselectionchange?.(instance.hasSelection()))
		];
		const observer = new ResizeObserver(() => fit());
		observer.observe(host);

		return () => {
			observer.disconnect();
			for (const subscription of subscriptions) subscription.dispose();
			connection.close();
			instance.dispose();
			terminal = undefined;
			fitAddon = undefined;
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

<div
	class="terminal-view"
	role="group"
	aria-label={label}
	data-theme={theme}
	style:background={THEMES[theme].terminal.background}
	bind:this={host}>
</div>

<style>
	.terminal-view {
		width: 100%;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}

	/* Fit subtracts the terminal element's padding, not the container's. */
	.terminal-view :global(.xterm) {
		height: 100%;
		padding: var(--pau-space-2);
	}
</style>
