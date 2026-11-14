import type { ITheme } from '@xterm/xterm';

/** Names of the color themes bundled with Pau. */
export type ThemeName = 'eldritch' | 'nord' | 'iceberg' | 'catppuccin-mocha' | 'vitesse-dark';

/** Names of the application typefaces bundled with Pau. */
export type UiFontName =
	'overpass' | 'ibm-plex-sans' | 'inter' | 'atkinson-hyperlegible-next' | 'atkinson-hyperlegible-soft';

export type ThemeColors = {
	canvas: string;
	surface: string;
	surfaceRaised: string;
	border: string;
	text: string;
	textMuted: string;
	accent: string;
	focus: string;
	success: string;
	warning: string;
	danger: string;
	info: string;
	selection: string;
};

export type SyntaxColors = {
	comment: string;
	keyword: string;
	string: string;
	number: string;
	function: string;
	type: string;
	variable: string;
	invalid: string;
};

export type TerminalColors = {
	background: string;
	foreground: string;
	cursor: string;
	selection: string;
	ansi: readonly [
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string
	];
};

/** Shared color data consumed by the application, editors, terminals, and Neovim. */
export type PauTheme = {
	name: ThemeName;
	label: string;
	colors: ThemeColors;
	syntax: SyntaxColors;
	terminal: TerminalColors;
	neovim: {
		normal: { background: string; foreground: string };
		comment: string;
		cursorLine: string;
		visual: string;
		search: string;
	};
};

/** User-selectable UI fonts, with the names Settings shows. Font files are bundled and never loaded from a remote origin. */
export const UI_FONTS = {
	overpass: { label: 'Overpass', family: "'Overpass Variable'" },
	'ibm-plex-sans': { label: 'IBM Plex Sans', family: "'IBM Plex Sans Variable'" },
	inter: { label: 'Inter', family: "'Inter Variable'" },
	'atkinson-hyperlegible-next': {
		label: 'Atkinson Hyperlegible Next',
		family: "'Atkinson Hyperlegible Next Variable'"
	},
	'atkinson-hyperlegible-soft': { label: 'Atkinson Hyperlegible Soft', family: "'Atkinson Hyperlegible Soft'" }
} as const satisfies Record<UiFontName, { label: string; family: string }>;

const theme = (value: PauTheme): PauTheme => value;

