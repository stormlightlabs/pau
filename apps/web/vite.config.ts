import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	const token = loadEnv(mode, process.cwd(), '').PAU_API_TOKEN;
	const headers = token === undefined ? undefined : { Authorization: `Bearer ${token}` };

	return {
		plugins: [sveltekit()],
		server: { proxy: { '/api': { target: 'http://127.0.0.1:3001', headers, ws: true } } }
	};
});
