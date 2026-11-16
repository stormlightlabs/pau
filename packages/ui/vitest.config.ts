import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));
type BrowserOptions = {
	reducedMotion?: 'reduce' | 'no-preference';
	engine?: 'chromium' | 'webkit';
	deviceScaleFactor?: number;
};
const browser = ({ reducedMotion, engine = 'chromium', deviceScaleFactor }: BrowserOptions = {}) => ({
	enabled: true,
	headless: true,
	provider: playwright({ contextOptions: { reducedMotion, deviceScaleFactor } }),
	instances: [{ browser: engine }]
});

export default defineConfig({
	plugins: [svelte()],
	test: {
		projects: [
			{ extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'], exclude: ['src/**/*.svelte.test.ts'] } },
			{
				extends: true,
				test: {
					name: 'components',
					include: ['src/**/*.svelte.test.ts'],
					exclude: ['src/tests/motion-query.svelte.test.ts', 'src/tests/LabelCentering.svelte.test.ts'],
					setupFiles: ['vitest-browser-svelte'],
					browser: browser()
				}
			},
			// Text centering in Chromium and in WebKit, the desktop app's engine,
			// on a standard display, on a Retina display, and on a Retina display
			// at 125% browser zoom, which raises the device scale. WebKit on the
			// Retina display also measures input text at 125% page zoom, which is
			// how the desktop app zooms. Each project runs alone after the others,
			// because its full-page screenshots time out when other browsers
			// compete for the machine.
			...(['chromium', 'webkit'] as const).flatMap((engine, engineIndex) =>
				[1, 2, 2.5].map((deviceScaleFactor, scaleIndex) => ({
					extends: true as const,
					test: {
						name: `centering-${engine}-${deviceScaleFactor}x`,
						include: ['src/tests/LabelCentering.svelte.test.ts'],
						setupFiles: ['vitest-browser-svelte'],
						provide: { pageZooms: engine === 'webkit' && deviceScaleFactor === 2 ? [1, 1.25] : [1] },
						sequence: { groupOrder: 1 + engineIndex * 3 + scaleIndex },
						browser: browser({ engine, deviceScaleFactor })
					}
				}))
			),
			// The OS reduced-motion query, on and off, for the motion setting.
			...(['reduce', 'no-preference'] as const).map((reducedMotion) => ({
				extends: true as const,
				test: {
					name: `motion-os-${reducedMotion}`,
					include: ['src/tests/motion-query.svelte.test.ts'],
					setupFiles: ['vitest-browser-svelte'],
					browser: browser({ reducedMotion })
				}
			})),
			{
				extends: true,
				plugins: [storybookTest({ configDir: path.join(dirname, '.storybook') })],
				test: { name: 'storybook', browser: browser() }
			}
		]
	}
});
