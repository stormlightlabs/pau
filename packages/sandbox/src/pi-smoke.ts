#!/usr/bin/env node
/**
 * End-to-end smoke run for the sandboxed Pi tool host. It starts Pi in RPC
 * mode with Pi's faux model, so no paid provider is called, and checks each
 * built-in tool, an operator `!` command, and an unreviewed extension tool.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readlinkSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createFixture, SECRET } from './fixture.ts';
import type { SandboxPolicyInput } from './profile.ts';
import type { SmokeStep } from './smoke-extensions.ts';

type ToolEnd = { toolName: string; isError: boolean; text: string };
type Check = { name: string; step: SmokeStep; expect: (end: ToolEnd) => boolean };

const fixture = createFixture();
const { workspace, home, outside, tempDir } = fixture;
const policy: SandboxPolicyInput = { profile: 'workspace-write', workspace, tempDir, home };
const piCli = fileURLToPath(new URL('bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const extension = (file: string): string => fileURLToPath(new URL(file, import.meta.url));
const hostNamespace = process.platform === 'linux' ? readlinkSync('/proc/self/ns/pid') : '';
const hostMarker = path.join(outside, 'host-probe.txt');

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
		name: 'read denies Pi auth file',
		step: { tool: 'read', args: { path: path.join(home, '.pi/agent/auth.json') } },
		expect: (end) => end.isError
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
		expect: (end) => end.isError && !existsSync(path.join(outside, 'escape.txt'))
	},
	{
		name: 'edit workspace file',
		step: { tool: 'edit', args: { path: 'src/app.ts', edits: [{ oldText: 'answer = 41', newText: 'answer = 42' }] } },
		expect: (end) => !end.isError && readFileSync(path.join(workspace, 'src/app.ts'), 'utf8').includes('42')
	},
	{
		name: 'edit protected Pi settings',
		step: { tool: 'edit', args: { path: '.pi/settings.json', edits: [{ oldText: '{}', newText: '{"x":1}' }] } },
		expect: (end) => end.isError
	},
	{
		name: 'grep searches the workspace',
		step: { tool: 'grep', args: { pattern: 'answer', path: '.' } },
		expect: (end) => !end.isError && end.text.includes('app.ts')
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
		name: 'bash network is off',
		step: { tool: 'bash', args: { command: 'curl -fsS --max-time 3 https://example.com/ && echo reached' } },
		expect: (end) => !end.text.includes('reached')
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
	toolName?: string;
	isError?: boolean;
	result?: { content?: { type: string; text?: string }[] };
	data?: Record<string, unknown>;
	success?: boolean;
	error?: string;
};

/** One Pi RPC process running a scripted prompt through the sandbox extension. */
type PiRun = {
	ends: ToolEnd[];
	stderr: () => string;
	command: (id: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
	close: () => Promise<void>;
};

async function runPi(steps: SmokeStep[], searchPath: string): Promise<PiRun> {
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
			extension('smoke-extensions.ts'),
			'--extension',
			extension('pi-extension.ts')
		],
		{
			cwd: workspace,
			env: {
				...process.env,
				PATH: searchPath,
				// The RPC host keeps provider credentials; the tool host must not see them.
				ANTHROPIC_API_KEY: SECRET,
				PAU_SEEDED_TOKEN: SECRET,
				PI_CODING_AGENT_DIR: path.join(home, '.pi/agent'),
				PI_OFFLINE: '1',
				PAU_SANDBOX_POLICY: JSON.stringify(policy),
				PAU_SMOKE_SCRIPT: JSON.stringify(steps)
			},
			stdio: ['pipe', 'pipe', 'pipe']
		}
	);
	let stderr = '';
	pi.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
	const ends: ToolEnd[] = [];
	const responses = new Map<string, (data: Record<string, unknown>) => void>();
	const settled = Promise.withResolvers<void>();
	createInterface({ input: pi.stdout }).on('line', (line) => {
		const event = JSON.parse(line) as RpcLine;
		if (event.type === 'tool_execution_end') {
			const text = (event.result?.content ?? []).map((part) => part.text ?? '').join('\n');
			ends.push({ toolName: event.toolName ?? '', isError: event.isError ?? false, text });
		} else if (event.type === 'agent_settled') {
			settled.resolve();
		} else if (event.type === 'response' && event.id) {
			responses.get(event.id)?.(event.success ? (event.data ?? {}) : { error: event.error });
		}
	});
	const command = (id: string, body: Record<string, unknown>): Promise<Record<string, unknown>> =>
		new Promise((resolve) => {
			responses.set(id, resolve);
			pi.stdin.write(`${JSON.stringify({ id, ...body })}\n`);
		});
	const timeout = setTimeout(() => {
		console.error(`Timed out. Pi stderr:\n${stderr}`);
		pi.kill('SIGKILL');
		process.exit(1);
	}, 60_000);
	const prompt = await command('prompt', { type: 'prompt', message: 'Run the sandbox smoke script.' });
	if (prompt.error) report(false, 'Pi accepts the scripted prompt', String(prompt.error));
	else await settled.promise;
	return {
		ends,
		stderr: () => stderr,
		command,
		close: async () => {
			pi.stdin.end();
			await new Promise((resolve) => pi.once('close', resolve));
			clearTimeout(timeout);
		}
	};
}

