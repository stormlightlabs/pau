#!/usr/bin/env node
// Imports the sandbox extension's entry points from a staged bundle, as Pi
// does when the installed app starts a sandboxed session, and exits non-zero
// naming the module that failed to load.
//
// Run it with the stage as the working directory:
//
//   node apps/desktop/scripts/check-sandbox-bundle.mjs
//
// The stage sits inside the checkout, so Node's module resolution would walk
// up from it into the checkout's node_modules. A resolve hook rejects every
// file outside the stage, so a dependency missing from the stage fails here
// instead of in the installed app.
import { realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** The modules Pi loads from the bundle: the extension and its tool host client. */
const entries = ['src/pi-extension.ts', 'src/tool-host-client.ts'];

const stage = realpathSync(process.cwd());
const stageUrl = pathToFileURL(stage + path.sep).href;

registerHooks({
	resolve(specifier, context, nextResolve) {
		const result = nextResolve(specifier, context);
		if (result.url.startsWith('file:') && !result.url.startsWith(stageUrl)) {
			throw new Error(`${specifier} resolves outside the stage, to ${result.url}`);
		}
		return result;
	}
});

for (const entry of entries) {
	try {
		await import(new URL(entry, stageUrl).href);
	} catch (error) {
		console.error(`${entry} does not load from ${stage}: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}
// Loaded modules may hold timers or handles open.
process.exit(0);
