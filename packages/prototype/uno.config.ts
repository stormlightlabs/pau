import presetIcons from '@unocss/preset-icons';
import { defineConfig, presetWind3 } from 'unocss';

/**
 * Utilities are the prototype's styling layer. Values live in
 * `src/lib/design/tokens.css`; repeated patterns become shortcuts here instead
 * of hand-written classes.
 */
export default defineConfig({
	presets: [
		presetWind3(),
		presetIcons({
			extraProperties: { display: 'inline-block', 'flex-shrink': '0', 'vertical-align': '-0.125em' },
			warn: true
		})
	],
	theme: {
		fontFamily: {
			sans: 'var(--font-ui)',
			mono: 'var(--font-code)',
			heading: 'var(--site-heading)',
			sitecode: 'var(--site-code)'
		},
		fontSize: {
			micro: ['var(--text-micro)', '1.3'],
			meta: ['var(--text-xs)', '1.45'],
			body: ['var(--text-sm)', '1.5'],
			prose: ['var(--text-md)', '1.65'],
			code: ['0.78rem', '1.7']
		},
		colors: {
			canvas: 'var(--color-canvas)',
			surface: 'var(--color-surface)',
			'surface-raised': 'var(--color-surface-raised)',
			'surface-selected': 'var(--color-surface-selected)',
			line: 'var(--color-line)',
			'line-strong': 'var(--color-line-strong)',
			text: 'var(--color-text)',
			muted: 'var(--color-text-muted)',
			accent: 'var(--color-accent)',
			'accent-soft': 'var(--color-accent-soft)',
			positive: 'var(--color-positive)',
			warning: 'var(--color-warning)',
			danger: 'var(--color-danger)',
			info: 'var(--color-info)',
			syntax: {
				keyword: 'var(--syn-keyword)',
				entity: 'var(--syn-entity)',
				string: 'var(--syn-string)',
				constant: 'var(--syn-constant)',
				comment: 'var(--syn-comment)',
				type: 'var(--syn-type)'
			},
			added: 'var(--diff-add-fg)',
			removed: 'var(--diff-del-fg)',
			'added-wash': 'var(--diff-add-bg)',
			'removed-wash': 'var(--diff-del-bg)',
			wash: { warning: 'var(--wash-warning)', danger: 'var(--wash-danger)', accent: 'var(--wash-accent)' },
			'line-active': 'var(--editor-active-line)',
			selection: 'var(--editor-selection)',
			ansi: {
				red: 'var(--ansi-red)',
				green: 'var(--ansi-green)',
				yellow: 'var(--ansi-yellow)',
				blue: 'var(--ansi-blue)',
				dim: 'var(--ansi-dim)'
			},
			site: {
				ink: 'var(--site-ink)',
				muted: 'var(--site-muted)',
				line: 'var(--site-line)',
				paper: 'var(--site-paper)',
				deep: 'var(--site-paper-deep)',
				raised: 'var(--site-raised)',
				accent: 'var(--site-accent)',
				'accent-strong': 'var(--site-accent-strong)',
				focus: 'var(--site-focus)',
				highlight: 'var(--site-highlight)',
				code: 'var(--site-code)',
				'code-line': 'var(--site-code-line)',
				'code-ink': 'var(--site-code-ink)'
			}
		}
	},
	shortcuts: {
		'prototype-kicker': 'text-xs font-600 tracking-[0.12em] uppercase text-accent',
		'site-eyebrow': 'm-0 mb-3.5 font-sitecode text-[0.72rem] font-650 tracking-[0.065em] uppercase text-site-accent',
		'site-heading': 'font-heading font-600 tracking-[-0.035em]',
		'site-button':
			'inline-flex min-h-11.5 items-center justify-center gap-2 border border-site-line bg-transparent px-4 py-2 font-650 text-site-ink hover:border-site-accent',
		'site-button-primary': 'site-button border-site-accent bg-site-accent text-site-paper',
		'app-button':
			'inline-flex min-h-8 items-center justify-center gap-2 border border-line bg-surface-raised px-3 text-body text-text transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
		'app-button-primary':
			'inline-flex min-h-8 items-center justify-center gap-2 border border-accent bg-accent px-3 text-body font-650 text-canvas transition-opacity hover:opacity-88 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
		'icon-button':
			'inline-flex size-8 items-center justify-center border border-transparent text-muted transition-colors hover:border-line hover:bg-surface-raised hover:text-text aria-pressed:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
		'status-dot': 'inline-block size-2 rounded-full bg-current',
		'app-field':
			'min-h-8 w-full border border-line bg-canvas px-2 text-body text-text outline-none placeholder:text-muted focus:border-accent',

		// Panes and bars
		'pane-header': 'flex min-h-11 items-center gap-2 border-b border-line bg-surface pl-3 pr-2',
		'pane-title': 'flex min-w-0 flex-1 items-center gap-1.5 text-body font-650 text-text',
		'pane-actions': 'ml-auto flex items-center gap-px',
		'section-head': 'flex min-h-9 items-center gap-3 border-b border-line pl-4 pr-2',
		'section-label': 'text-micro font-650 uppercase tracking-[0.08em] text-muted',
		'quiet-button': 'border-0 bg-transparent px-1.5 py-1 text-micro text-muted hover:bg-surface-raised hover:text-text',
		statusbar:
			'flex min-h-7.5 items-center gap-3 whitespace-nowrap border-t border-line bg-surface px-3 font-mono text-micro text-muted',

		// Small inline objects
		chip: 'inline-flex min-h-5.5 max-w-full items-center gap-1.5 whitespace-nowrap border border-line bg-canvas px-1.5 text-micro text-muted',
		'chip-code': 'chip font-mono',
		'chip-accent': 'chip border-accent-soft bg-accent-soft text-accent',
		'chip-warning': 'chip border-warning text-warning',
		diffstat: 'inline-flex gap-1.5 whitespace-nowrap font-mono text-micro',

		// Selectable rows
		'row-button':
			'w-full border-0 border-l-2 border-transparent bg-transparent text-left text-muted hover:bg-surface-raised aria-pressed:border-l-accent aria-pressed:bg-surface-selected',
		'work-row': 'row-button grid min-h-13 items-center gap-3 border-b border-b-line py-2 pl-4 pr-3 text-meta',
		'data-row': 'grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-4 text-meta',

		// Conversation
		'turn-label': 'flex items-center gap-1.5 text-micro font-650 tracking-[0.04em] text-muted',
		'turn-body': 'm-0 max-w-[74ch] text-prose',
		'tool-row':
			'grid min-h-6.5 w-full grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-3 border-0 bg-transparent pl-3 pr-2 text-left font-mono text-micro text-muted hover:bg-surface',

		// Code, Neovim, and terminal surfaces
		'code-surface': 'min-h-0 flex-1 overflow-auto bg-canvas py-2 font-mono text-code',
		'code-line': 'grid grid-cols-[3.5rem_minmax(0,1fr)]',
		'code-gutter': 'select-none pr-3 text-right text-muted',
		'code-text': 'whitespace-pre pr-4',
		'term-surface': 'min-h-0 flex-1 overflow-auto bg-canvas p-3 font-mono text-code text-text',
		'term-line': 'min-h-[1.6em] whitespace-pre-wrap',
		'nvim-segment': 'flex min-w-0 items-center gap-1.5 px-2.5 text-muted',
		'nvim-mode': 'flex items-center px-2.5 font-700 tracking-[0.08em] text-canvas',

		// Composer
		'composer-chip':
			'inline-flex min-h-6 items-center gap-1.5 border border-line bg-canvas py-0 pl-1.5 pr-1 text-micro text-text',
		'composer-tool':
			'inline-flex size-8 items-center justify-center border-0 bg-transparent text-muted hover:bg-surface-selected hover:text-text',
		'composer-menu':
			'h-6 max-w-40 cursor-pointer appearance-none border-0 bg-transparent pl-1.5 pr-5 text-micro text-muted hover:bg-surface-raised hover:text-text'
	}
});
