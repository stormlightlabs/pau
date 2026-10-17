// Builds the Apple Silicon release of Pau from its release tag, then signs,
// notarizes, verifies, and installs it in /Applications.
//
// The signing identity and notarization credentials come only from the
// environment and the login keychain, so none of them live in the repository.
// `--unsigned` builds the same release bundle without Apple credentials and
// copies it to target/release-macos for local checks. It never touches
// /Applications, because Gatekeeper rejects an unsigned app there.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const target = 'aarch64-apple-darwin';
const identifier = 'org.stormlightlabs.pau';
const installPath = '/Applications/Pau.app';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const desktop = fileURLToPath(new URL('../', import.meta.url));

// Signing and notarization credentials may live in the repository's .env file.
// Variables already set in the environment win.
try {
	process.loadEnvFile(path.join(root, '.env'));
} catch (error) {
	if (error.code !== 'ENOENT') throw error;
}
const notarizationCredentials = [
	['APPLE_API_KEY', 'APPLE_API_ISSUER', 'APPLE_API_KEY_PATH'],
	['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID']
];
const appleVariables = ['APPLE_SIGNING_IDENTITY', 'APPLE_CERTIFICATE', ...notarizationCredentials.flat()];

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { stdio: 'inherit', ...options });
	if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

function read(command, args) {
	try {
		return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch {
		return '';
	}
}

function requireReleaseTag(version) {
	if (read('git', ['status', '--porcelain']) !== '') {
		throw new Error('the working tree has uncommitted changes. Commit or remove them before building a release.');
	}
	const tag = read('git', ['describe', '--exact-match', '--tags', '--match', 'v*']);
	if (tag !== `v${version}`) {
		throw new Error(
			`HEAD must be at the tag v${version}, the workspace version in Cargo.toml (found ${tag || 'no tag'}).`
		);
	}
}

function requireCredentials() {
	const env = process.env;
	const missing = [];
	if (!env.APPLE_SIGNING_IDENTITY) missing.push('APPLE_SIGNING_IDENTITY');
	if (notarizationCredentials.every((names) => names.some((name) => (env[name] ?? '') === ''))) {
		missing.push(notarizationCredentials.map((names) => names.join(', ')).join('\n    or '));
	}
	if (missing.length > 0) {
		throw new Error(
			[
				'signing and notarization need these environment variables:',
				...missing.map((entry) => `  ${entry}`),
				'APPLE_SIGNING_IDENTITY is a "Developer ID Application" identity from',
				'`security find-identity -v -p codesigning`. Use --unsigned for a local build without them.'
			].join('\n')
		);
	}
	if (!env.APPLE_SIGNING_IDENTITY.startsWith('Developer ID Application')) {
		throw new Error(
			`Gatekeeper only accepts apps signed with a "Developer ID Application" identity, not "${env.APPLE_SIGNING_IDENTITY}".`
		);
	}
}

function bundleValue(bundle, key) {
	return read('plutil', ['-extract', key, 'raw', path.join(bundle, 'Contents/Info.plist')]);
}

function verifyBundle(bundle, version) {
	const bundleVersion = bundleValue(bundle, 'CFBundleShortVersionString');
	if (bundleVersion !== version)
		throw new Error(`${bundle} reports version ${bundleVersion || 'none'}, not ${version}.`);
	const bundleIdentifier = bundleValue(bundle, 'CFBundleIdentifier');
	if (bundleIdentifier !== identifier) {
		throw new Error(`${bundle} has the bundle identifier ${bundleIdentifier}, not ${identifier}.`);
	}
}

function verifySignature(bundle) {
	run('xcrun', ['stapler', 'validate', bundle]);
	run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle]);
	run('spctl', ['--assess', '--type', 'execute', '-vv', bundle]);
}

// Copies the bundle beside the destination first so a failed copy leaves the
// previous install in place.
function install(bundle, destination) {
	const staging = `${destination}.new`;
	const previous = `${destination}.old`;
	rmSync(staging, { recursive: true, force: true });
	run('ditto', [bundle, staging]);
	rmSync(previous, { recursive: true, force: true });
	if (existsSync(destination)) renameSync(destination, previous);
	renameSync(staging, destination);
	rmSync(previous, { recursive: true, force: true });
}

function main() {
	const args = process.argv.slice(2);
	const unknown = args.filter((argument) => argument !== '--unsigned');
	if (unknown.length > 0) throw new Error(`unknown argument ${unknown[0]}. The only option is --unsigned.`);
	if (process.platform !== 'darwin') throw new Error('macOS releases must be built on macOS.');
	const unsigned = args.includes('--unsigned');

	const version = /^version = "([^"]+)"/m.exec(readFileSync(path.join(root, 'Cargo.toml'), 'utf8'))?.[1];
	if (!version) throw new Error('could not read the workspace version from Cargo.toml.');

	const env = { ...process.env, PAU_BUILD_CHANNEL: 'release' };
	if (unsigned) {
		for (const name of appleVariables) delete env[name];
		console.warn('Building an unsigned release bundle for local checks. It will not be installed in /Applications.');
	} else {
		requireReleaseTag(version);
		requireCredentials();
	}

	run('pnpm', ['exec', 'node', 'scripts/tauri.mjs', 'build', '--target', target, '--bundles', 'app'], {
		cwd: desktop,
		env
	});

	const targetDirectory = process.env.CARGO_TARGET_DIR ?? path.join(root, 'target');
	const bundle = path.join(targetDirectory, target, 'release/bundle/macos/Pau.app');
	verifyBundle(bundle, version);

	let destination = installPath;
	if (unsigned) {
		const directory = path.join(targetDirectory, 'release-macos');
		mkdirSync(directory, { recursive: true });
		destination = path.join(directory, 'Pau.app');
	} else {
		// Tauri staples after notarization. Stapling again is harmless and makes
		// the ticket check explicit.
		run('xcrun', ['stapler', 'staple', bundle]);
		verifySignature(bundle);
	}

	install(bundle, destination);
	if (!unsigned) verifySignature(destination);
	console.log(`Installed Pau ${bundleValue(destination, 'CFBundleShortVersionString')} at ${destination}`);
}

try {
	main();
} catch (error) {
	console.error(`release-macos: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
