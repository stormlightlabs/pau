// Runs the Tauri CLI with the bundle identity that matches the build channel.
//
// Release builds use tauri.conf.json. Everything else, including `tauri dev`,
// layers tauri.dev.conf.json on top so it never shares an identifier or data
// directory with an installed release. The Rust build script applies the same
// rule to the compiled version, so the two agree: PAU_BUILD_CHANNEL forces a
// channel, otherwise HEAD must be exactly at the tag v<workspace version>.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [command, ...args] = process.argv.slice(2);
const root = new URL('../../../', import.meta.url);

// Development settings live in the repository's .env file. Variables already
// set in the environment win.
try {
	process.loadEnvFile(new URL('.env', root));
} catch (error) {
	if (error.code !== 'ENOENT') throw error;
}

function git(...gitArgs) {
	try {
		return execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch {
		return '';
	}
}

function isRelease() {
	if (command === 'dev') return false;
	if (process.env.PAU_BUILD_CHANNEL) return process.env.PAU_BUILD_CHANNEL === 'release';
	const version = /^version = "([^"]+)"/m.exec(readFileSync(new URL('Cargo.toml', root), 'utf8'))?.[1];
	return git('describe', '--exact-match', '--tags', '--match', 'v*') === `v${version}`;
}

const release = isRelease();
const tauriArgs = [command, ...(release ? [] : ['--config', 'src-tauri/tauri.dev.conf.json']), ...args];
const result = spawnSync('tauri', tauriArgs, {
	stdio: 'inherit',
	shell: process.platform === 'win32',
	env: { ...process.env, PAU_BUILD_CHANNEL: release ? 'release' : 'dev' }
});
process.exitCode = result.status ?? 1;
