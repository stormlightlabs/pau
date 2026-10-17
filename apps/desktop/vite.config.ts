import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
	// Development settings live in the repository's .env file.
	const root = fileURLToPath(new URL('../../', import.meta.url));
	const token = loadEnv(mode, root, '').PAU_API_TOKEN;
	const headers = token === undefined ? undefined : { Authorization: `Bearer ${token}` };

	return {
		plugins: [sveltekit()],
		server: { proxy: { '/api': { target: 'http://127.0.0.1:3001', headers, ws: true } } },
		test: {
			projects: [
				{
					extends: true,
					test: {
						name: 'unit',
						include: ['src/**/*.test.ts'],
						exclude: ['src/**/*.svelte.test.ts', 'src/**/*.integration.test.ts']
					}
				},
				{
					extends: true,
					test: {
						name: 'browser',
						include: ['src/**/*.svelte.test.ts'],
						setupFiles: ['vitest-browser-svelte'],
						browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: 'chromium' }] }
					}
				},
				{
					extends: true,
					test: {
						name: 'integration',
						include: ['src/**/*.integration.test.ts'],
						globalSetup: ['scripts/loopback-server.ts'],
						setupFiles: ['vitest-browser-svelte'],
						browser: {
							enabled: true,
							headless: true,
							provider: playwright({ contextOptions: { permissions: ['clipboard-read', 'clipboard-write'] } }),
							instances: [{ browser: 'chromium' }]
						}
					}
				}
			]
		}
	};
});
