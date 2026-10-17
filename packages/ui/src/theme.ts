import type { ITheme } from '@xterm/xterm';

/** Names of the color themes bundled with Pau. */
export type ThemeName = 'eldritch' | 'nord' | 'iceberg' | 'catppuccin-mocha' | 'vitesse-dark';

/** Names of the application typefaces bundled with Pau. */
export type UiFontName = 'ibm-plex-sans' | 'inter' | 'atkinson-hyperlegible-next' | 'atkinson-hyperlegible-soft';

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

/** User-selectable UI fonts. Font files are bundled and never loaded from a remote origin. */
export const UI_FONTS = {
	'ibm-plex-sans': { label: 'IBM Plex Sans Variable', family: "'IBM Plex Sans Variable'" },
	inter: { label: 'Inter Variable', family: "'Inter Variable'" },
	'atkinson-hyperlegible-next': {
		label: 'Atkinson Hyperlegible Next Variable',
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
			canvas: '#171928',
			surface: '#212337',
			surfaceRaised: '#323449',
			border: '#454759',
			text: '#ebfafa',
			textMuted: '#aeb9d8',
			accent: '#37f499',
			focus: '#04d1f9',
			success: '#37f499',
			warning: '#f1fc79',
			danger: '#ff8e9e',
			info: '#04d1f9',
			selection: '#323449'
		},
		syntax: {
			comment: '#7081d0',
			keyword: '#a48cf2',
			string: '#f1fc79',
			number: '#f7c67f',
			function: '#37f499',
			type: '#04d1f9',
			variable: '#ebfafa',
			invalid: '#f16c75'
		},
		terminal: {
			background: '#171928',
			foreground: '#ebfafa',
			cursor: '#37f499',
			selection: '#454759',
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
			normal: { background: '#171928', foreground: '#ebfafa' },
			comment: '#7081d0',
			cursorLine: '#252738',
			visual: '#323449',
			search: '#454759'
		}
	}),
	nord: theme({
		name: 'nord',
		label: 'Nord',
		colors: {
			canvas: '#2e3440',
			surface: '#3b4252',
			surfaceRaised: '#434c5e',
			border: '#4c566a',
			text: '#eceff4',
			textMuted: '#d8dee9',
			accent: '#88c0d0',
			focus: '#88c0d0',
			success: '#b5d0a0',
			warning: '#ebcb8b',
			danger: '#f5aab0',
			info: '#a8c9e5',
			selection: '#434c5e'
		},
		syntax: {
			comment: '#8b96aa',
			keyword: '#81a1c1',
			string: '#a3be8c',
			number: '#b48ead',
			function: '#88c0d0',
			type: '#8fbcbb',
			variable: '#d8dee9',
			invalid: '#bf616a'
		},
		terminal: {
			background: '#2e3440',
			foreground: '#d8dee9',
			cursor: '#d8dee9',
			selection: '#434c5e',
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
			normal: { background: '#2e3440', foreground: '#d8dee9' },
			comment: '#8b96aa',
			cursorLine: '#3b4252',
			visual: '#434c5e',
			search: '#5e81ac'
		}
	}),
	iceberg: theme({
		name: 'iceberg',
		label: 'Iceberg',
		colors: {
			canvas: '#161821',
			surface: '#1e2132',
			surfaceRaised: '#272c42',
			border: '#3e445e',
			text: '#c6c8d1',
			textMuted: '#a3adcb',
			accent: '#84a0c6',
			focus: '#95c4ce',
			success: '#b4be82',
			warning: '#e2a478',
			danger: '#e27878',
			info: '#89b8c2',
			selection: '#272c42'
		},
		syntax: {
			comment: '#8389a3',
			keyword: '#84a0c6',
			string: '#89b8c2',
			number: '#a093c7',
			function: '#e2a478',
			type: '#b4be82',
			variable: '#c6c8d1',
			invalid: '#e27878'
		},
		terminal: {
			background: '#161821',
			foreground: '#c6c8d1',
			cursor: '#c6c8d1',
			selection: '#272c42',
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
			normal: { background: '#161821', foreground: '#c6c8d1' },
			comment: '#6b7089',
			cursorLine: '#1e2132',
			visual: '#272c42',
			search: '#e4aa80'
		}
	}),
	'catppuccin-mocha': theme({
		name: 'catppuccin-mocha',
		label: 'Catppuccin Mocha',
		colors: {
			canvas: '#11111b',
			surface: '#1e1e2e',
			surfaceRaised: '#313244',
			border: '#45475a',
			text: '#cdd6f4',
			textMuted: '#bac2de',
			accent: '#cba6f7',
			focus: '#89dceb',
			success: '#a6e3a1',
			warning: '#f9e2af',
			danger: '#f38ba8',
			info: '#89b4fa',
			selection: '#45475a'
		},
		syntax: {
			comment: '#9399b2',
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
			selection: '#45475a',
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
			comment: '#9399b2',
			cursorLine: '#313244',
			visual: '#45475a',
			search: '#585b70'
		}
	}),
	'vitesse-dark': theme({
		name: 'vitesse-dark',
		label: 'Vitesse Dark',
		colors: {
			canvas: '#121212',
			surface: '#181818',
			surfaceRaised: '#2f363d',
			border: '#3f3f3f',
			text: '#dbd7ca',
			textMuted: '#bfbaaa',
			accent: '#4d9375',
			focus: '#5eaab5',
			success: '#91b879',
			warning: '#e6cc77',
			danger: '#df8d8d',
			info: '#7aaed8',
			selection: '#2f363d'
		},
		syntax: {
			comment: '#8b9b8b',
			keyword: '#4d9375',
			string: '#c98a7d',
			number: '#5eaab5',
			function: '#80a665',
			type: '#5d99a9',
			variable: '#bd976a',
			invalid: '#cb7676'
		},
		terminal: {
			background: '#121212',
			foreground: '#dbd7ca',
			cursor: '#dbd7ca',
			selection: '#2f363d',
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
			comment: '#8b9b8b',
			cursorLine: '#181818',
			visual: '#2f363d',
			search: '#e6cc77'
		}
	})
} as const satisfies Record<ThemeName, PauTheme>;

/** Converts a bundled theme and font choice into the CSS properties used by Pau components. */
export function themeCssProperties(themeName: ThemeName, fontName: UiFontName): Record<string, string> {
	const { colors, syntax } = THEMES[themeName];
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
