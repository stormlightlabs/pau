#!/usr/bin/env node
/**
 * Boundary matrix for the pinned sandbox-runtime release. Each case runs a
 * fixture process inside a Pau profile and compares the observed result with
 * the expected policy. Run it on Linux and macOS; it exits non-zero on any
 * mismatch.
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import type { SandboxSettings } from '@stormlightlabs/pau-protocol';
import { createFixture, sandboxSettings, SECRET } from './fixture.ts';
import {
	runSandboxed,
	SandboxUnavailableError,
	spawnSandboxed,
	startSandbox,
	updateNetwork,
	type SandboxSpawnOptions
} from './launcher.ts';
import { readPolicyFile, resolvePolicy, type SandboxPolicy } from './policy.ts';

type Outcome = 'allow' | 'deny';

type Case = {
	name: string;
	command: string;
	expect: Outcome;
	/** Extra assertion on the output of an allowed command. */
	verify?: (stdout: string) => boolean;
};

type Group = { label: string; settings: SandboxSettings; cases: Case[] };

const fixture = createFixture();
const { workspace, home, outside, tempDir, session } = fixture;
// sandbox-runtime protects its own list of dangerous files in the current
// directory. Pau starts Pi in the workspace, so the fixtures run there too.
process.chdir(workspace);
const probe = `${process.execPath} ${fileURLToPath(new URL('probe.ts', import.meta.url))}`;
const failures: string[] = [];

/** Resolve a policy with Pau's Rust resolver, as the desktop app does. */
function policyFor(settings: SandboxSettings, env: NodeJS.ProcessEnv = process.env): SandboxPolicy {
	const resolved = resolvePolicy(
		{ adapter: 'pi', settings, workspace, home, sessionDirectory: session, toolPath: process.env.PATH ?? '' },
		env
	);
	return readPolicyFile(resolved.policyFile);
}

function spawnOptions(policy: SandboxPolicy, commandId: string): SandboxSpawnOptions {
	return { env: policy.environment, cwd: workspace, commandId, noProxy: policy.noProxy };
}

// Seed provider credentials in the host process. The launcher must not forward them.
process.env.ANTHROPIC_API_KEY = SECRET;
process.env.PAU_SEEDED_TOKEN = SECRET;

function report(ok: boolean, label: string, detail: string): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
	if (!ok) failures.push(label);
}

function listen(server: net.Server, target: number | string): Promise<number> {
	return new Promise((resolve) =>
		server.listen(target, () => {
			const address = server.address();
			resolve(typeof address === 'object' && address ? address.port : 0);
		})
	);
}

const web = http.createServer((_request, response) => response.end('host-ok'));
const port = await listen(web, 0);
const secondWeb = http.createServer((_request, response) => response.end('host-ok'));
const secondPort = await listen(secondWeb, 0);
// Grants must name a domain with a dot, so a single-label machine name is
// checked only when the machine name is fully qualified.
const hostName = os.hostname().includes('.') ? os.hostname() : undefined;
const socketPath = path.join(outside, 'host.sock');
const unixServer = net.createServer((socket) => socket.end());
await listen(unixServer, socketPath);

const curl = (url: string): string => `curl -fsS --max-time 3 ${url}`;
// sandbox-runtime puts loopback in NO_PROXY, so ordinary clients skip the proxy
// for loopback and fail without a network namespace. Force the proxy to test
// its policy.
const proxied = (url: string): string => `curl -fsS --max-time 3 --noproxy '' ${url}`;
const ws = (entry: string): string => path.join(workspace, entry);

