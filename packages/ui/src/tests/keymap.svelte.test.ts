import { describe, expect, test, vi } from 'vitest';

import {
	APP_KEY_ACTIONS,
	Keymap,
	detectPlatform,
	eventChord,
	formatChord,
	normalizeChord,
	resolveKeyActions
} from '../lib/keymap.svelte';

describe('chords', () => {
	test('normalizes Pi notation and resolves mod per platform', () => {
		expect(normalizeChord('shift+ctrl+P', 'other')).toBe('ctrl+shift+p');
		expect(normalizeChord('mod+alt+b', 'mac')).toBe('alt+meta+b');
		expect(normalizeChord('mod+alt+b', 'other')).toBe('ctrl+alt+b');
		expect(normalizeChord('ctrl++', 'other')).toBe('ctrl+plus');
		expect(normalizeChord('cmd+Esc', 'mac')).toBe('meta+escape');
		expect(normalizeChord('pageUp', 'other')).toBe('pageup');
	});

	test('reads chords from key presses', () => {
		expect(eventChord(new KeyboardEvent('keydown', { key: '∫', code: 'KeyB', metaKey: true, altKey: true }))).toBe(
			'alt+meta+b'
		);
		expect(eventChord(new KeyboardEvent('keydown', { key: '+', code: 'Equal', metaKey: true, shiftKey: true }))).toBe(
			'meta+plus'
		);
		expect(eventChord(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, shiftKey: true }))).toBe(
			'ctrl+shift+tab'
		);
		expect(eventChord(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }))).toBeUndefined();
		expect(eventChord(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true }))).toBe('shift+f10');
		expect(eventChord(new KeyboardEvent('keydown', { key: 'ContextMenu' }))).toBe('contextmenu');
	});

	test('formats chords the way each platform prints them', () => {
		expect(formatChord('mod+shift+n', 'mac')).toBe('⇧⌘N');
		expect(formatChord('mod+shift+n', 'other')).toBe('Ctrl+Shift+N');
		expect(formatChord('ctrl+tab', 'mac')).toBe('⌃Tab');
		expect(formatChord('mod+plus', 'other')).toBe('Ctrl++');
		expect(formatChord('shift+f10', 'other')).toBe('Shift+F10');
		expect(formatChord('contextmenu', 'other')).toBe('Menu');
	});

	test('detects macOS from the navigator', () => {
		expect(detectPlatform({ platform: 'MacIntel' })).toBe('mac');
		expect(detectPlatform({ platform: 'Linux x86_64' })).toBe('other');
	});
});

describe('Pi bindings', () => {
	test('take a chord away from the app action that uses it', () => {
		const resolved = resolveKeyActions(APP_KEY_ACTIONS, 'other', [
			{ action: 'app.session.toggleNamedFilter', keys: ['ctrl+n'] },
			{ action: 'app.model.cycleBackward', keys: ['shift+ctrl+tab'] }
		]);
		const newSession = resolved.find((action) => action.id === 'session.new');
		const previous = resolved.find((action) => action.id === 'session.previous');

		expect(newSession).toMatchObject({
			keys: [],
			yielded: [{ keys: 'ctrl+n', piAction: 'app.session.toggleNamedFilter' }]
		});
		expect(previous?.keys).toEqual([]);
	});

	test('never collide with Command chords on macOS', () => {
		const resolved = resolveKeyActions(APP_KEY_ACTIONS, 'mac', [
			{ action: 'tui.editor.deleteToLineEnd', keys: ['ctrl+k'] }
		]);

		expect(resolved.every((action) => action.yielded.length === 0)).toBe(true);
	});
});

describe('Keymap', () => {
	test('runs the registered handler and prevents the browser default', () => {
		const keymap = new Keymap({ platform: 'mac' });
		const handler = vi.fn();
		const unregister = keymap.register('session.new', handler);

		const event = new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', metaKey: true, cancelable: true });

		expect(keymap.handleKeydown(event)).toBe('session.new');
		expect(handler).toHaveBeenCalledWith(0);
		expect(event.defaultPrevented).toBe(true);

		unregister();
		expect(keymap.canRun('session.new')).toBe(false);
	});

	test('passes the matched chord position to range actions', () => {
		const keymap = new Keymap({ platform: 'other' });
		const handler = vi.fn();
		keymap.register('session.goto', handler);

		keymap.handleKeydown(new KeyboardEvent('keydown', { key: '3', code: 'Digit3', ctrlKey: true }));

		expect(handler).toHaveBeenCalledWith(2);
	});

	test('yields a chord to a Pi binding', () => {
		const keymap = new Keymap({ platform: 'other' });
		const handler = vi.fn();
		keymap.register('session.new', handler);
		keymap.setPiBindings([{ action: 'app.session.toggleNamedFilter', keys: ['ctrl+n'] }]);

		const ran = keymap.handleKeydown(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true }));

		expect(ran).toBeUndefined();
		expect(handler).not.toHaveBeenCalled();
		expect(keymap.shortcut('session.new')).toBeUndefined();
		expect(keymap.run('session.new')).toBe(true);
	});

	test('runs a menu action once a view registers it', () => {
		const keymap = new Keymap({ platform: 'mac' });
		const handler = vi.fn();

		expect(keymap.run('workspace.open', { whenReady: true })).toBe(false);
		keymap.register('workspace.open', handler);

		expect(handler).toHaveBeenCalledOnce();
	});

	test('lets later views add actions and restores the previous handler', () => {
		const keymap = new Keymap({ platform: 'mac' });
		const remove = keymap.define({
			id: 'palette.open',
			label: 'Open the command palette',
			group: 'General',
			keys: ['mod+k']
		});
		const outer = vi.fn();
		const inner = vi.fn();
		keymap.register('palette.open', outer);
		const unregisterInner = keymap.register('palette.open', inner);

		expect(keymap.shortcut('palette.open')).toBe('⌘K');
		keymap.run('palette.open');
		unregisterInner();
		keymap.run('palette.open');
		expect(inner).toHaveBeenCalledOnce();
		expect(outer).toHaveBeenCalledOnce();

		remove();
		expect(keymap.shortcut('palette.open')).toBeUndefined();
	});
});
