<script lang="ts" module>
	/**
	 * Menu actions that only the session view can run. Choosing one elsewhere
	 * opens the session view, which runs it once it registers the action.
	 */
	const SESSION_VIEW_ACTIONS = new Set(['session.new', 'workspace.open']);

	/**
	 * How long after a key press a menu event for the same action counts as a
	 * duplicate. On macOS a menu accelerator and the page can both see one
	 * press, and the page has already run the action.
	 */
	const DUPLICATE_MENU_EVENT_MS = 150;
</script>

<script lang="ts">
	import { KeyboardShortcuts, Keymap, keymapContext, type KeyPlatform } from '@stormlightlabs/pau-ui';
	import { onMount, setContext, type Snippet } from 'svelte';

	import { getPiKeybindings } from './api';
	import type { DesktopNativeCapabilities } from './native-capabilities';
	import { stepZoom } from './zoom';

	let {
		native = {},
		fetcher,
		platform,
		onOpenSessionView = () => {},
		onOpenSettings = () => {},
		children
	}: {
		native?: DesktopNativeCapabilities;
		fetcher?: typeof fetch;
		/** Overrides the detected platform, for tests. */
		platform?: KeyPlatform;
		/** Navigates to the session view so a menu action it owns can run. */
		onOpenSessionView?: () => void;
		/** Navigates to Settings, from ⌘, or the app menu. */
		onOpenSettings?: () => void;
		children?: Snippet;
	} = $props();

	// The app owner mounts once, so the platform is fixed for its lifetime.
	// svelte-ignore state_referenced_locally
	const keymap = setContext(keymapContext, new Keymap({ platform }));
	let shortcutsOpen = $state(false);
	let zoom = 1;
	let lastKey: { id: string; at: number } | undefined;

	function setZoom(factor: number): void {
		zoom = factor;
		void native.setZoom?.(factor);
	}

	function runMenuAction(id: string): void {
		if (lastKey && lastKey.id === id && performance.now() - lastKey.at < DUPLICATE_MENU_EVENT_MS) return;
		const sessionView = SESSION_VIEW_ACTIONS.has(id);
		if (sessionView && !keymap.run(id, { whenReady: true })) onOpenSessionView();
		else if (!sessionView) keymap.run(id);
	}

	function handleKeydown(event: KeyboardEvent): void {
		const id = keymap.handleKeydown(event);
		if (id !== undefined) lastKey = { id, at: performance.now() };
	}

	/** Applies Pi's bindings. Without them, the default chords stay in place. */
	async function loadPiBindings(): Promise<void> {
		try {
			const { bindings } = await getPiKeybindings(fetcher);
			keymap.setPiBindings(bindings);
		} catch {
			// The shortcut list still shows every default chord.
		}
	}

	onMount(() => {
		void loadPiBindings();

		const unregister = [
			keymap.register('app.shortcuts', () => (shortcutsOpen = !shortcutsOpen)),
			keymap.register('app.settings', () => onOpenSettings()),
			keymap.register('navigate.back', () => history.back()),
			keymap.register('navigate.forward', () => history.forward())
		];
		// The development browser keeps its own page zoom.
		if (native.setZoom) {
			unregister.push(
				keymap.register('view.zoomIn', () => setZoom(stepZoom(zoom, 1))),
				keymap.register('view.zoomOut', () => setZoom(stepZoom(zoom, -1))),
				keymap.register('view.zoomReset', () => setZoom(1))
			);
		}
		const stopMenu = native.onMenuAction?.(runMenuAction);
		return () => {
			for (const remove of unregister) remove();
			stopMenu?.();
		};
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{@render children?.()}

<KeyboardShortcuts bind:open={shortcutsOpen} actions={keymap.actions} platform={keymap.platform} />
