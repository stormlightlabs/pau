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
import { randomBytes } from 'node:crypto';
import { closeSync, mkdtempSync, openSync, readdirSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const stage = path.join(root, 'target/sandbox-bundle');

/** Files in the deployed package that the extension never loads. */
const devOnly = ['native', 'tsconfig.json', 'README.md', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'];

/**
 * Paths under node_modules that the extension never loads on macOS. esbuild
 * serves only the facet bundler in `@earendil-works/chord`, which nothing
 * imports. The rest are Linux and Windows binaries. The pi-tui prebuilds for
 * both Mac architectures stay.
 */
const unusedPackagePaths = [
	'esbuild',
	'@esbuild',
	'@anthropic-ai/sandbox-runtime/vendor/seccomp',
	'@anthropic-ai/sandbox-runtime/vendor/srt-win',
	'@earendil-works/pi-tui/native/linux',
	'@earendil-works/pi-tui/native/win32'
];

/**
 * Run a command and throw when it fails. `secret` keeps the arguments, which
 * may hold passwords, out of the error.
 */
function run(command, args, { secret = false, ...options } = {}) {
	const result = spawnSync(command, args, { stdio: 'inherit', ...options });
	if (result.status !== 0) throw new Error(`${command} ${secret ? args[0] : args.join(' ')} failed`);
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
for (const name of unusedPackagePaths) rmSync(path.join(modules, name), { recursive: true, force: true });
// Packages link command shims into their own .bin directories. The extension
// runs none of them. Packages load their compiled JavaScript, so TypeScript
// sources, type declarations and source maps are never read.
const staged = walk(modules);
for (const { file, entry } of staged) {
	if (entry.isDirectory() && entry.name === '.bin') rmSync(file, { recursive: true, force: true });
	if (entry.isFile() && /\.([cm]?ts|map)$/.test(entry.name)) rmSync(file, { force: true });
}

const code = [];
const bundled = walk(stage);
for (const { file, entry } of bundled) {
	if (entry.isSymbolicLink()) throw new Error(`${file} is a link. The sandbox bundle must not point outside itself.`);
	if (entry.isFile() && isMachO(file)) code.push(file);
}

/**
 * Sign `files` with `identity`. When APPLE_CERTIFICATE holds a base64 .p12
 * export, the identity comes from it, as it does for Tauri. Tauri imports that
 * certificate only when it signs the app, after this script has run, so the
 * script imports it into a keychain of its own and deletes the keychain after.
 */
function sign(files, identity) {
	const signArgs = ['--force', '--timestamp', '--options', 'runtime', '--sign', identity];
	const certificate = process.env.APPLE_CERTIFICATE;
	if (!certificate) {
		for (const file of files) run('codesign', [...signArgs, file]);
		return;
	}
	const directory = mkdtempSync(path.join(tmpdir(), 'pau-signing-'));
	const keychain = path.join(directory, 'signing.keychain-db');
	const p12 = path.join(directory, 'certificate.p12');
	const password = randomBytes(24).toString('hex');
	try {
		writeFileSync(p12, Buffer.from(certificate, 'base64'), { mode: 0o600 });
		run('security', ['create-keychain', '-p', password, keychain], { secret: true });
		run('security', ['unlock-keychain', '-p', password, keychain], { secret: true });
		run(
			'security',
			['import', p12, '-k', keychain, '-P', process.env.APPLE_CERTIFICATE_PASSWORD ?? '', '-T', '/usr/bin/codesign'],
			{ secret: true }
		);
		// Lets codesign use the key without a keychain access prompt.
		run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain], {
			stdio: ['inherit', 'ignore', 'inherit'],
			secret: true
		});
		for (const file of files) run('codesign', [...signArgs, '--keychain', keychain, file]);
	} finally {
		// create-keychain adds the keychain to the search list, and deleting it
		// removes it again.
		spawnSync('security', ['delete-keychain', keychain], { stdio: 'inherit' });
		rmSync(directory, { recursive: true, force: true });
	}
}

const identity = process.env.APPLE_SIGNING_IDENTITY;
if (identity) sign(code, identity);
console.log(`Staged the sandbox extension at ${stage} with ${code.length} Mach-O files${identity ? ', signed' : ''}.`);