const groups: Group[] = [
	{
		label: 'workspace-write',
		settings: sandboxSettings('workspace-write'),
		cases: [
			{ name: 'read workspace file', command: `${probe} read ${ws('README.md')}`, expect: 'allow' },
			{ name: 'write workspace file', command: `${probe} write ${ws('new.txt')}`, expect: 'allow' },
			{ name: 'write dedicated temp', command: `${probe} write ${path.join(tempDir, 'scratch')}`, expect: 'allow' },
			{
				name: 'TMPDIR is the session directory',
				command: 'printenv TMPDIR',
				expect: 'allow',
				verify: (stdout) => stdout.trim() === tempDir
			},
			{ name: 'write outside workspace', command: `${probe} write ${path.join(outside, 'x')}`, expect: 'deny' },
			{ name: 'write home', command: `${probe} write ${path.join(home, 'x')}`, expect: 'deny' },
			{
				name: 'write runtime npm log directory',
				command: `${probe} write ${path.join(home, '.npm/_logs/x')}`,
				expect: 'deny'
			},
			{
				// sandbox-runtime binds this shared directory writable whenever it
				// exists on the host. Pau denies it unless the operator shares it.
				name: 'write shared /tmp/claude',
				command: `${probe} write /tmp/claude/pau-probe`,
				expect: 'deny'
			},
			{ name: 'core dumps are disabled', command: 'ulimit -c', expect: 'allow', verify: (out) => out.trim() === '0' },
			{
				name: 'Zed project settings are protected',
				command: `${probe} write ${ws('.zed/settings.json')}`,
				expect: 'deny'
			},
			{
				name: 'known gap: read outside workspace',
				command: `${probe} read ${path.join(outside, 'notes.txt')}`,
				expect: 'allow'
			},
			...['.ssh/id_ed25519', '.aws/credentials', '.pi/agent/auth.json', '.claude/.credentials.json'].map(
				(file): Case => ({
					name: `read credential ~/${file}`,
					command: `${probe} read ${path.join(home, file)}`,
					expect: 'deny'
				})
			),
			{ name: 'read workspace .env', command: `${probe} read ${ws('.env')}`, expect: 'deny' },
			{ name: 'read .env.example', command: `${probe} read ${ws('.env.example')}`, expect: 'allow' },
			{ name: 'write existing git hook', command: `${probe} write ${ws('.git/hooks/pre-commit')}`, expect: 'deny' },
			{ name: 'create git hook', command: `${probe} write ${ws('.git/hooks/post-checkout')}`, expect: 'deny' },
			{ name: 'write .git/config', command: `${probe} write ${ws('.git/config')}`, expect: 'deny' },
			{ name: 'write Pi project settings', command: `${probe} write ${ws('.pi/settings.json')}`, expect: 'deny' },
			{
				name: 'create Claude project settings',
				command: `mkdir -p ${ws('.claude')}; ${probe} write ${ws('.claude/settings.json')}`,
				expect: 'deny'
			},
			{ name: 'create .mcp.json', command: `${probe} write ${ws('.mcp.json')}`, expect: 'deny' },
			{ name: 'write AGENTS.md', command: `${probe} write ${ws('AGENTS.md')}`, expect: 'allow' },
			{ name: 'read credential through host symlink', command: `${probe} read ${ws('key-link')}`, expect: 'deny' },
			{ name: 'write outside through host symlink', command: `${probe} write ${ws('outside-link')}`, expect: 'deny' },
			{
				name: 'write outside through sandbox-created symlink',
				command: `${probe} symlink-write ${ws('escape-link')} ${path.join(outside, 'escaped.txt')}`,
				expect: 'deny'
			},
			{ name: 'HTTP through proxy with network off', command: proxied(`http://127.0.0.1:${port}/`), expect: 'deny' },
			{ name: 'HTTPS to public host', command: curl('https://example.com/'), expect: 'deny' },
			{ name: 'direct TCP to host', command: `${probe} tcp 127.0.0.1 ${port}`, expect: 'deny' },
			{ name: 'host Unix socket', command: `${probe} unix ${socketPath}`, expect: 'deny' },
			{ name: 'seeded host variable', command: `${probe} env PAU_SEEDED_TOKEN`, expect: 'deny' },
			{ name: 'provider key variable', command: `${probe} env ANTHROPIC_API_KEY`, expect: 'deny' },
			{ name: 'child writes workspace', command: `${probe} child-write ${ws('child.txt')}`, expect: 'allow' },
			{
				name: 'child writes outside',
				command: `${probe} child-write ${path.join(outside, 'child.txt')}`,
				expect: 'deny'
			},
			{ name: 'grandchild HTTP', command: `sh -c 'sh -c "${curl(`http://127.0.0.1:${port}/`)}"'`, expect: 'deny' }
		]
	},
	{
		label: 'read-only',
		settings: sandboxSettings('read-only'),
		cases: [
			{ name: 'read workspace file', command: `${probe} read ${ws('README.md')}`, expect: 'allow' },
			{ name: 'write workspace file', command: `${probe} write ${ws('ro.txt')}`, expect: 'deny' },
			{ name: 'write dedicated temp', command: `${probe} write ${path.join(tempDir, 'ro')}`, expect: 'allow' },
			{ name: 'read credential', command: `${probe} read ${path.join(home, '.ssh/id_ed25519')}`, expect: 'deny' }
		]
	},
	{
		label: 'workspace-write with explicit grants',
		settings: sandboxSettings('workspace-write', {
			grants: {
				domains: [`127.0.0.1:${port}`, `localhost:${secondPort}`, ...(hostName ? [`${hostName}:${secondPort}`] : [])],
				unix_sockets: true,
				writable_roots: [path.join(outside, 'granted')]
			}
		}),
		cases: [
			{
				name: 'HTTP to granted address literal',
				command: proxied(`http://127.0.0.1:${port}/`),
				expect: 'allow',
				verify: (stdout) => stdout === 'host-ok'
			},
			{ name: 'explicit localhost grant', command: proxied(`http://localhost:${secondPort}/`), expect: 'allow' },
			...(hostName
				? [
						{
							// The machine name resolves to one of its own addresses, which the
							// resolved-address guard refuses even though the name is granted.
							name: 'granted name resolving to this host',
							command: proxied(`http://${hostName}:${secondPort}/`),
							expect: 'deny' as const
						}
					]
				: []),
			{
				// Pau removes granted local addresses from the runtime's NO_PROXY,
				// so ordinary clients reach them through the proxy.
				name: 'loopback grant for a client that honors NO_PROXY',
				command: curl(`http://127.0.0.1:${port}/`),
				expect: 'allow'
			},
			{
				name: 'ungranted loopback port stays blocked',
				command: curl(`http://127.0.0.1:${secondPort}/`),
				expect: 'deny'
			},
			{ name: 'direct TCP bypassing proxy', command: `${probe} tcp 127.0.0.1 ${port}`, expect: 'deny' },
			{ name: 'granted Unix sockets', command: `${probe} unix ${socketPath}`, expect: 'allow' },
			{ name: 'write granted root', command: `${probe} write ${path.join(outside, 'granted/x')}`, expect: 'allow' },
			{
				name: 'credential stays denied',
				command: `${probe} read ${path.join(home, '.ssh/id_ed25519')}`,
				expect: 'deny'
			}
		]
	},
	{
		label: 'home read-deny',
		settings: sandboxSettings('workspace-write', { home_read_deny: true }),
		cases: [
			{ name: 'read home file', command: `${probe} read ${path.join(home, 'notes.txt')}`, expect: 'deny' },
			{ name: 'read workspace file', command: `${probe} read ${ws('README.md')}`, expect: 'allow' },
			{ name: 'write dedicated temp', command: `${probe} write ${path.join(tempDir, 'home-deny')}`, expect: 'allow' }
		]
	},
	{
		label: 'shared Claude temp',
		settings: sandboxSettings('workspace-write', { share_claude_temp: true }),
		cases: [
			{
				name: 'write /tmp/claude when the operator shares it',
				command: `${probe} write /tmp/claude/pau-probe`,
				expect: existsSync('/tmp/claude') ? 'allow' : 'deny'
			}
		]
	}
];

async function runGroup(group: Group): Promise<void> {
	const policy = policyFor(group.settings);
	await startSandbox(policy.runtimeConfig, policy.environment, workspace);
	for (const [index, testCase] of group.cases.entries()) {
		const commandId = `${group.label}-${index}`;
		const result = await runSandboxed(testCase.command, spawnOptions(policy, commandId));
		const observed: Outcome = result.code === 0 ? 'allow' : 'deny';
		const leaked = `${result.stdout}${result.stderr}`.includes(SECRET);
		const verified = observed === 'deny' || !testCase.verify || testCase.verify(result.stdout);
		const violations = SandboxManager.getSandboxViolationStore().getViolationsForCommand(commandId);
		const detail = [
			observed === testCase.expect ? '' : `observed ${observed}`,
			leaked ? 'secret in output' : '',
			verified ? '' : `unexpected output ${JSON.stringify(result.stdout.slice(0, 80))}`,
			violations.length > 0 ? `${violations.length} violation event(s)` : ''
		]
			.filter(Boolean)
			.join(', ');
		report(observed === testCase.expect && !leaked && verified, `${group.label}: ${testCase.name}`, detail);
	}
	SandboxManager.cleanupAfterCommand();
	await SandboxManager.reset();
}

function growth(file: string): Promise<boolean> {
	const size = (): number => (existsSync(file) ? statSync(file).size : 0);
	const before = size();
	return new Promise((resolve) => setTimeout(() => resolve(size() > before), 600));
}

const workspaceWrite = (): SandboxPolicy => policyFor(sandboxSettings('workspace-write'));

/**
 * Descendants must stop with the command, including after the launcher is
 * killed without a chance to clean up. The placeholders that Bubblewrap
 * creates for absent protected paths must match Pau's prediction, because
 * Pau hides and cleans up only the paths it recorded.
 */
async function checkCleanup(): Promise<void> {
	const before = new Set(readdirSync(workspace));
	const resolved = resolvePolicy({
		adapter: 'pi',
		settings: sandboxSettings('workspace-write'),
		workspace,
		home,
		sessionDirectory: session,
		toolPath: process.env.PATH ?? ''
	});
	const policy = readPolicyFile(resolved.policyFile);
	await startSandbox(policy.runtimeConfig, policy.environment, workspace);
	const exited = ws('heartbeat-exit');
	await runSandboxed(`${probe} heartbeat ${exited}`, spawnOptions(policy, 'heartbeat-exit'));
	await new Promise((resolve) => setTimeout(resolve, 200));
	report(!(await growth(exited)), 'cleanup: detached descendant stops when command exits', '');

	const killed = ws('heartbeat-kill');
	const child = await spawnSandboxed(`${probe} heartbeat ${killed}; sleep 30`, spawnOptions(policy, 'heartbeat-kill'));
	await new Promise((resolve) => setTimeout(resolve, 1000));
	child.kill('SIGKILL');
	await new Promise((resolve) => setTimeout(resolve, 300));
	report(!(await growth(killed)), 'cleanup: descendants stop after launcher SIGKILL', '');

	const created = new Set(
		[...readdirSync(workspace)].filter((entry) => !before.has(entry) && !entry.startsWith('heartbeat-'))
	);
	const predicted = new Set(
		resolved.placeholders.filter((file) => path.dirname(file) === workspace).map((file) => path.basename(file))
	);
	const unpredicted = [...created.difference(predicted)];
	const missing = [...predicted.difference(created)];
	report(
		unpredicted.length === 0 && missing.length === 0 && predicted.size > 0,
		'cleanup: placeholders match the recorded prediction',
		[
			unpredicted.length > 0 ? `unpredicted ${unpredicted.join(', ')}` : '',
			missing.length > 0 ? `missing ${missing.join(', ')}` : ''
		]
			.filter(Boolean)
			.join('; ')
	);
	const nested = resolved.placeholders.filter((file) => path.dirname(file) !== workspace);
	report(
		nested.every((file) => existsSync(file)),
		'cleanup: nested placeholders match the recorded prediction',
		nested.map((file) => path.relative(workspace, file)).join(', ')
	);
	await SandboxManager.reset();
	const remaining = resolved.placeholders.filter((file) => existsSync(file));
	report(remaining.length === 0, 'cleanup: reset removes placeholders', remaining.join(', '));
}

/**
 * Network grants apply to a running session: the host-side proxy reads the
 * updated allowlist, so a command that is already running sees the change.
 */
async function checkNetworkUpdate(): Promise<void> {
	const denied = workspaceWrite();
	await startSandbox(denied.runtimeConfig, denied.environment, workspace);
	const request = `sleep 1.5; ${proxied(`http://127.0.0.1:${port}/`)}`;
	const running = runSandboxed(request, spawnOptions(denied, 'network-update'));
	await new Promise((resolve) => setTimeout(resolve, 300));
	const granted = policyFor(
		sandboxSettings('workspace-write', {
			grants: { domains: [`127.0.0.1:${port}`], writable_roots: [], unix_sockets: false }
		})
	);
	updateNetwork(granted.runtimeConfig);
	const result = await running;
	report(
		result.code === 0 && result.stdout === 'host-ok',
		'network: grant reaches a running command',
		result.stderr.trim().slice(0, 100)
	);
	updateNetwork(denied.runtimeConfig);
	const revoked = await runSandboxed(proxied(`http://127.0.0.1:${port}/`), spawnOptions(denied, 'network-revoked'));
	report(revoked.code !== 0, 'network: revoking the grant applies to the next command', '');
	await SandboxManager.reset();
}

/** Resolution must fail when an executable is missing or unusable. */
function expectResolverRefuses(label: string, searchPath: string): void {
	try {
		policyFor(sandboxSettings('workspace-write'), { ...process.env, PATH: searchPath });
		report(false, label, 'policy resolved');
	} catch (error) {
		report(true, label, String(error).slice(0, 120));
	}
}

/** Startup must fail closed when the sandbox cannot run. */
async function expectUnavailable(label: string, policy: SandboxPolicy): Promise<void> {
	try {
		await startSandbox(policy.runtimeConfig, policy.environment, workspace);
		report(false, label, 'sandbox started');
		await SandboxManager.reset();
	} catch (error) {
		const ok = error instanceof SandboxUnavailableError;
		report(ok, label, ok ? error.reasons.join('; ').slice(0, 120) : String(error));
	}
}

function which(name: string): string {
	return spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
}

/** Pinned executables, dependency failures, and kernel restrictions. */
async function checkStartupFailures(): Promise<void> {
	if (process.platform !== 'linux') return;
	const socat = which('socat');
	const rg = which('rg');
	const withoutBwrap = `${path.dirname(socat)}:${path.dirname(rg)}:/usr/bin:/bin`;
	expectResolverRefuses('startup: missing bubblewrap', withoutBwrap);

	// A directory added to PATH after Pau starts must not replace Bubblewrap or
	// socat: the resolved policy names absolute executables.
	const pinned = workspaceWrite();
	const original = process.env.PATH;
	const hijack = path.join(fixture.root, 'hijack');
	mkdirSync(hijack);
	for (const name of ['bwrap', 'socat']) {
		writeFileSync(path.join(hijack, name), `#!/bin/sh\necho hijacked ${name} >&2\nexit 1\n`);
		chmodSync(path.join(hijack, name), 0o755);
	}
	const hijackedPath = `${hijack}:${original ?? ''}`;
	process.env.PATH = hijackedPath;
	try {
		await startSandbox(pinned.runtimeConfig, { ...pinned.environment, PATH: hijackedPath }, workspace);
		const result = await runSandboxed('true', {
			...spawnOptions(pinned, 'pinned'),
			env: { ...pinned.environment, PATH: hijackedPath }
		});
		report(
			result.code === 0,
			'startup: pinned executables ignore later PATH entries',
			result.stderr.trim().slice(0, 100)
		);
		await SandboxManager.reset();
	} catch (error) {
		report(false, 'startup: pinned executables ignore later PATH entries', String(error).slice(0, 120));
	} finally {
		process.env.PATH = original;
	}

	// Ubuntu 24.04 AppArmor lets bwrap exist and report its version but denies
	// capability-bearing user namespaces. Neither Pau's resolver nor
	// sandbox-runtime's dependency check can see that failure.
	const bin = path.join(fixture.root, 'bin');
	mkdirSync(bin);
	const bwrap = path.join(bin, 'bwrap');
	writeFileSync(
		bwrap,
		'#!/bin/sh\n[ "$1" = --version ] && { echo "bubblewrap 0.12.0"; exit 0; }\necho "bwrap: setting up uid map: Permission denied" >&2\nexit 1\n'
	);
	chmodSync(bwrap, 0o755);
	const restricted = policyFor(sandboxSettings('workspace-write'), {
		...process.env,
		PATH: `${bin}:${original ?? ''}`
	});
	report(restricted.runtimeConfig.bwrapPath === bwrap, 'startup: resolver pins the bwrap found first on PATH', '');
	await expectUnavailable('startup: restricted user namespaces', restricted);
}

/**
 * Operator terminals need a PTY. sandbox-runtime starts Bubblewrap with
 * `--new-session`, so this records what an interactive shell and a terminal
 * editor can do inside the terminal profile.
 */
async function checkTerminalProfile(): Promise<void> {
	const policy = workspaceWrite();
	const env = policy.environment;
	await startSandbox(policy.runtimeConfig, env, workspace);
	const wrapped = await SandboxManager.wrapWithSandbox(
		`export TMPDIR=${tempDir}; bash -i -c 'tty; echo job-control=$(set -o | grep monitor)' 2>&1`,
		undefined,
		undefined,
		undefined,
		{ commandId: 'terminal' }
	);
	const scriptArgs =
		process.platform === 'darwin' ? ['-q', '/dev/null', '/bin/sh', '-c', wrapped] : ['-qec', wrapped, '/dev/null'];
	const terminal = spawn('script', scriptArgs, {
		env: { ...env, SHELL: '/bin/sh' },
		cwd: workspace,
		stdio: ['pipe', 'pipe', 'pipe']
	});
	let output = '';
	terminal.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
	const code = await new Promise((resolve) => terminal.once('close', resolve));
	const lines = output.replaceAll('\r', '').trim().split('\n');
	report(code === 0 && lines.some((line) => line.startsWith('/dev/')), 'terminal: shell runs on a PTY', '');
	console.log(`INFO  terminal output: ${lines.join(' | ').slice(0, 300)}`);

	const nvim = spawnSync('sh', ['-c', 'command -v nvim'], { encoding: 'utf8' }).stdout.trim();
	if (nvim) {
		const write = (file: string): string => `${nvim} --clean --headless +"call writefile(['x'], '${file}')" +qa`;
		const inside = await runSandboxed(
			`${write(ws('nvim.txt'))} && test -f ${ws('nvim.txt')}`,
			spawnOptions(policy, 'nvim-inside')
		);
		const outsideFile = path.join(outside, 'nvim.txt');
		await runSandboxed(write(outsideFile), spawnOptions(policy, 'nvim-outside'));
		report(inside.code === 0 && !existsSync(outsideFile), 'terminal editor: Neovim writes workspace only', '');
	}
	await SandboxManager.reset();
}

try {
	for (const group of groups) await runGroup(group);
	await checkCleanup();
	await checkNetworkUpdate();
	await checkTerminalProfile();
	await checkStartupFailures();
	const summary = readFileSync(ws('README.md'), 'utf8') === 'workspace readme\n';
	report(summary, 'fixture workspace unchanged by denied writes', '');
} finally {
	web.close();
	secondWeb.close();
	unixServer.close();
}

rmSync(fixture.root, { recursive: true, force: true });
console.log(
	`\n${failures.length === 0 ? 'All checks passed' : `${failures.length} check(s) failed`} on ${process.platform}.`
);
process.exit(failures.length === 0 ? 0 : 1);
