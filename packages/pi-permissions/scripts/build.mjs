#!/usr/bin/env node
// Bundle the extension and its vendored analysis into dist/pi-extension.js.
// The vendored files use extensionless `#src/*` imports, which esbuild resolves
// through the `paths` in tsconfig.json. Dependencies stay external, so the
// grammar's WebAssembly file is loaded from tree-sitter-bash at run time.
import { build } from 'esbuild';

await build({
	entryPoints: [new URL('../src/pi-extension.ts', import.meta.url).pathname],
	outfile: new URL('../dist/pi-extension.js', import.meta.url).pathname,
	tsconfig: new URL('../tsconfig.json', import.meta.url).pathname,
	bundle: true,
	packages: 'external',
	platform: 'node',
	format: 'esm',
	target: 'node24',
	logLevel: 'warning'
});