/** The five first-release themes, mapped from their upstream palettes. */
export const THEMES = {
	eldritch: theme({
		name: 'eldritch',
		label: 'Eldritch',
		colors: {
			canvas: '#12151d',
			surface: '#171b27',
			surfaceRaised: '#202536',
			border: '#293044',
			text: '#e6e9f2',
			textMuted: '#9aa3bd',
			accent: '#38ef9d',
			focus: '#04d1f9',
			success: '#57e69a',
			warning: '#f5bf69',
			danger: '#ee7180',
			info: '#43c7e8',
			selection: '#2a3045'
		},
		syntax: {
			comment: '#6b7089',
			keyword: '#a48cf2',
			string: '#37f499',
			number: '#f1fc79',
			function: '#04d1f9',
			type: '#f16c75',
			variable: '#ebfafa',
			invalid: '#f16c75'
		},
		terminal: {
			background: '#12151d',
			foreground: '#e6e9f2',
			cursor: '#38ef9d',
			selection: '#22423a',
			ansi: [
				'#171928',
				'#f16c75',
				'#37f499',
				'#f1fc79',
				'#7081d0',
				'#a48cf2',
				'#04d1f9',
				'#ebfafa',
				'#454759',
				'#f16c75',
				'#37f499',
				'#f7c67f',
				'#7081d0',
				'#f265b5',
				'#04d1f9',
				'#ffffff'
			]
		},
		neovim: {
			normal: { background: '#12151d', foreground: '#e6e9f2' },
			comment: '#6b7089',
			cursorLine: '#1c1f28',
			visual: '#22423a',
			search: '#454759'
		}
	}),
	nord: theme({
		name: 'nord',
		label: 'Nord',
		colors: {
			canvas: '#242933',
			surface: '#2e3440',
			surfaceRaised: '#3b4252',
			border: '#414a5b',
			text: '#eceff4',
			textMuted: '#b5bfce',
			accent: '#88c0d0',
			focus: '#88c0d0',
			success: '#a3be8c',
			warning: '#ebcb8b',
			danger: '#f5aab0',
			info: '#a8c9e5',
			selection: '#434c5e'
		},
		syntax: {
			comment: '#616e88',
			keyword: '#81a1c1',
			string: '#a3be8c',
			number: '#b48ead',
			function: '#88c0d0',
			type: '#8fbcbb',
			variable: '#d8dee9',
			invalid: '#bf616a'
		},
		terminal: {
			background: '#242933',
			foreground: '#d8dee9',
			cursor: '#d8dee9',
			selection: '#3a4a55',
			ansi: [
				'#3b4252',
				'#bf616a',
				'#a3be8c',
				'#ebcb8b',
				'#81a1c1',
				'#b48ead',
				'#88c0d0',
				'#e5e9f0',
				'#4c566a',
				'#bf616a',
				'#a3be8c',
				'#ebcb8b',
				'#81a1c1',
				'#b48ead',
				'#8fbcbb',
				'#eceff4'
			]
		},
		neovim: {
			normal: { background: '#242933', foreground: '#d8dee9' },
			comment: '#616e88',
			cursorLine: '#2e333d',
			visual: '#3a4a55',
			search: '#5e81ac'
		}
	}),
	iceberg: theme({
		name: 'iceberg',
		label: 'Iceberg',
		colors: {
			canvas: '#11131d',
			surface: '#161923',
			surfaceRaised: '#1e2230',
			border: '#2b3044',
			text: '#c6c8d1',
			textMuted: '#a3adcb',
			accent: '#84a0c6',
			focus: '#95c4ce',
			success: '#b4be82',
			warning: '#e2a478',
			danger: '#e27878',
			info: '#89b8c2',
			selection: '#252a3b'
		},
		syntax: {
			comment: '#8389a3',
			keyword: '#a093c7',
			string: '#b4be82',
			number: '#e2a478',
			function: '#84a0c6',
			type: '#89b8c2',
			variable: '#c6c8d1',
			invalid: '#e27878'
		},
		terminal: {
			background: '#11131d',
			foreground: '#c6c8d1',
			cursor: '#c6c8d1',
			selection: '#293141',
			ansi: [
				'#1e2132',
				'#e27878',
				'#b4be82',
				'#e2a478',
				'#84a0c6',
				'#a093c7',
				'#89b8c2',
				'#c6c8d1',
				'#6b7089',
				'#e98989',
				'#c0ca8e',
				'#e9b189',
				'#91acd1',
				'#ada0d3',
				'#95c4ce',
				'#d2d4de'
			]
		},
		neovim: {
			normal: { background: '#11131d', foreground: '#c6c8d1' },
			comment: '#6b7089',
			cursorLine: '#1a1c26',
			visual: '#293141',
			search: '#e4aa80'
		}
	}),
	'catppuccin-mocha': theme({
		name: 'catppuccin-mocha',
		label: 'Catppuccin Mocha',
		colors: {
			canvas: '#11111b',
			surface: '#181825',
			surfaceRaised: '#1e1e2e',
			border: '#393b4b',
			text: '#cdd6f4',
			textMuted: '#a6adc8',
			accent: '#cba6f7',
			focus: '#89dceb',
			success: '#a6e3a1',
			warning: '#f9e2af',
			danger: '#f38ba8',
			info: '#89dceb',
			selection: '#313244'
		},
		syntax: {
			comment: '#6c7086',
			keyword: '#cba6f7',
			string: '#a6e3a1',
			number: '#fab387',
			function: '#89b4fa',
			type: '#f9e2af',
			variable: '#cdd6f4',
			invalid: '#f38ba8'
		},
		terminal: {
			background: '#1e1e2e',
			foreground: '#cdd6f4',
			cursor: '#f5e0dc',
			selection: '#373048',
			ansi: [
				'#45475a',
				'#f38ba8',
				'#a6e3a1',
				'#f9e2af',
				'#89b4fa',
				'#f5c2e7',
				'#94e2d5',
				'#bac2de',
				'#585b70',
				'#f38ba8',
				'#a6e3a1',
				'#f9e2af',
				'#89b4fa',
				'#f5c2e7',
				'#94e2d5',
				'#a6adc8'
			]
		},
		neovim: {
			normal: { background: '#1e1e2e', foreground: '#cdd6f4' },
			comment: '#6c7086',
			cursorLine: '#1a1a26',
			visual: '#373048',
			search: '#585b70'
		}
	}),
	'vitesse-dark': theme({
		name: 'vitesse-dark',
		label: 'Vitesse Dark',
		colors: {
			canvas: '#121212',
			surface: '#171717',
			surfaceRaised: '#222222',
			border: '#303030',
			text: '#dbd7ca',
			textMuted: '#a3a3a3',
			accent: '#4d9375',
			focus: '#5eaab5',
			success: '#80a665',
			warning: '#e6cc77',
			danger: '#cb7676',
			info: '#5da994',
			selection: '#2a2a2a'
		},
		syntax: {
			comment: '#758575',
			keyword: '#4d9375',
			string: '#c98a7d',
			number: '#4c9a91',
			function: '#80a665',
			type: '#5da994',
			variable: '#bd976a',
			invalid: '#cb7676'
		},
		terminal: {
			background: '#121212',
			foreground: '#dbd7ca',
			cursor: '#dbd7ca',
			selection: '#212d27',
			ansi: [
				'#393a34',
				'#cb7676',
				'#4d9375',
				'#e6cc77',
				'#6394bf',
				'#d9739f',
				'#5eaab5',
				'#dbd7ca',
				'#777777',
				'#cb7676',
				'#4d9375',
				'#e6cc77',
				'#6394bf',
				'#d9739f',
				'#5eaab5',
				'#ffffff'
			]
		},
		neovim: {
			normal: { background: '#121212', foreground: '#dbd7ca' },
			comment: '#758575',
			cursorLine: '#1c1b1b',
			visual: '#212d27',
			search: '#e6cc77'
		}
	})
} as const satisfies Record<ThemeName, PauTheme>;

