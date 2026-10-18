import { eventChord, normalizeChord, type KeyChord, type KeyPlatform, type PiKeyBinding } from './keymap.svelte';

/** What a key press in the composer asks for. */
export type ComposerKeyAction =
	'submit' | 'newLine' | 'followUp' | 'dequeue' | 'cycleThinking' | 'selectModel' | 'interrupt';

/** A composer action, the Pi action that names its keys, and Pi's default keys. */
export type ComposerKeyDefinition = { action: ComposerKeyAction; piAction: string; keys: readonly KeyChord[] };

/**
 * The Pi actions the composer follows, with Pi's macOS and Linux defaults.
 * When the operator binds one chord to two of these actions, the earlier
 * action wins.
 */
export const COMPOSER_KEY_DEFINITIONS: readonly ComposerKeyDefinition[] = [
	{ action: 'interrupt', piAction: 'app.interrupt', keys: ['escape'] },
	{ action: 'followUp', piAction: 'app.message.followUp', keys: ['alt+enter'] },
	{ action: 'dequeue', piAction: 'app.message.dequeue', keys: ['alt+up'] },
	{ action: 'submit', piAction: 'tui.input.submit', keys: ['enter'] },
	{ action: 'newLine', piAction: 'tui.input.newLine', keys: ['shift+enter', 'ctrl+j'] },
	{ action: 'cycleThinking', piAction: 'app.thinking.cycle', keys: ['shift+tab'] },
	{ action: 'selectModel', piAction: 'app.model.select', keys: ['ctrl+l'] }
];

/**
 * Pau sends with Cmd+Enter or Ctrl+Enter as well, unless a Pi binding above
 * already claims the chord.
 */
const PAU_SUBMIT_KEYS: readonly KeyChord[] = ['meta+enter', 'ctrl+enter'];

/** Composer chords in canonical form, each with its action and in Pi's priority order per action. */
export type ComposerKeys = {
	byChord: ReadonlyMap<KeyChord, ComposerKeyAction>;
	byAction: Readonly<Record<ComposerKeyAction, readonly KeyChord[]>>;
};

/**
 * Resolves the composer's chords from Pi's bindings. A binding the operator
 * set in `keybindings.json` replaces Pi's default for that action, and an
 * empty list unbinds it. Actions missing from `piBindings`, as before the
 * bindings load, keep Pi's defaults.
 */
export function resolveComposerKeys(piBindings: readonly PiKeyBinding[], platform: KeyPlatform): ComposerKeys {
	const byChord = new Map<KeyChord, ComposerKeyAction>();
	const byAction = {} as Record<ComposerKeyAction, KeyChord[]>;
	for (const definition of COMPOSER_KEY_DEFINITIONS) {
		const keys = piBindings.find((binding) => binding.action === definition.piAction)?.keys ?? definition.keys;
		byAction[definition.action] = [];
		for (const key of keys) {
			const chord = normalizeChord(key, platform);
			if (byChord.has(chord)) continue;
			byChord.set(chord, definition.action);
			byAction[definition.action].push(chord);
		}
	}
	for (const chord of PAU_SUBMIT_KEYS) {
		if (byChord.has(chord)) continue;
		byChord.set(chord, 'submit');
		byAction.submit.push(chord);
	}
	return { byChord, byAction };
}

/** Reads the composer action a key press asks for. Presses during IME composition never match. */
export function composerKeyAction(keys: ComposerKeys, event: KeyboardEvent): ComposerKeyAction | undefined {
	if (event.isComposing) return undefined;
	const chord = eventChord(event);
	return chord === undefined ? undefined : keys.byChord.get(chord);
}
