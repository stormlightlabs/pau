import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const desktopRoot = fileURLToPath(new URL('../..', import.meta.url));
const webRoot = fileURLToPath(new URL('../../../web', import.meta.url));

async function sourceFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map((entry) => {
			const path = join(directory, entry.name);
			return entry.isDirectory() ? sourceFiles(path) : Promise.resolve([path]);
		})
	);
	return nested.flat();
}

test('builds Tauri from the desktop-owned SvelteKit application', async () => {
	const configuration = JSON.parse(await readFile(join(desktopRoot, 'src-tauri/tauri.conf.json'), 'utf8')) as {
		build: Record<string, string>;
	};

	expect(configuration.build).toMatchObject({
		beforeDevCommand: 'pnpm dev:frontend',
		beforeBuildCommand: 'pnpm build:frontend',
		frontendDist: '../build'
	});
	expect(JSON.stringify(configuration)).not.toContain('../web');
});

test('keeps the remote web scaffold independent from desktop routes and capabilities', async () => {
	const manifest = JSON.parse(await readFile(join(webRoot, 'package.json'), 'utf8')) as {
		dependencies?: Record<string, string>;
	};
	const routes = await sourceFiles(join(webRoot, 'src/routes'));
	const routeContents = await Promise.all(routes.map((path) => readFile(path, 'utf8')));
	const routeSource = routeContents.join('\n');

	expect(manifest.dependencies).toBeUndefined();
	expect(routeSource).not.toMatch(/apps\/desktop|@stormlightlabs\/pau-ui|native-capabilities/);
});
