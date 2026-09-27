import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
	const token = loadEnv(mode, process.cwd(), '').PAU_API_TOKEN;
	const headers = token === undefined ? undefined : { Authorization: `Bearer ${token}` };

	return {
		plugins: [sveltekit()],
		server: { proxy: { '/api': { target: 'http://127.0.0.1:3001', headers, ws: true } } },
		test: {
			projects: [
				{ extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'], exclude: ['src/**/*.svelte.test.ts'] } },
				{
					extends: true,
					test: {
						name: 'browser',
						include: ['src/**/*.svelte.test.ts'],
						setupFiles: ['vitest-browser-svelte'],
						browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: 'chromium' }] }
					}
				}
			]
		}
	};
});
