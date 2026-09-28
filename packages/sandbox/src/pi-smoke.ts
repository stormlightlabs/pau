#!/usr/bin/env node
/**
 * End-to-end smoke run for the sandboxed Pi tool host. It starts Pi in RPC
 * mode with Pi's faux model, so no paid provider is called. The policy comes
 * from Pau's Rust resolver, as it does in the desktop app.
 *
 * The runs cover each built-in tool and its streaming, abort, timeout, and
 * truncation behavior, denial reports for failed calls, a tool host crash, an
 * operator `!` command, grants applied to a running session, a contained stdio MCP server, an unreviewed
 * extension tool, per-call approval for a tool enabled outside the sandbox,
 * and failing closed when the sandbox cannot start.
 */
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { SandboxedMcpServer, SandboxSettings } from '@stormlightlabs/pau-protocol';
import { createFixture, sandboxSettings, SECRET } from './fixture.ts';
import { resolvePolicy } from './policy.ts';
import type { SmokeStep } from './smoke-extensions.ts';

type ToolEnd = { toolName: string; isError: boolean; text: string; updates: number };
type Check = { name: string; step: SmokeStep; expect: (end: ToolEnd) => boolean };

const fixture = createFixture();
const { workspace, home, outside, session } = fixture;
const piCli = fileURLToPath(new URL('bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const source = (file: string): string => fileURLToPath(new URL(file, import.meta.url));
const hostNamespace = process.platform === 'linux' ? readlinkSync('/proc/self/ns/pid') : '';
const hostMarker = path.join(outside, 'host-probe.txt');
const searchPath = process.env.PATH ?? '';
const web = http.createServer((_request, response) => response.end('host-ok'));
const port = await new Promise<number>((resolve) =>
	web.listen(0, '127.0.0.1', () => resolve((web.address() as net.AddressInfo).port))
);
const failures: string[] = [];

function report(ok: boolean, label: string, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
	if (!ok) failures.push(label);
}

/** Write the session policy with Pau's resolver and return the policy file. */
function writePolicy(
	settings: SandboxSettings,
	mcpServers: SandboxedMcpServer[] = [],
	env: NodeJS.ProcessEnv = process.env
): string {
	return resolvePolicy(
		{
			adapter: 'pi',
			settings,
			workspace,
			home,
			sessionDirectory: session,
			runtimeRoots: [path.dirname(process.execPath), fileURLToPath(new URL('../../..', import.meta.url))],
			toolPath: searchPath,
			mcpServers
		},
		env
	).policyFile;
}

const checks: Check[] = [
	{
		name: 'bash runs in a separate PID namespace with session metadata and no credentials',
		step: {
			tool: 'bash',
			args: {
				command: `printenv ANTHROPIC_API_KEY PAU_SEEDED_TOKEN; cat "$HOME/.pi/agent/auth.json"; ${
					hostNamespace ? 'readlink /proc/self/ns/pid; ' : ''
				}echo "session=\${PI_SESSION_ID:+set}"; echo tool-host-ok`
			}
		},
		expect: (end) =>
			end.text.includes('tool-host-ok') &&
			end.text.includes('session=set') &&
			(!hostNamespace || !end.text.includes(hostNamespace))
	},
	{
		name: 'read denies Pi auth file and reports the denial',
		step: { tool: 'read', args: { path: path.join(home, '.pi/agent/auth.json') } },
		expect: (end) =>
			end.isError &&
			end.text.includes(`- read ${path.join(home, '.pi/agent/auth.json')}: the sandbox blocks access`) &&
			!end.text.includes(SECRET)
	},
	{
		name: 'read workspace file',
		step: { tool: 'read', args: { path: 'README.md' } },
		expect: (end) => !end.isError && end.text.includes('workspace readme')
	},
	{
		name: 'write workspace file',
		step: { tool: 'write', args: { path: 'sandboxed.txt', content: 'hello\n' } },
		expect: (end) => !end.isError && existsSync(path.join(workspace, 'sandboxed.txt'))
	},
	{
		name: 'write outside workspace',
		step: { tool: 'write', args: { path: path.join(outside, 'escape.txt'), content: 'x' } },
		expect: (end) =>
			end.isError &&
			!existsSync(path.join(outside, 'escape.txt')) &&
			end.text.includes(`- create ${path.join(outside, 'escape.txt')}: this path is outside`)
	},
	{
		name: 'edit workspace file',
		step: { tool: 'edit', args: { path: 'src/app.ts', edits: [{ oldText: 'answer = 41', newText: 'answer = 42' }] } },
		expect: (end) => !end.isError && readFileSync(path.join(workspace, 'src/app.ts'), 'utf8').includes('42')
	},
	{
		name: 'edit protected Pi settings and report the denial',
		step: { tool: 'edit', args: { path: '.pi/settings.json', edits: [{ oldText: '{}', newText: '{"x":1}' }] } },
		expect: (end) =>
			end.isError && end.text.includes('- write .pi/settings.json: the sandbox keeps this path read-only')
	},
	{
		name: 'bash rename into protected configuration reports the denial',
		step: { tool: 'bash', args: { command: 'cp AGENTS.md moved.md && mv moved.md .pi/moved.md' } },
		expect: (end) =>
			end.isError &&
			!existsSync(path.join(workspace, '.pi/moved.md')) &&
			end.text.includes('- rename .pi/moved.md: the sandbox keeps this path read-only')
	},
	{
		name: 'bash refusal with no denied path is labelled a sandboxed failure',
		step: {
			tool: 'bash',
			args: { command: 'echo locked-content > locked.txt && chmod 000 locked.txt && cat locked.txt' }
		},
		expect: (end) => end.isError && end.text.includes('Sandboxed failure:') && !end.text.includes('locked-content')
	},
	{
		name: 'grep searches the workspace',
		step: { tool: 'grep', args: { pattern: 'answer', path: '.' } },
		expect: (end) => !end.isError && end.text.includes('app.ts')
	},
	{
		name: 'grep reports files the sandbox skipped',
		step: { tool: 'grep', args: { pattern: 'TOKEN', path: '.' } },
		expect: (end) =>
			end.text.includes('.env.example') &&
			end.text.includes('Sandbox skipped 1 unreadable file') &&
			/\/\.env$/m.test(end.text) &&
			!end.text.includes('.mcp.json')
	},
	{
		name: 'grep cannot search credential stores',
		step: { tool: 'grep', args: { pattern: SECRET, path: path.join(home, '.ssh') } },
		expect: (end) => !end.text.includes(`${SECRET}\n`) && !end.text.includes(`:${SECRET}`)
	},
	{
		name: 'find lists workspace files',
		step: { tool: 'find', args: { pattern: '**/*.ts' } },
		expect: (end) => !end.isError && end.text.includes('app.ts')
	},
	{
		name: 'ls lists the workspace',
		step: { tool: 'ls', args: { path: '.' } },
		expect: (end) => !end.isError && end.text.includes('README.md')
	},
	{
		name: 'bash streams output while it runs',
		step: { tool: 'bash', args: { command: 'for i in 1 2 3; do echo tick$i; sleep 0.3; done' } },
		expect: (end) => !end.isError && end.text.includes('tick3') && end.updates >= 2
	},
	{
		name: 'bash timeout stops the command',
		step: { tool: 'bash', args: { command: 'sleep 5; echo finished', timeout: 1 } },
		expect: (end) => end.isError && !end.text.includes('finished')
	},
	{
		name: 'bash output is truncated',
		step: { tool: 'bash', args: { command: 'seq 1 100000' } },
		expect: (end) => end.text.includes('100000') && !end.text.includes('\n1\n') && /truncat|Showing/i.test(end.text)
	},
	{
		name: 'bash network is off',
		step: { tool: 'bash', args: { command: 'curl -fsS --max-time 3 https://example.com/ && echo reached' } },
		expect: (end) => !end.text.includes('reached')
	},
	{
		name: 'a crashed tool host fails its call',
		step: { tool: 'bash', args: { command: 'kill -KILL $PPID; sleep 5' } },
		expect: (end) => end.isError && end.text.includes('tool host exited')
	},
	{
		name: 'the next call starts a new tool host',
		step: { tool: 'read', args: { path: 'README.md' } },
		expect: (end) => !end.isError && end.text.includes('workspace readme')
	},
	{
		name: 'unreviewed extension tool is blocked',
		step: { tool: 'host_probe', args: { path: hostMarker } },
		expect: (end) => end.isError && !existsSync(hostMarker)
	}
];

type RpcLine = {
	type: string;
	id?: string;
	method?: string;
	toolName?: string;
	toolCallId?: string;
	isError?: boolean;
	result?: { content?: { type: string; text?: string }[] };
	data?: Record<string, unknown>;
	success?: boolean;
	error?: string;
};

type RunOptions = {
	policyFile: string;
	/** Called when the scripted tool call with this index starts. */
	onToolStart?: (index: number, pi: PiRun) => void;
	/** Answers for extension confirmation dialogs, in order. */
	confirmations?: boolean[];
	/** Abort the agent when the tool call with this index starts. */
	abortAt?: number;
};

/** One Pi RPC process running a scripted prompt through the sandbox extension. */
type PiRun = {
	ends: ToolEnd[];
	dialogs: string[];
	stderr: () => string;
	command: (id: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
	close: () => Promise<void>;
};

async function runPi(steps: SmokeStep[], options: RunOptions): Promise<PiRun> {
	const pi = spawn(
		process.execPath,
		[
			piCli,
			'--mode',
			'rpc',
			'--no-session',
			'--no-approve',
			'--provider',
			'pau-faux',
			'--model',
			'scripted',
			'--extension',
			source('smoke-extensions.ts'),
			'--extension',
			source('pi-extension.ts')
		],
		{
			cwd: workspace,
			env: {
				...process.env,
				// The RPC host keeps provider credentials; the tool host must not see them.
				ANTHROPIC_API_KEY: SECRET,
				PAU_SEEDED_TOKEN: SECRET,
				PI_CODING_AGENT_DIR: path.join(home, '.pi/agent'),
				PI_OFFLINE: '1',
				PAU_SANDBOX_POLICY_FILE: options.policyFile,
				PAU_SMOKE_SCRIPT: JSON.stringify(steps)
			},
			stdio: ['pipe', 'pipe', 'pipe']
		}
	);
	let stderr = '';
	pi.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
	const ends: ToolEnd[] = [];
	const updates = new Map<string, number>();
	const dialogs: string[] = [];
	const confirmations = [...(options.confirmations ?? [])];
	const responses = new Map<string, (data: Record<string, unknown>) => void>();
	const settled = Promise.withResolvers<void>();
	const write = (body: Record<string, unknown>): void => void pi.stdin.write(`${JSON.stringify(body)}\n`);
	const command = (id: string, body: Record<string, unknown>): Promise<Record<string, unknown>> =>
		new Promise((resolve) => {
			responses.set(id, resolve);
			write({ id, ...body });
		});
	const run: PiRun = {
		ends,
		dialogs,
		stderr: () => stderr,
		command,
		close: async () => {
			pi.stdin.end();
			await new Promise((resolve) => pi.once('close', resolve));
			clearTimeout(timeout);
		}
	};
	createInterface({ input: pi.stdout }).on('line', (line) => {
		const event = JSON.parse(line) as RpcLine;
		if (event.type === 'tool_execution_start') {
			const index = Number(event.toolCallId?.replace('call-', ''));
			if (index === options.abortAt) write({ type: 'abort' });
			options.onToolStart?.(index, run);
		} else if (event.type === 'tool_execution_update' && event.toolCallId) {
			updates.set(event.toolCallId, (updates.get(event.toolCallId) ?? 0) + 1);
		} else if (event.type === 'tool_execution_end') {
			const text = (event.result?.content ?? []).map((part) => part.text ?? '').join('\n');
			ends.push({
				toolName: event.toolName ?? '',
				isError: event.isError ?? false,
				text,
				updates: updates.get(event.toolCallId ?? '') ?? 0
			});
		} else if (event.type === 'extension_ui_request' && event.method === 'confirm' && event.id) {
			dialogs.push(String((event as { title?: string }).title ?? ''));
			write({ type: 'extension_ui_response', id: event.id, confirmed: confirmations.shift() ?? false });
		} else if (event.type === 'agent_settled') {
			settled.resolve();
		} else if (event.type === 'response' && event.id) {
			responses.get(event.id)?.(event.success ? (event.data ?? {}) : { error: event.error });
		}
	});
	const timeout = setTimeout(() => {
		console.error(`Timed out. Pi stderr:\n${stderr}`);
		pi.kill('SIGKILL');
		process.exit(1);
	}, 120_000);
	const prompt = await command('prompt', { type: 'prompt', message: 'Run the sandbox smoke script.' });
	if (prompt.error) report(false, 'Pi accepts the scripted prompt', String(prompt.error));
	else await settled.promise;
	return run;
}

function reportChecks(run: PiRun, list: Check[], label: string): void {
	for (const [index, check] of list.entries()) {
		const end = run.ends[index];
		const leaked = end?.text.includes(SECRET) ?? false;
		const summary = end ? `${end.isError ? 'error' : 'ok'}: ${end.text.replaceAll('\n', ' ').slice(0, 100)}` : '';
		report(
			end !== undefined && end.toolName === check.step.tool && check.expect(end) && !leaked,
			`${label}${check.step.tool}: ${check.name}`,
			end ? `${leaked ? 'secret leaked, ' : ''}${summary}` : 'no result'
		);
	}
}

const workspaceWrite = sandboxSettings('workspace-write');
const main = await runPi(
	checks.map((check) => check.step),
	{ policyFile: writePolicy(workspaceWrite) }
);
reportChecks(main, checks, '');
const operator = await main.command('operator-bash', {
	type: 'bash',
	command: `printenv ANTHROPIC_API_KEY; touch ${path.join(outside, 'operator.txt')} 2>&1; echo operator-ok`
});
const output = String(operator.output ?? operator.error ?? '');
report(
	output.includes('operator-ok') && !output.includes(SECRET) && !existsSync(path.join(outside, 'operator.txt')),
	'operator ! command runs in the sandbox',
	output.replaceAll('\n', ' ').slice(0, 120)
);
report(main.stderr().includes('disabled unreviewed tools: host_probe'), 'unreviewed tools are reported as disabled');
await main.close();
if (failures.length > 0) console.log(`\nPi stderr:\n${main.stderr().trim()}`);

// Abort stops a running command inside the sandbox.
const aborted = await runPi([{ tool: 'bash', args: { command: 'sleep 20; echo finished' } }], {
	policyFile: writePolicy(workspaceWrite),
	abortAt: 0
});
report(
	aborted.ends[0]?.isError === true && !aborted.ends[0].text.includes('finished'),
	'bash: abort stops the running command',
	aborted.ends[0]?.text.slice(0, 100) ?? 'no result'
);
await aborted.close();

// Grants change while the session runs, a stdio MCP server runs inside the
// sandbox, and a tool enabled outside the sandbox asks before each call.
const granted = path.join(outside, 'granted');
const mcpServer: SandboxedMcpServer = {
	name: 'probe',
	socket: path.join(session, 'host', 'mcp-probe.sock'),
	command: process.execPath,
	args: [source('probe.ts'), 'mcp-server', path.join(home, '.ssh/id_ed25519'), path.join(outside, 'mcp.txt')],
	cwd: workspace,
	env: {}
};
const withTool = sandboxSettings('workspace-write', { unsandboxed_tools: ['host_probe'] });
const approvedMarker = path.join(outside, 'approved.txt');
const deniedMarker = path.join(outside, 'denied.txt');
const liveSteps: SmokeStep[] = [
	{ tool: 'host_probe', args: { path: approvedMarker } },
	{ tool: 'host_probe', args: { path: deniedMarker } },
	{ tool: 'bash', args: { command: `sleep 2; curl -fsS --max-time 3 --noproxy '' http://127.0.0.1:${port}/` } },
	{ tool: 'bash', args: { command: `curl -fsS --max-time 3 http://127.0.0.1:${port}/` } },
	{ tool: 'bash', args: { command: `sleep 2; touch ${path.join(granted, 'during.txt')} && echo wrote-during` } },
	{ tool: 'write', args: { path: path.join(granted, 'after.txt'), content: 'granted\n' } }
];
const live = await runPi(liveSteps, {
	policyFile: writePolicy(withTool, [mcpServer]),
	confirmations: [true, false],
	onToolStart: (index) => {
		const network = { domains: [`127.0.0.1:${port}`], writable_roots: [], unix_sockets: false };
		if (index === 2) writePolicy({ ...withTool, grants: network }, [mcpServer]);
		else if (index === 4) writePolicy({ ...withTool, grants: { ...network, writable_roots: [granted] } }, [mcpServer]);
	}
});
const [approved, denied, running, next, during, after] = live.ends;
report(
	approved?.isError === false &&
		existsSync(approvedMarker) &&
		live.dialogs[0]?.includes('outside the sandbox') === true,
	'enabled tool runs outside the sandbox after approval',
	live.dialogs.join(' | ')
);
report(denied?.isError === true && !existsSync(deniedMarker), 'enabled tool is blocked when the operator declines');
report(
	running?.text.includes('host-ok') === true,
	'network grant reaches a running command',
	running?.text.slice(0, 80)
);
report(
	next?.text.includes('host-ok') === true,
	'granted local address works for NO_PROXY clients',
	next?.text.slice(0, 80)
);
report(
	during?.text.includes('wrote-during') === false && !existsSync(path.join(granted, 'during.txt')),
	'filesystem grant waits for the current tool call'
);
report(
	after?.isError === false && existsSync(path.join(granted, 'after.txt')) && live.stderr().includes('restarted'),
	'filesystem grant restarts the tool host before the next call',
	after?.text.slice(0, 80)
);
const mcp = await new Promise<string>((resolve) => {
	const socket = net.connect(mcpServer.socket, () => socket.write('{"jsonrpc":"2.0","id":1,"method":"probe"}\n'));
	createInterface({ input: socket }).once('line', (line) => {
		socket.destroy();
		resolve(line);
	});
	socket.once('error', (error) => resolve(String(error)));
	setTimeout(() => resolve('timeout'), 10_000);
});
const answer = (JSON.parse(mcp.startsWith('{') ? mcp : '{}') as { result?: Record<string, boolean> }).result;
report(
	answer?.sandboxed === true && answer.credential === false && answer.outsideWrite === false && !answer.providerKey,
	'stdio MCP server inherits the sandbox',
	mcp.slice(0, 120)
);
await live.close();
if (failures.length > 0) console.log(`\nPi stderr:\n${live.stderr().trim()}`);

// When Bubblewrap cannot run, tool calls fail instead of running in the Pi
// process. The fake bwrap reports a version, so Pau's resolver pins it.
if (process.platform === 'linux') {
	const bin = path.join(fixture.root, 'broken-bin');
	mkdirSync(bin);
	writeFileSync(
		path.join(bin, 'bwrap'),
		'#!/bin/sh\n[ "$1" = --version ] && { echo "bubblewrap 0.12.0"; exit 0; }\necho "bwrap: permission denied" >&2\nexit 1\n'
	);
	chmodSync(path.join(bin, 'bwrap'), 0o755);
	const unavailable = path.join(workspace, 'unsandboxed.txt');
	const policyFile = writePolicy(workspaceWrite, [], { ...process.env, PATH: `${bin}:${searchPath}` });
	const failed = await runPi([{ tool: 'write', args: { path: unavailable, content: 'x' } }], { policyFile });
	const end = failed.ends[0];
	report(
		end?.isError === true && end.text.includes('Sandbox unavailable') && !existsSync(unavailable),
		'tool calls fail closed when the sandbox cannot start',
		end?.text.slice(0, 100) ?? 'no result'
	);
	await failed.close();
}

web.close();
rmSync(fixture.root, { recursive: true, force: true });
console.log(
	`\n${failures.length === 0 ? 'All checks passed' : `${failures.length} check(s) failed`} on ${process.platform}.`
);
process.exit(failures.length === 0 ? 0 : 1);
