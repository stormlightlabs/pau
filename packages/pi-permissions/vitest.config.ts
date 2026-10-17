import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const local = (file: string): string => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
	resolve: {
		// Keep in step with `paths` in tsconfig.json. The vendored files import
		// through `#src/*` and `#test/*`. Their imports of the Zod-inferred config
		// types are type-only and erased at runtime; tsc resolves them to
		// src/vendor-types through `paths` and `rootDirs`.
		alias: [
			{ find: /^#src\/(.*)$/, replacement: local('src/vendor/pi-permission-system/src/$1') },
			{ find: /^#test\/(.*)$/, replacement: local('src/vendor/pi-permission-system/test/$1') }
		]
	},
	test: { include: ['test/**/*.test.ts', 'src/vendor/pi-permission-system/test/**/*.test.ts'] }
});
