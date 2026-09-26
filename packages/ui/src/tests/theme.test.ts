import { describe, expect, test } from 'vitest';

import { THEMES, themeCssProperties, UI_FONTS } from '../theme';

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

test('maps every bundled font to the component CSS contract', () => {
	for (const fontName of Object.keys(UI_FONTS) as (keyof typeof UI_FONTS)[]) {
		const properties = themeCssProperties('eldritch', fontName);
		expect(properties['--pau-font-ui']).toContain(UI_FONTS[fontName].family);
	}
});