/**
 * How far hover and press move a control from rest, as a percentage of the
 * theme's text color.
 *
 * `hover` and `press` tint whatever surface a control sits on: the shared
 * control rules lay them over the control's own background, so one value
 * works on the canvas, the surface, and a button with a fill. `accentHover`
 * and `accentPress` mix text into the accent for the primary button. Press
 * stays low enough that muted and danger text keep 4.5:1 on the pressed
 * canvas and surface in every bundled theme, which the theme tests check.
 */
export const STATE_MIX = { hover: 5, press: 8, accentHover: 25, accentPress: 45 } as const;

/** Converts a bundled theme and font choice into the CSS properties used by Pau components. */
export function themeCssProperties(themeName: ThemeName, fontName: UiFontName): Record<string, string> {
	const { colors, syntax } = THEMES[themeName];
	const tint = (base: string, percent: number) => `color-mix(in srgb, ${colors.text} ${percent}%, ${base})`;
	return {
		'--pau-canvas': colors.canvas,
		'--pau-surface': colors.surface,
		'--pau-surface-raised': colors.surfaceRaised,
		'--pau-border': colors.border,
		'--pau-text': colors.text,
		'--pau-text-muted': colors.textMuted,
		'--pau-accent': colors.accent,
		'--pau-focus': colors.focus,
		'--pau-success': colors.success,
		'--pau-warning': colors.warning,
		'--pau-danger': colors.danger,
		'--pau-info': colors.info,
		'--pau-selection': colors.selection,
		'--pau-hover': tint('transparent', STATE_MIX.hover),
		'--pau-press': tint('transparent', STATE_MIX.press),
		'--pau-accent-hover': tint(colors.accent, STATE_MIX.accentHover),
		'--pau-accent-press': tint(colors.accent, STATE_MIX.accentPress),
		'--pau-syntax-comment': syntax.comment,
		'--pau-syntax-keyword': syntax.keyword,
		'--pau-syntax-string': syntax.string,
		'--pau-syntax-number': syntax.number,
		'--pau-syntax-function': syntax.function,
		'--pau-syntax-type': syntax.type,
		'--pau-syntax-variable': syntax.variable,
		'--pau-syntax-invalid': syntax.invalid,
		'--pau-font-ui': `${UI_FONTS[fontName].family}, ui-sans-serif, system-ui, sans-serif`
	};
}

const ANSI_NAMES = [
	'black',
	'red',
	'green',
	'yellow',
	'blue',
	'magenta',
	'cyan',
	'white',
	'brightBlack',
	'brightRed',
	'brightGreen',
	'brightYellow',
	'brightBlue',
	'brightMagenta',
	'brightCyan',
	'brightWhite'
] as const satisfies readonly (keyof ITheme)[];

/**
 * Converts a bundled theme's terminal palette into xterm.js colors. The cursor
 * accent uses the terminal background so the character under a block cursor
 * stays readable.
 */
export function terminalTheme(themeName: ThemeName): ITheme {
	const { background, foreground, cursor, selection, ansi } = THEMES[themeName].terminal;
	const colors: ITheme = { background, foreground, cursor, cursorAccent: background, selectionBackground: selection };
	for (const [index, name] of ANSI_NAMES.entries()) colors[name] = ansi[index];
	return colors;
}
