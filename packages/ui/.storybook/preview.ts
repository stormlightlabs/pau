import type { Preview } from '@storybook/svelte-vite';

import { themeCssProperties } from '../src/theme';
import '../src/styles/tokens.css';
import './preview.css';

const preview = {
	decorators: [
		(Story, context) => {
			const root = document.documentElement;
			root.dataset.workbenchTheme = String(context.globals.theme);
			root.dataset.reducedMotion = String(context.globals.reducedMotion);
			root.dataset.capabilityProfile = String(context.globals.capabilityProfile);
			const themeProperties = Object.entries(themeCssProperties(context.globals.theme, context.globals.uiFont));
			for (const [property, value] of themeProperties) {
				root.style.setProperty(property, value);
			}
			return Story();
		}
	],
	globalTypes: {
		theme: {
			description: 'Workbench color theme',
			toolbar: {
				title: 'Theme',
				items: [
					{ value: 'eldritch', title: 'Eldritch' },
					{ value: 'nord', title: 'Nord' },
					{ value: 'iceberg', title: 'Iceberg' },
					{ value: 'catppuccin-mocha', title: 'Catppuccin Mocha' },
					{ value: 'vitesse-dark', title: 'Vitesse Dark' }
				]
			}
		},
		uiFont: {
			description: 'Application UI font',
			toolbar: {
				title: 'Font',
				items: [
					{ value: 'ibm-plex-sans', title: 'IBM Plex Sans' },
					{ value: 'inter', title: 'Inter' },
					{ value: 'atkinson-hyperlegible-next', title: 'Atkinson Hyperlegible Next' },
					{ value: 'atkinson-hyperlegible-soft', title: 'Atkinson Hyperlegible Soft' }
				]
			}
		},
		reducedMotion: {
			description: 'Motion preference',
			toolbar: {
				title: 'Motion',
				items: [
					{ value: 'off', title: 'Full motion' },
					{ value: 'on', title: 'Reduced motion' }
				]
			}
		},
		capabilityProfile: {
			description: 'Agent capability profile',
			toolbar: {
				title: 'Capabilities',
				items: [
					{ value: 'full', title: 'Full' },
					{ value: 'restricted', title: 'Restricted' },
					{ value: 'offline', title: 'Offline' }
				]
			}
		}
	},
	initialGlobals: { theme: 'eldritch', uiFont: 'ibm-plex-sans', reducedMotion: 'off', capabilityProfile: 'full' },
	parameters: {
		a11y: { test: 'error' },
		layout: 'centered',
		viewport: {
			options: {
				narrow: { name: 'Narrow', styles: { width: '360px', height: '800px' } },
				wide: { name: 'Wide', styles: { width: '1440px', height: '900px' } }
			}
		}
	}
} satisfies Preview;

export default preview;
