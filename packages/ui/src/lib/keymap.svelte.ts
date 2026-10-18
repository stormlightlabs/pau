import { getContext, untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

/**
 * The key notation follows Pi's `keybindings.json`: lowercase modifiers and a
 * key joined with `+`, such as `ctrl+shift+p`. Pau adds `mod`, which means ⌘
 * on macOS and Ctrl elsewhere, and `plus` for the `+` key.
 */
export type KeyChord = string;

/** Platforms whose modifier conventions differ. */
export type KeyPlatform = 'mac' | 'other';

/**
 * One application action that the operator can run from the keyboard.
 *
 * Actions are also command palette entries, so `label` reads as a command.
 */
export type KeyAction = {
	/** Stable identity that handlers and menu items refer to. */
	id: string;
	label: string;
	/** Heading that groups the action in the shortcut list. */
	group: string;
	/** Default chords in Pi notation. `mod` resolves per platform. */
	keys: readonly KeyChord[];
	/**
	 * Whether the action runs while a text field such as the composer has
	 * focus. Leave it unset for chords that text editing could use.
	 */
	whileTyping?: boolean;
	/** Shows the chords as a range, such as ⌘1 to ⌘9, in the shortcut list. */
	range?: boolean;
	/**
	 * Why the command palette shows the action disabled when no mounted view
	 * can run it. The palette falls back to a generic reason.
	 */
	unavailable?: string;
	/**
	 * Leaves the action out of the command palette, for chords that act on the
	 * focused item or that the palette itself handles.
	 */
	palette?: false;
};

/** A Pi binding, as Pau's `/api/pi/keybindings` route reports it. */
export type PiKeyBinding = { action: string; keys: readonly string[] };

/** A default chord that Pau gave up because one of the operator's Pi bindings uses it. */
export type KeyConflict = { keys: KeyChord; piAction: string };

/**
 * An action with its chords resolved for one platform. `keys` holds only the
 * chords Pau listens for, and `yielded` holds the ones Pi kept.
 */
export type ResolvedKeyAction = Omit<KeyAction, 'keys'> & { keys: KeyChord[]; yielded: KeyConflict[] };

/**
 * Runs an action. `index` is the position of the matched chord in the
 * action's keys, which a range action such as "Go to session" uses as its
 * argument. Menu items and palette commands run with index 0.
 */
export type KeyHandler = (index: number) => void;

/** Group headings in the order the shortcut list shows them. */
export const KEY_GROUPS = ['General', 'Sessions', 'Navigation', 'Panels', 'View'] as const;

/** Reason shown for actions that only the Sessions view can run. */
const SESSIONS_ONLY = 'Available in Sessions';
/** Reason shown for actions that need the desktop app's native window. */
const DESKTOP_ONLY = 'Available in the desktop app';

/**
 * Pau's global key map. The composer and other views add their own actions
 * with {@link Keymap.define}.
 */
export const APP_KEY_ACTIONS: readonly KeyAction[] = [
	{
		id: 'palette.open',
		label: 'Open the command palette',
		group: 'General',
		keys: ['mod+k', 'mod+shift+p', 'f1'],
		whileTyping: true,
		palette: false
	},
	{ id: 'app.shortcuts', label: 'Show keyboard shortcuts', group: 'General', keys: ['mod+/'], whileTyping: true },
	{
		id: 'workspace.open',
		label: 'Open workspace',
		group: 'General',
		keys: ['mod+o'],
		whileTyping: true,
		unavailable: SESSIONS_ONLY
	},
	// The focused row or message opens its own menu, because the menu depends
	// on that item. The entry lists the chords and registers no handler.
	{
		id: 'item.contextMenu',
		label: 'Open the context menu',
		group: 'General',
		keys: ['shift+f10', 'contextmenu'],
		palette: false
	},
	{
		id: 'session.new',
		label: 'New session',
		group: 'Sessions',
		keys: ['mod+n'],
		whileTyping: true,
		unavailable: SESSIONS_ONLY
	},
	{
		id: 'session.next',
		label: 'Next session',
		group: 'Sessions',
		keys: ['ctrl+tab'],
		whileTyping: true,
		unavailable: SESSIONS_ONLY
	},
	{
		id: 'session.previous',
		label: 'Previous session',
		group: 'Sessions',
		keys: ['ctrl+shift+tab'],
		whileTyping: true,
		unavailable: SESSIONS_ONLY
	},
	{
		id: 'session.goto',
		label: 'Go to session 1 to 9',
		group: 'Sessions',
		keys: Array.from({ length: 9 }, (_, index) => `mod+${index + 1}`),
		whileTyping: true,
		range: true
	},
	{
		id: 'session.clearAttention',
		label: 'Clear attention markers',
		group: 'Sessions',
		keys: ['shift+escape'],
		whileTyping: true,
		unavailable: SESSIONS_ONLY
	},
	{
		id: 'composer.focus',
		label: 'Focus the composer',
		group: 'Navigation',
		keys: ['mod+l'],
		unavailable: SESSIONS_ONLY
	},
	{
		id: 'prompt.previous',
		label: 'Previous prompt',
		group: 'Navigation',
		keys: ['ctrl+shift+up'],
		whileTyping: true,
		unavailable: SESSIONS_ONLY
	},
	{
		id: 'prompt.next',
		label: 'Next prompt',
		group: 'Navigation',
		keys: ['ctrl+shift+down'],
		whileTyping: true,
		unavailable: SESSIONS_ONLY
	},
	{ id: 'navigate.back', label: 'Go back', group: 'Navigation', keys: ['mod+['] },
	{ id: 'navigate.forward', label: 'Go forward', group: 'Navigation', keys: ['mod+]'] },
	{ id: 'panel.context', label: 'Toggle the session rail', group: 'Panels', keys: ['mod+b'], whileTyping: true },
	{ id: 'panel.inspector', label: 'Toggle the inspector', group: 'Panels', keys: ['mod+alt+b'], whileTyping: true },
	{
		id: 'view.zoomIn',
		label: 'Zoom in',
		group: 'View',
		keys: ['mod+=', 'mod+plus'],
		whileTyping: true,
		unavailable: DESKTOP_ONLY
	},
	{
		id: 'view.zoomOut',
		label: 'Zoom out',
		group: 'View',
		keys: ['mod+-'],
		whileTyping: true,
		unavailable: DESKTOP_ONLY
	},
	{
		id: 'view.zoomReset',
		label: 'Actual size',
		group: 'View',
		keys: ['mod+0'],
		whileTyping: true,
		unavailable: DESKTOP_ONLY
	}
];

type Modifier = 'ctrl' | 'alt' | 'shift' | 'meta';

const MODIFIERS: Partial<Record<string, Modifier>> = {
	ctrl: 'ctrl',
	control: 'ctrl',
	alt: 'alt',
	option: 'alt',
	opt: 'alt',
	shift: 'shift',
	meta: 'meta',
	cmd: 'meta',
	command: 'meta',
	super: 'meta'
};
const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'meta'] as const;
const KEY_ALIASES: Record<string, string> = {
	esc: 'escape',
	return: 'enter',
	arrowup: 'up',
	arrowdown: 'down',
	arrowleft: 'left',
	arrowright: 'right',
	' ': 'space',
	spacebar: 'space',
	'+': 'plus',
	del: 'delete'
};

