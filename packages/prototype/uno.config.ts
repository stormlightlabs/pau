import presetIcons from '@unocss/preset-icons';
import { defineConfig, presetWind3 } from 'unocss';

export default defineConfig({
	presets: [
		presetWind3(),
		presetIcons({
			extraProperties: { display: 'inline-block', 'flex-shrink': '0', 'vertical-align': '-0.125em' },
			warn: true
		})
	],
	theme: {
		fontFamily: { sans: 'var(--font-ui)', mono: 'var(--font-code)' },
		colors: {
			canvas: 'var(--color-canvas)',
			surface: 'var(--color-surface)',
			'surface-raised': 'var(--color-surface-raised)',
			line: 'var(--color-line)',
			text: 'var(--color-text)',
			muted: 'var(--color-text-muted)',
			accent: 'var(--color-accent)',
			'accent-soft': 'var(--color-accent-soft)',
			positive: 'var(--color-positive)',
			warning: 'var(--color-warning)',
			danger: 'var(--color-danger)'
		}
	},
	shortcuts: {
		'prototype-kicker': 'text-xs font-600 tracking-[0.12em] uppercase text-accent',
		'app-button':
			'inline-flex min-h-9 items-center justify-center gap-2 border border-line bg-surface-raised px-3 text-sm text-text transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
		'app-button-primary':
			'inline-flex min-h-9 items-center justify-center gap-2 border border-accent bg-accent px-3 text-sm font-650 text-canvas transition-opacity hover:opacity-88 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
		'icon-button':
			'inline-flex size-9 items-center justify-center border border-transparent text-muted transition-colors hover:border-line hover:bg-surface-raised hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
		'status-dot': 'inline-block size-2 rounded-full bg-current',
		'app-field':
			'min-h-10 w-full border border-line bg-canvas px-3 text-sm text-text outline-none placeholder:text-muted focus:border-accent focus-visible:ring-1 focus-visible:ring-accent'
	}
});
