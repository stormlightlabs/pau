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
			// Text centering, measured at the Retina scale the desktop app draws
			// at, in Chromium and in WebKit, the desktop app's engine, which
			// places text differently.
			...(['chromium', 'webkit'] as const).map((engine) => ({
				extends: true as const,
				test: {
					name: `centering-${engine}`,
					include: ['src/tests/LabelCentering.svelte.test.ts'],
					setupFiles: ['vitest-browser-svelte'],
					browser: browser({ engine, deviceScaleFactor: 2 })
				}
			})),
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