/**
 * Rewrites a chord in canonical form: lowercase, aliases resolved, and
 * modifiers in the order ctrl, alt, shift, meta. Pi writes both
 * `shift+ctrl+p` and `ctrl+shift+p`, so comparisons need this form.
 */
export function normalizeChord(chord: KeyChord, platform: KeyPlatform): KeyChord {
	const lower = chord.trim().toLowerCase();
	// A trailing `++` names the plus key, as in `ctrl++`.
	const parts = lower.endsWith('++') ? [...lower.slice(0, -2).split('+'), 'plus'] : lower.split('+');
	const modifiers: Modifier[] = [];
	let key = '';
	for (const part of parts) {
		const modifier = part === 'mod' ? (platform === 'mac' ? 'meta' : 'ctrl') : MODIFIERS[part];
		if (modifier) modifiers.push(modifier);
		else key = KEY_ALIASES[part] ?? part;
	}
	return [...MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier)), key].join('+');
}

/**
 * Reads the chord that a key press produced, or `undefined` for a lone
 * modifier.
 *
 * Letters and digits come from the physical key, because Option on macOS
 * changes `event.key` (⌥B types ∫). Shift is dropped for other printable
 * characters, since the character already reflects it: Shift+= arrives as
 * `plus`.
 */
export function eventChord(event: KeyboardEvent): KeyChord | undefined {
	if (['Control', 'Shift', 'Alt', 'Meta', 'Dead', 'Unidentified', ''].includes(event.key)) return undefined;
	const physical = /^(?:Key([A-Z])|Digit(\d))$/.exec(event.code);
	let key = physical ? (physical[1] ?? physical[2] ?? '').toLowerCase() : event.key.toLowerCase();
	key = KEY_ALIASES[key] ?? key;
	const printable = key.length === 1 || key === 'plus';
	const symbol = printable && !/^[a-z0-9]$/.test(key);
	const modifiers = [
		event.ctrlKey && 'ctrl',
		event.altKey && 'alt',
		event.shiftKey && !symbol && 'shift',
		event.metaKey && 'meta'
	].filter(Boolean);
	return [...modifiers, key].join('+');
}

