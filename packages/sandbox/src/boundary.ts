#!/usr/bin/env node
/**
 * Boundary matrix for the pinned sandbox-runtime release. Each case runs a
 * fixture process inside a Pau profile and compares the observed result with
 * the expected policy. Run it on Linux and macOS; it exits non-zero on any
 * mismatch.
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SandboxManager, SandboxRuntimeConfigSchema } from '@anthropic-ai/sandbox-runtime';
import { createFixture, SECRET } from './fixture.ts';
import { runSandboxed, SandboxUnavailableError, spawnSandboxed, startSandbox } from './launcher.ts';
import { buildRuntimeConfig, buildToolEnvironment, type SandboxGrants, type SandboxProfileName } from './profile.ts';

type Outcome = 'allow' | 'deny';

type Case = {
	name: string;
	command: string;
	expect: Outcome;
	/** Extra assertion on the output of an allowed command. */
	verify?: (stdout: string) => boolean;
};

type Group = { label: string; profile: SandboxProfileName; grants?: SandboxGrants; cases: Case[] };

const fixture = createFixture();
const { workspace, home, outside, tempDir } = fixture;
const probe = `${process.execPath} ${fileURLToPath(new URL('probe.ts', import.meta.url))}`;
const env = buildToolEnvironment({ home, tempDir, searchPath: process.env.PATH ?? '' });
const failures: string[] = [];

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
const hostName = os.hostname();
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
		profile: 'workspace-write',
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
				// exists on the host.
				name: 'known gap: shared /tmp/claude when present on host',
				command: `${probe} write /tmp/claude/pau-probe`,
				expect: existsSync('/tmp/claude') ? 'allow' : 'deny'
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
		profile: 'read-only',
		cases: [
			{ name: 'read workspace file', command: `${probe} read ${ws('README.md')}`, expect: 'allow' },
			{ name: 'write workspace file', command: `${probe} write ${ws('ro.txt')}`, expect: 'deny' },
			{ name: 'write dedicated temp', command: `${probe} write ${path.join(tempDir, 'ro')}`, expect: 'allow' },
			{ name: 'read credential', command: `${probe} read ${path.join(home, '.ssh/id_ed25519')}`, expect: 'deny' }
		]
	},
	{
		label: 'workspace-write with explicit grants',
		profile: 'workspace-write',
		grants: {
			domains: [`127.0.0.1:${port}`, `localhost:${secondPort}`, `${hostName}:${secondPort}`],
			unixSockets: true,
			writableRoots: [path.join(outside, 'granted')]
		},
		cases: [
			{
				name: 'HTTP to granted address literal',
				command: proxied(`http://127.0.0.1:${port}/`),
				expect: 'allow',
				verify: (stdout) => stdout === 'host-ok'
			},
			{ name: 'explicit localhost grant', command: proxied(`http://localhost:${secondPort}/`), expect: 'allow' },
			{
				// The machine name resolves to one of its own addresses, which the
				// resolved-address guard refuses even though the name is granted.
				name: 'granted name resolving to this host',
				command: proxied(`http://${hostName}:${secondPort}/`),
				expect: 'deny'
			},
			{
				name: 'known gap: loopback grant with runtime NO_PROXY',
				command: curl(`http://127.0.0.1:${port}/`),
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
	}
];

async function runGroup(group: Group): Promise<void> {
	const config = buildRuntimeConfig({ profile: group.profile, workspace, tempDir, home, grants: group.grants });
	await startSandbox(config, env, workspace);
	for (const [index, testCase] of group.cases.entries()) {
		const commandId = `${group.label}-${index}`;
		const result = await runSandboxed(testCase.command, { env, cwd: workspace, commandId });
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

/**
 * Descendants must stop with the command, including after the launcher is
 * killed without a chance to clean up.
 */
async function checkCleanup(): Promise<void> {
	await startSandbox(buildRuntimeConfig({ profile: 'workspace-write', workspace, tempDir, home }), env, workspace);
	const exited = ws('heartbeat-exit');
	await runSandboxed(`${probe} heartbeat ${exited}`, { env, cwd: workspace, commandId: 'heartbeat-exit' });
	await new Promise((resolve) => setTimeout(resolve, 200));
	report(!(await growth(exited)), 'cleanup: detached descendant stops when command exits', '');

	const killed = ws('heartbeat-kill');
	const child = await spawnSandboxed(`${probe} heartbeat ${killed}; sleep 30`, {
		env,
		cwd: workspace,
		commandId: 'heartbeat-kill'
	});
	await new Promise((resolve) => setTimeout(resolve, 1000));
	child.kill('SIGKILL');
	await new Promise((resolve) => setTimeout(resolve, 300));
	report(!(await growth(killed)), 'cleanup: descendants stop after launcher SIGKILL', '');
	// Bubblewrap denies absent protected paths by creating empty mount points
	// on the host. sandbox-runtime removes them in reset(), so a crash of the
	// launcher process itself leaves them behind.
	const mountPoints = ['.mcp.json', '.claude', '.codex', '.vscode', '.idea'];
	const present = mountPoints.filter((entry) => existsSync(ws(entry)));
	console.log(`INFO  deny mount points present before reset: ${present.join(', ') || 'none'}`);
	await SandboxManager.reset();
	const remaining = mountPoints.filter((entry) => existsSync(ws(entry)));
	report(remaining.length === 0, 'cleanup: reset removes deny mount points', remaining.join(', '));
}

/**
 * The wrapped command starts `bwrap` through a `PATH` lookup in the child's
 * environment, so both the host check and the child use the test path.
 */
async function expectUnavailable(label: string, searchPath: string): Promise<void> {
	const original = process.env.PATH;
	process.env.PATH = searchPath;
	try {
		await startSandbox(
			buildRuntimeConfig({ profile: 'workspace-write', workspace, tempDir, home }),
			{ ...env, PATH: searchPath },
			workspace
		);
		report(false, label, 'sandbox started');
		await SandboxManager.reset();
	} catch (error) {
		const ok = error instanceof SandboxUnavailableError;
		report(ok, label, ok ? error.reasons.join('; ').slice(0, 120) : String(error));
	} finally {
		process.env.PATH = original;
	}
}

/** Startup must fail closed when dependencies or kernel features are missing. */
async function checkStartupFailures(): Promise<void> {
	const invalid = SandboxRuntimeConfigSchema.safeParse({ filesystem: {} });
	report(!invalid.success, 'startup: invalid policy rejected by schema', '');
	if (process.platform !== 'linux') return;

	const bin = path.join(fixture.root, 'bin');
	mkdirSync(bin);
	const socat = spawnSync('sh', ['-c', 'command -v socat'], { encoding: 'utf8' }).stdout.trim();
	const rg = spawnSync('sh', ['-c', 'command -v rg'], { encoding: 'utf8' }).stdout.trim();
	await expectUnavailable('startup: missing bubblewrap', `${path.dirname(socat)}:${path.dirname(rg)}:/usr/bin:/bin`);

	// Ubuntu 24.04 AppArmor lets bwrap exist but denies capability-bearing user
	// namespaces. sandbox-runtime's dependency check cannot see that failure.
	const bwrap = path.join(bin, 'bwrap');
	writeFileSync(bwrap, '#!/bin/sh\necho "bwrap: setting up uid map: Permission denied" >&2\nexit 1\n');
	chmodSync(bwrap, 0o755);
	const deps = (() => {
		const original = process.env.PATH;
		process.env.PATH = `${bin}:${original ?? ''}`;
		const result = SandboxManager.checkDependencies();
		process.env.PATH = original;
		return result;
	})();
	console.log(
		`INFO  dependency check with restricted user namespaces: ${deps.errors.length} error(s), ${deps.warnings.length} warning(s)`
	);
	await expectUnavailable('startup: restricted user namespaces', `${bin}:${process.env.PATH ?? ''}`);
}

/**
 * Operator terminals need a PTY. sandbox-runtime starts Bubblewrap with
 * `--new-session`, so this records what an interactive shell and a terminal
 * editor can do inside the terminal profile.
 */
async function checkTerminalProfile(): Promise<void> {
	await startSandbox(buildRuntimeConfig({ profile: 'workspace-write', workspace, tempDir, home }), env, workspace);
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
		const inside = await runSandboxed(`${write(ws('nvim.txt'))} && test -f ${ws('nvim.txt')}`, {
			env,
			cwd: workspace,
			commandId: 'nvim-inside'
		});
		const outsideFile = path.join(outside, 'nvim.txt');
		await runSandboxed(write(outsideFile), { env, cwd: workspace, commandId: 'nvim-outside' });
		report(inside.code === 0 && !existsSync(outsideFile), 'terminal editor: Neovim writes workspace only', '');
	}
	await SandboxManager.reset();
}

try {
	for (const group of groups) await runGroup(group);
	await checkCleanup();
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