const failures: string[] = [];
function report(ok: boolean, label: string, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
	if (!ok) failures.push(label);
}

const searchPath = process.env.PATH ?? '';
const run = await runPi(
	checks.map((check) => check.step),
	searchPath
);
for (const [index, check] of checks.entries()) {
	const end = run.ends[index];
	const leaked = end?.text.includes(SECRET) ?? false;
	const summary = end ? `${end.isError ? 'error' : 'ok'}: ${end.text.replaceAll('\n', ' ').slice(0, 100)}` : '';
	report(
		end !== undefined && end.toolName === check.step.tool && check.expect(end) && !leaked,
		`${check.step.tool}: ${check.name}`,
		end ? `${leaked ? 'secret leaked, ' : ''}${summary}` : 'no result'
	);
}
const operator = await run.command('operator-bash', {
	type: 'bash',
	command: `printenv ANTHROPIC_API_KEY; touch ${path.join(outside, 'operator.txt')} 2>&1; echo operator-ok`
});
const output = String(operator.output ?? operator.error ?? '');
report(
	output.includes('operator-ok') && !output.includes(SECRET) && !existsSync(path.join(outside, 'operator.txt')),
	'operator ! command runs in the sandbox',
	output.replaceAll('\n', ' ').slice(0, 120)
);
report(run.stderr().includes('disabled unreviewed tools: host_probe'), 'unreviewed tools are reported as disabled');
await run.close();
if (failures.length > 0) console.log(`\nPi stderr:\n${run.stderr().trim()}`);

// Without Bubblewrap the extension must refuse tool calls instead of running
// them in the Pi process.
if (process.platform === 'linux') {
	const withoutBwrap = searchPath
		.split(':')
		.filter((entry) => !existsSync(path.join(entry, 'bwrap')))
		.join(':');
	const unavailable = path.join(workspace, 'unsandboxed.txt');
	const failed = await runPi([{ tool: 'write', args: { path: unavailable, content: 'x' } }], withoutBwrap);
	const end = failed.ends[0];
	report(
		end?.isError === true && end.text.includes('Sandbox unavailable') && !existsSync(unavailable),
		'tool calls fail closed when the sandbox cannot start',
		end?.text.slice(0, 100) ?? 'no result'
	);
	await failed.close();
}

rmSync(fixture.root, { recursive: true, force: true });
console.log(
	`\n${failures.length === 0 ? 'All checks passed' : `${failures.length} check(s) failed`} on ${process.platform}.`
);
process.exit(failures.length === 0 ? 0 : 1);