const MAC_SYMBOLS: Record<string, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' };
const OTHER_NAMES: Record<string, string> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Super' };
const KEY_NAMES: Record<string, string> = {
	plus: '+',
	escape: 'Esc',
	enter: 'Enter',
	tab: 'Tab',
	space: 'Space',
	backspace: 'Backspace',
	delete: 'Delete',
	up: '↑',
	down: '↓',
	left: '←',
	right: '→',
	pageup: 'Page Up',
	pagedown: 'Page Down',
	home: 'Home',
	end: 'End',
	contextmenu: 'Menu'
};

/** Formats a chord the way the platform's menus print it: `⌘⇧N` or `Ctrl+Shift+N`. */
export function formatChord(chord: KeyChord, platform: KeyPlatform): string {
	const parts = normalizeChord(chord, platform).split('+');
	const key = parts.pop() ?? '';
	const keyName = KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1));
	if (platform === 'mac') return parts.map((modifier) => MAC_SYMBOLS[modifier]).join('') + keyName;
	return [...parts.map((modifier) => OTHER_NAMES[modifier]), keyName].join('+');
}

/** Reads the platform from the browser, treating every non-Apple system like Linux. */
export function detectPlatform(navigatorLike: { platform?: string; userAgent?: string } = navigator): KeyPlatform {
	return /mac|iphone|ipad/i.test(navigatorLike.platform || navigatorLike.userAgent || '') ? 'mac' : 'other';
}

/**
 * Resolves each action's chords for a platform and removes every chord that a
 * Pi binding uses. The operator's Pi bindings win so that Pi's editing keys,
 * such as Ctrl+K on Linux, keep working in the composer and terminal.
 */
export function resolveKeyActions(
	actions: readonly KeyAction[],
	platform: KeyPlatform,
	piBindings: readonly PiKeyBinding[]
): ResolvedKeyAction[] {
	const piOwners: Partial<Record<KeyChord, string>> = {};
	for (const binding of piBindings) {
		for (const keys of binding.keys) piOwners[normalizeChord(keys, platform)] ??= binding.action;
	}
	return actions.map((action) => {
		const keys: KeyChord[] = [];
		const yielded: KeyConflict[] = [];
		for (const defaultKeys of action.keys) {
			const chord = normalizeChord(defaultKeys, platform);
			const piAction = Object.hasOwn(piOwners, chord) ? piOwners[chord] : undefined;
			if (piAction === undefined) keys.push(chord);
			else yielded.push({ keys: chord, piAction });
		}
		return { ...action, keys, yielded };
	});
}

/**
 * Elements where Pau never handles keys: code editors, the terminal, and
 * dialogs. A dialog owns its keys, and the terminal sends every key to the
 * program running in it. Add `data-keymap="off"` to opt out another element.
 */
const KEYMAP_OFF = [
	'[contenteditable]:not([contenteditable="false"])',
	'.xterm',
	'dialog',
	'[role="dialog"]',
	'[role="alertdialog"]',
	'[data-keymap="off"]'
].join(', ');

function isTextField(element: Element): boolean {
	return (
		element instanceof HTMLInputElement ||
		element instanceof HTMLTextAreaElement ||
		element instanceof HTMLSelectElement
	);
}

/**
 * Pau's key map: action definitions, the handlers mounted views provide, and
 * the operator's Pi bindings that take precedence over default chords.
 *
 * Views register handlers while they are mounted, so an action only runs when
 * something on screen can perform it. The latest registration of an action
 * wins, and unregistering restores the previous one.
 */
export class Keymap {
	#definitions = $state.raw<KeyAction[]>([]);
	#piBindings = $state.raw<PiKeyBinding[]>([]);
	/** Handler stacks by action ID. Reactive, so `canRun` can drive disabled states. */
	#handlers = new SvelteMap<string, readonly KeyHandler[]>();
	#pending: string | undefined;
	#platform: KeyPlatform = 'other';

