import { describe, expect, test } from 'vitest';

import { STATE_MIX, terminalTheme, THEMES, themeCssProperties, UI_FONTS } from '../theme';

const hexColor = /^#[\da-f]{6}$/i;

function luminance(color: string): number {
	const channels = color
		.slice(1)
		.match(/.{2}/g)!
		.map((channel) => Number.parseInt(channel, 16) / 255)
		.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)) as [
		number,
		number,
		number
	];
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first: string, second: string): number {
	const lighter = Math.max(luminance(first), luminance(second));
	const darker = Math.min(luminance(first), luminance(second));
	return (lighter + 0.05) / (darker + 0.05);
}

function channels(color: string): number[] {
	return color
		.slice(1)
		.match(/.{2}/g)!
		.map((channel) => Number.parseInt(channel, 16));
}

/** Mixes `percent` of `top` into `base`, as `color-mix(in srgb, top percent, base)` does. */
function mix(base: string, top: string, percent: number): string {
	const [from, to] = [channels(base), channels(top)];
	return `#${from
		.map((channel, index) => Math.round(channel + (to[index]! - channel) * (percent / 100)))
		.map((channel) => channel.toString(16).padStart(2, '0'))
		.join('')}`;
}

describe('bundled themes', () => {
	test('provide the complete semantic, syntax, terminal, and Neovim contract', () => {
		for (const [name, theme] of Object.entries(THEMES)) {
			expect(theme.name).toBe(name);
			expect(Object.values(theme.colors).every((color) => hexColor.test(color))).toBe(true);
			expect(Object.values(theme.syntax).every((color) => hexColor.test(color))).toBe(true);
			expect(theme.terminal.ansi).toHaveLength(16);
			expect(theme.terminal.ansi.every((color) => hexColor.test(color))).toBe(true);
			expect(theme.neovim.normal).toEqual({
				background: theme.terminal.background,
				foreground: theme.terminal.foreground
			});
		}
	});

	test('maps every syntax role to editor CSS properties', () => {
		for (const theme of Object.values(THEMES)) {
			const properties = themeCssProperties(theme.name, 'inter');
			for (const [role, color] of Object.entries(theme.syntax)) {
				expect(properties[`--pau-syntax-${role}`]).toBe(color);
			}
		}
	});

	test('keeps text and meaningful state colors distinguishable on their surfaces', () => {
		for (const theme of Object.values(THEMES)) {
			for (const surface of ['surface', 'surfaceRaised'] as const) {
				expect(contrast(theme.colors.text, theme.colors[surface]), `${theme.name} text`).toBeGreaterThanOrEqual(4.5);
				expect(contrast(theme.colors.textMuted, theme.colors[surface]), `${theme.name} muted`).toBeGreaterThanOrEqual(
					4.5
				);
				expect(contrast(theme.colors.focus, theme.colors[surface]), `${theme.name} focus`).toBeGreaterThanOrEqual(3);
				// The waiting state line and the Needs you count sit on the bay and on raised strips.
				expect(contrast(theme.colors.accent, theme.colors[surface]), `${theme.name} accent`).toBeGreaterThanOrEqual(
					4.5
				);
				for (const status of ['success', 'warning', 'danger', 'info'] as const) {
					expect(
						contrast(theme.colors[status], theme.colors[surface]),
						`${theme.name} ${status} on ${surface}`
					).toBeGreaterThanOrEqual(4.5);
				}
			}
		}
	});
});

