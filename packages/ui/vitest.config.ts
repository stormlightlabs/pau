import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const browser = () => ({
	enabled: true,
	headless: true,
	provider: playwright(),
	instances: [{ browser: 'chromium' as const }]
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
					setupFiles: ['vitest-browser-svelte'],
					browser: browser()
				}
			},
			{
				extends: true,
				plugins: [storybookTest({ configDir: path.join(dirname, '.storybook') })],
				test: { name: 'storybook', browser: browser() }
			}
		]
	}
});