	/** Every defined action with the chords Pau listens for on this platform. */
	readonly actions: ResolvedKeyAction[] = $derived(
		resolveKeyActions(this.#definitions, this.#platform, this.#piBindings)
	);

	constructor({
		actions = APP_KEY_ACTIONS,
		platform = detectPlatform()
	}: { actions?: readonly KeyAction[]; platform?: KeyPlatform } = {}) {
		this.#platform = platform;
		this.#definitions = [...actions];
	}

	/** The platform whose modifier conventions the chords follow. */
	get platform(): KeyPlatform {
		return this.#platform;
	}

	/** The operator's Pi bindings over Pi's defaults, or none before they load. */
	get piBindings(): readonly PiKeyBinding[] {
		return this.#piBindings;
	}

	/** Replaces the operator's Pi bindings, which win over Pau's default chords. */
	setPiBindings(bindings: readonly PiKeyBinding[]): void {
		this.#piBindings = [...bindings];
	}

	/**
	 * Adds an action to the map, or replaces the definition with the same ID.
	 * Returns a function that removes it again.
	 */
	define(action: KeyAction): () => void {
		this.#definitions = [...this.#definitions.filter((existing) => existing.id !== action.id), action];
		return () => {
			this.#definitions = this.#definitions.filter((existing) => existing !== action);
		};
	}

	/**
	 * Makes an action runnable until the returned function is called. If a
	 * menu item asked for the action before any view could run it, it runs now.
	 */
	register(id: string, handler: KeyHandler): () => void {
		// Views register from effects. Reading the reactive map there would make
		// the effect depend on the map it writes and rerun forever.
		untrack(() => this.#handlers.set(id, [...(this.#handlers.get(id) ?? []), handler]));
		if (this.#pending === id) {
			this.#pending = undefined;
			handler(0);
		}
		return () =>
			untrack(() => {
				const current = this.#handlers.get(id) ?? [];
				const index = current.lastIndexOf(handler);
				if (index !== -1) this.#handlers.set(id, current.toSpliced(index, 1));
			});
	}

	/** Whether a mounted view can run the action. */
	canRun(id: string): boolean {
		return (this.#handlers.get(id)?.length ?? 0) > 0;
	}

	/**
	 * Runs an action from a menu item or palette command, ignoring focus. With
	 * `whenReady`, an action that no view can run yet waits for its handler,
	 * which lets the app navigate to a view that provides it.
	 *
	 * @returns Whether the action ran.
	 */
	run(id: string, { whenReady = false, index = 0 }: { whenReady?: boolean; index?: number } = {}): boolean {
		const handler = this.#handlers.get(id)?.at(-1);
		if (handler) {
			handler(index);
			return true;
		}
		if (whenReady) this.#pending = id;
		return false;
	}

	/** The first chord of an action, formatted for display, such as in the palette. */
	shortcut(id: string): string | undefined {
		const chord = this.actions.find((action) => action.id === id)?.keys[0];
		return chord === undefined ? undefined : formatChord(chord, this.platform);
	}

	/**
	 * Runs the action bound to a key press and prevents the browser default.
	 *
	 * Nothing runs inside a code editor, the terminal, or a dialog. In a text
	 * field, only actions marked `whileTyping` run.
	 *
	 * @returns The ID of the action that ran.
	 */
	handleKeydown(event: KeyboardEvent): string | undefined {
		if (event.defaultPrevented || event.isComposing) return undefined;
		const chord = eventChord(event);
		if (chord === undefined) return undefined;
		const target = event.target instanceof Element ? event.target : undefined;
		if (target?.closest(KEYMAP_OFF)) return undefined;
		const typing = target !== undefined && isTextField(target);
		for (const action of this.actions) {
			const index = action.keys.indexOf(chord);
			if (index === -1 || (typing && !action.whileTyping) || !this.canRun(action.id)) continue;
			event.preventDefault();
			this.run(action.id, { index });
			return action.id;
		}
		return undefined;
	}
}

/** Context key under which the app owner provides its {@link Keymap}. */
export const keymapContext = Symbol('pau.keymap');

/** Reads the key map that an ancestor provided, if any. */
export function getKeymap(): Keymap | undefined {
	return getContext<Keymap | undefined>(keymapContext);
}

/**
 * Registers handlers with the surrounding key map for as long as the calling
 * component is mounted. Call it during component initialization. Without a
 * key map, as in Storybook stories that do not provide one, it does nothing.
 */
export function useKeyActions(handlers: Record<string, KeyHandler>): void {
	const keymap = getKeymap();
	if (!keymap) return;
	$effect(() => {
		const unregister = Object.entries(handlers).map(([id, handler]) => keymap.register(id, handler));
		return () => {
			for (const remove of unregister) remove();
		};
	});
}