describe('control borders', () => {
	/*
	 * The control border is what identifies a text field or a secondary
	 * button, so it keeps 3:1 against every surface a control sits on: the
	 * four surface steps, the overlay and the request card's accent wash. A
	 * pressed button steps up to the strong border, which keeps 3:1 on the
	 * pressed tint.
	 */
	test('keep 3:1 or better on every surface a control sits on', () => {
		for (const { name, colors } of Object.values(THEMES)) {
			const surfaces = {
				canvas: colors.canvas,
				surface: colors.surface,
				raised: colors.surfaceRaised,
				selected: colors.surfaceSelected,
				overlay: colors.surfaceOverlay,
				request: mix(colors.surfaceRaised, colors.accent, 6)
			};
			const pressed = mix(colors.surfaceRaised, colors.text, STATE_MIX.press);
			expect(contrast(colors.borderStrong, pressed), `${name} strong border on pressed`).toBeGreaterThanOrEqual(3);
			for (const [surface, color] of Object.entries(surfaces)) {
				expect(contrast(colors.borderControl, color), `${name} control border on ${surface}`).toBeGreaterThanOrEqual(3);
				expect(contrast(colors.borderStrong, color), `${name} strong border on ${surface}`).toBeGreaterThan(
					contrast(colors.borderControl, color)
				);
			}
		}
	});

	test('keep pane rules quieter than control borders', () => {
		for (const { name, colors } of Object.values(THEMES)) {
			expect(contrast(colors.border, colors.surface), name).toBeLessThan(
				contrast(colors.borderControl, colors.surface)
			);
		}
	});
});

describe('hover and press colors', () => {
	test('keep text, muted, and danger text readable on tinted canvas and surface', () => {
		for (const { name, colors } of Object.values(THEMES)) {
			for (const surface of ['canvas', 'surface'] as const) {
				for (const state of ['hover', 'press'] as const) {
					const background = mix(colors[surface], colors.text, STATE_MIX[state]);
					for (const role of ['text', 'textMuted', 'danger'] as const) {
						expect(contrast(colors[role], background), `${name} ${role} on ${state} ${surface}`).toBeGreaterThanOrEqual(
							4.5
						);
					}
				}
			}
		}
	});

	test('keep the primary label and links readable as the accent moves', () => {
		for (const { name, colors } of Object.values(THEMES)) {
			for (const state of ['accentHover', 'accentPress'] as const) {
				const accent = mix(colors.accent, colors.text, STATE_MIX[state]);
				expect(contrast(colors.textOnAccent, accent), `${name} primary label on ${state}`).toBeGreaterThanOrEqual(4.5);
				for (const surface of ['canvas', 'surface'] as const) {
					expect(contrast(accent, colors[surface]), `${name} ${state} link on ${surface}`).toBeGreaterThanOrEqual(4.5);
				}
			}
		}
	});

	test('keep popover options readable under the pointer and when pressed', () => {
		for (const { name, colors } of Object.values(THEMES)) {
			for (const fill of ['surfaceSelected', 'surface'] as const) {
				for (const role of ['text', 'textMuted'] as const) {
					expect(contrast(colors[role], colors[fill]), `${name} ${role} on ${fill}`).toBeGreaterThanOrEqual(4.5);
				}
			}
		}
	});

	test('reach components as theme properties', () => {
		const properties = themeCssProperties('nord', 'inter');
		expect(properties['--pau-hover']).toBe(`color-mix(in srgb, ${THEMES.nord.colors.text} 5%, transparent)`);
		expect(properties['--pau-accent-press']).toBe(
			`color-mix(in srgb, ${THEMES.nord.colors.text} 45%, ${THEMES.nord.colors.accent})`
		);
	});
});

test('maps every bundled font to the component CSS contract', () => {
	for (const fontName of Object.keys(UI_FONTS) as (keyof typeof UI_FONTS)[]) {
		const properties = themeCssProperties('eldritch', fontName);
		expect(properties['--pau-font-ui']).toContain(UI_FONTS[fontName].family);
	}
});

test('maps each terminal palette to xterm.js colors in ANSI order', () => {
	for (const theme of Object.values(THEMES)) {
		const colors = terminalTheme(theme.name);
		expect(colors.background).toBe(theme.terminal.background);
		expect(colors.cursorAccent).toBe(theme.terminal.background);
		expect(colors.selectionBackground).toBe(theme.terminal.selection);
		expect([colors.black, colors.red, colors.blue, colors.brightWhite]).toEqual([
			theme.terminal.ansi[0],
			theme.terminal.ansi[1],
			theme.terminal.ansi[4],
			theme.terminal.ansi[15]
		]);
	}
});
