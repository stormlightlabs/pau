import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const browser = (reducedMotion?: 'reduce' | 'no-preference', engine: 'chromium' | 'webkit' = 'chromium') => ({
	enabled: true,
	headless: true,
	provider: playwright(reducedMotion ? { contextOptions: { reducedMotion } } : undefined),
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
					exclude: ['src/tests/motion-query.svelte.test.ts'],
					setupFiles: ['vitest-browser-svelte'],
					browser: browser()
				}
			},
			// The desktop app renders in WebKit, which places text differently.
			{
				extends: true,
				test: {
					name: 'components-webkit',
					include: ['src/tests/LabelCentering.svelte.test.ts'],
					setupFiles: ['vitest-browser-svelte'],
					browser: browser(undefined, 'webkit')
				}
			},
			// The OS reduced-motion query, on and off, for the motion setting.
			...(['reduce', 'no-preference'] as const).map((reducedMotion) => ({
				extends: true as const,
				test: {
					name: `motion-os-${reducedMotion}`,
					include: ['src/tests/motion-query.svelte.test.ts'],
					setupFiles: ['vitest-browser-svelte'],
					browser: browser(reducedMotion)
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
