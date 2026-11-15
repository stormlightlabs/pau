// Stages the sandbox extension that release builds ship in the app's
// resources, at target/sandbox-bundle, which tauri.release.conf.json copies to
// Contents/Resources/sandbox.
//
// The stage holds the package's runtime sources, its package.json and its
// production dependencies, installed flat by `pnpm deploy`, so nothing in it
// points back into this checkout. The server grants sandboxed tools read
// access to this directory alone, so it must not hold links out of it.
//
// When APPLE_SIGNING_IDENTITY is set, every Mach-O file in the stage is signed
// with it and the hardened runtime. Notarization rejects an app that carries
// unsigned code anywhere in its bundle, and Tauri signs only the app itself.
import { spawnSync } from 'node:child_process';
import { closeSync, openSync, readdirSync, readSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const stage = path.join(root, 'target/sandbox-bundle');

/** Files in the deployed package that the extension never loads. */
const devOnly = ['native', 'tsconfig.json', 'README.md', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'];

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { stdio: 'inherit', ...options });
	if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

/** Every entry under `directory`, listed before the caller changes any. */
function walk(directory) {
	return readdirSync(directory, { withFileTypes: true, recursive: true }).map((entry) => ({
		file: path.join(entry.parentPath, entry.name),
		entry
	}));
}

/**
 * Whether `file` starts with a Mach-O header. Java class files share the
 * universal-binary magic, so a universal header must also name a plausible
 * number of architectures.
 */
function isMachO(file) {
	const header = Buffer.alloc(8);
	const descriptor = openSync(file, 'r');
	try {
		if (readSync(descriptor, header, 0, 8, 0) < 8) return false;
	} finally {
		closeSync(descriptor);
	}
	const magic = header.readUInt32BE(0);
	if ([0xfe_ed_fa_ce, 0xfe_ed_fa_cf, 0xce_fa_ed_fe, 0xcf_fa_ed_fe].includes(magic)) return true;
	return magic === 0xca_fe_ba_be && header.readUInt32BE(4) < 32;
}

rmSync(stage, { recursive: true, force: true });
run('pnpm', ['--filter', '@stormlightlabs/pau-sandbox', 'deploy', '--prod', '--config.node-linker=hoisted', stage], {
	cwd: root
});

for (const name of devOnly) rmSync(path.join(stage, name), { recursive: true, force: true });
const sources = walk(path.join(stage, 'src'));
for (const { file, entry } of sources) {
	if (entry.name.endsWith('.test.ts')) rmSync(file);
}
// pnpm keeps its install state, which names this checkout, beside the
// packages.
const modules = path.join(stage, 'node_modules');
const installState = readdirSync(modules).filter((name) => name.startsWith('.'));
for (const name of installState) rmSync(path.join(modules, name), { recursive: true, force: true });
// Packages link command shims into their own .bin directories. The extension
// runs none of them.
const staged = walk(stage);
for (const { file, entry } of staged) {
	if (entry.isDirectory() && entry.name === '.bin') rmSync(file, { recursive: true, force: true });
}

const code = [];
const bundled = walk(stage);
for (const { file, entry } of bundled) {
	if (entry.isSymbolicLink()) throw new Error(`${file} is a link. The sandbox bundle must not point outside itself.`);
	if (entry.isFile() && isMachO(file)) code.push(file);
}

const identity = process.env.APPLE_SIGNING_IDENTITY;
if (identity) {
	for (const file of code) {
		run('codesign', ['--force', '--timestamp', '--options', 'runtime', '--sign', identity, file]);
	}
}
console.log(`Staged the sandbox extension at ${stage} with ${code.length} Mach-O files${identity ? ', signed' : ''}.`);
