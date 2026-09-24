import type { Preview } from '@storybook/svelte-vite';

import './preview.css';

const preview = {
	decorators: [
		(Story, context) => {
			const root = document.documentElement;
			root.dataset.workbenchTheme = String(context.globals.theme);
			root.dataset.reducedMotion = String(context.globals.reducedMotion);
			root.dataset.capabilityProfile = String(context.globals.capabilityProfile);
			return Story();
		}
	],
	globalTypes: {
		theme: {
			description: 'Workbench color theme',
			toolbar: {
				title: 'Theme',
				items: [
					{ value: 'light', title: 'Light' },
					{ value: 'dark', title: 'Dark' }
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
	initialGlobals: { theme: 'dark', reducedMotion: 'off', capabilityProfile: 'full' },
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
