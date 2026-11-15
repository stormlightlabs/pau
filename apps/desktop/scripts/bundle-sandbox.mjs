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
//
// Last, check-sandbox-bundle.mjs imports the extension from the stage, so a
// stage missing a runtime dependency fails the build.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdtempSync, openSync, readdirSync, readSync, rmSync, writeFileSync } from 'node:fs';
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
 * How long one codesign call may run. `--timestamp` waits on Apple's
 * timestamp server, which can stop answering.
 */
const codesignTimeout = 120_000;

/** The codesign calls in flight, which a signal handler stops. */
const signing = new Set();

/** Run codesign, rejecting when it fails or outlives `codesignTimeout`. */
function codesign(args) {
	return new Promise((resolve, reject) => {
		const child = spawn('codesign', args, { stdio: 'inherit', timeout: codesignTimeout, killSignal: 'SIGKILL' });
		signing.add(child);
		child.on('error', reject);
		child.on('exit', (status, signal) => {
			signing.delete(child);
			if (status === 0) resolve();
			else reject(new Error(`codesign ${args.at(-1)} ${signal ? `was stopped by ${signal}` : 'failed'}`));
		});
	});
}

/** The user's keychain search list, as `security list-keychains` prints it. */
function searchList() {
	const result = spawnSync('security', ['list-keychains', '-d', 'user'], { encoding: 'utf8' });
	if (result.status !== 0) throw new Error('security list-keychains failed');
	return result.stdout
		.split('\n')
		.map((line) => line.trim().replace(/^"(.*)"$/, '$1'))
		.filter(Boolean);
}

function setSearchList(keychains) {
	run('security', ['list-keychains', '-d', 'user', '-s', ...keychains]);
}

/**
 * Sign `files` with `identity`. When APPLE_CERTIFICATE holds a base64 .p12
 * export, the identity comes from it, as it does for Tauri. Tauri imports that
 * certificate only when it signs the app, after this script has run, so the
 * script imports it into a keychain of its own.
 *
 * That keychain is unlocked and holds the private key, so it must not outlive
 * the script. The .p12 is deleted as soon as it is imported. The keychain is
 * deleted, and the user's search list restored, when signing ends, when the
 * process exits, and on SIGINT or SIGTERM. A failed deletion fails the build.
 */
async function sign(files, identity) {
	const signArgs = ['--force', '--timestamp', '--options', 'runtime', '--sign', identity];
	const certificate = process.env.APPLE_CERTIFICATE;
	if (!certificate) {
		for (const file of files) await codesign([...signArgs, file]);
		return;
	}
	const directory = mkdtempSync(path.join(tmpdir(), 'pau-signing-'));
	const keychain = path.join(directory, 'signing.keychain-db');
	const p12 = path.join(directory, 'certificate.p12');
	const password = randomBytes(24).toString('hex');
	const userKeychains = searchList();

	let cleaned = false;
	const cleanup = () => {
		if (cleaned) return;
		cleaned = true;
		for (const child of signing) child.kill('SIGKILL');
		const failures = [];
		if (existsSync(keychain)) {
			const deleted = spawnSync('security', ['delete-keychain', keychain], { stdio: 'inherit' });
			if (deleted.status !== 0) failures.push(`security delete-keychain ${keychain} failed.`);
		}
		try {
			if (searchList().join('\n') !== userKeychains.join('\n')) setSearchList(userKeychains);
		} catch {
			failures.push(`the keychain search list could not be restored to ${userKeychains.join(', ')}.`);
		}
		rmSync(directory, { recursive: true, force: true });
		if (failures.length > 0) throw new Error(failures.join(' '));
	};
	const onExit = () => {
		try {
			cleanup();
		} catch (error) {
			console.error(`bundle-sandbox: ${error.message}`);
			process.exitCode = 1;
		}
	};
	const removeHandlers = () => {
		process.off('SIGINT', onSignal);
		process.off('SIGTERM', onSignal);
		process.off('exit', onExit);
	};
	// Cleans up, then raises the signal again so the process ends the way it
	// would have without a handler.
	function onSignal(signal) {
		removeHandlers();
		onExit();
		process.kill(process.pid, signal);
	}
	process.on('exit', onExit);
	process.on('SIGINT', onSignal);
	process.on('SIGTERM', onSignal);
	try {
		writeFileSync(p12, Buffer.from(certificate, 'base64'), { mode: 0o600 });
		run('security', ['create-keychain', '-p', password, keychain], { secret: true });
		run('security', ['unlock-keychain', '-p', password, keychain], { secret: true });
		try {
			run(
				'security',
				['import', p12, '-k', keychain, '-P', process.env.APPLE_CERTIFICATE_PASSWORD ?? '', '-T', '/usr/bin/codesign'],
				{ secret: true }
			);
		} finally {
			rmSync(p12, { force: true });
		}
		// Lets codesign use the key without a keychain access prompt.
		run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain], {
			stdio: ['inherit', 'ignore', 'inherit'],
			secret: true
		});
		// codesign finds no identity in a keychain outside the search list, even
		// when --keychain names it.
		setSearchList([...userKeychains, keychain]);
		for (const file of files) await codesign([...signArgs, '--keychain', keychain, file]);
	} finally {
		removeHandlers();
		cleanup();
	}
}

const identity = process.env.APPLE_SIGNING_IDENTITY;
if (identity) await sign(code, identity);

// Pi imports the extension from the installed app, which has no checkout to
// fall back on, so a missing or pruned runtime file fails the build here.
const nodeEnv = { ...process.env };
delete nodeEnv.NODE_PATH;
delete nodeEnv.NODE_OPTIONS;
const check = spawnSync(process.execPath, [fileURLToPath(new URL('check-sandbox-bundle.mjs', import.meta.url))], {
	cwd: stage,
	env: nodeEnv,
	encoding: 'utf8',
	stdio: ['ignore', 'inherit', 'pipe']
});
if (check.status !== 0) throw new Error(`the staged sandbox extension does not load. ${check.stderr.trim()}`);
console.log(`Staged the sandbox extension at ${stage} with ${code.length} Mach-O files${identity ? ', signed' : ''}.`);
