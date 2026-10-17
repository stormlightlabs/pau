#!/usr/bin/env node
/**
 * Pi RPC runs of the built extension with Pi's faux model, so no paid
 * provider is called. Each run answers permission dialogs the way Pau would
 * and checks tool results, files on disk, and decision records.
 */
import { spawn } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { DecisionRecord, RequestEnvelope } from '../../src/messages.ts';
import { createFixture, SECRET, writePolicy } from '../fixture.ts';
import type { FixtureStep } from './fixture-extension.ts';

type ToolEnd = { isError: boolean; text: string };
type Dialog = { id: string; request: RequestEnvelope };
type Reply = Record<string, unknown> | undefined;

const fixture = createFixture();
const { workspace, home, outside } = fixture;
const piCli = fileURLToPath(new URL('bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const extension = fileURLToPath(new URL('../../dist/pi-extension.js', import.meta.url));
const failures: string[] = [];

function report(ok: boolean, label: string, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
	if (!ok) failures.push(label);
}

type Run = { ends: Map<string, ToolEnd>; dialogs: Dialog[]; records: DecisionRecord[]; stderr: string };

/**
 * Run a scripted prompt. `answer` receives each dialog and returns the
 * response body, or `undefined` to leave the dialog unanswered. It may also
 * write other commands, such as `abort`.
 */
async function runPi(
	steps: FixtureStep[],
	env: Record<string, string | undefined>,
	answer: (dialog: Dialog, write: (body: Record<string, unknown>) => void) => Reply = () => {}
): Promise<Run> {
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
			fileURLToPath(new URL('fixture-extension.ts', import.meta.url)),
			'--extension',
			extension
		],
		{
			cwd: workspace,
			env: {
				...process.env,
				HOME: home,
				PI_CODING_AGENT_DIR: path.join(home, '.pi/agent'),
				PI_OFFLINE: '1',
				PAU_FIXTURE_SCRIPT: JSON.stringify(steps),
				...env
			},
			stdio: ['pipe', 'pipe', 'pipe']
		}
	);
	const run: Run = { ends: new Map(), dialogs: [], records: [], stderr: '' };
	pi.stderr.on('data', (chunk: Buffer) => (run.stderr += chunk.toString()));
	const settled = Promise.withResolvers<void>();
	const write = (body: Record<string, unknown>): void => void pi.stdin.write(`${JSON.stringify(body)}\n`);
	createInterface({ input: pi.stdout }).on('line', (line) => {
		const event = JSON.parse(line) as Record<string, unknown>;
		if (event.type === 'tool_execution_end') {
			const result = event.result as { content?: { text?: string }[] } | undefined;
			const text = (result?.content ?? []).map((part) => part.text ?? '').join('\n');
			run.ends.set(String(event.toolCallId), { isError: event.isError === true, text });
		} else if (event.type === 'extension_ui_request' && event.method === 'select') {
			const dialog = { id: String(event.id), request: JSON.parse(String(event.title)) as RequestEnvelope };
			run.dialogs.push(dialog);
			const reply = answer(dialog, write);
			if (reply) write({ type: 'extension_ui_response', id: dialog.id, ...reply });
		} else if (event.type === 'extension_ui_request' && event.statusKey === 'pau.permission') {
			run.records.push(JSON.parse(String(event.statusText)) as DecisionRecord);
		} else if (event.type === 'agent_settled') {
			settled.resolve();
		} else if (event.type === 'response' && event.success === false) {
			run.stderr += `\nRPC error: ${String(event.error)}`;
			settled.resolve();
		}
	});
	const timeout = setTimeout(() => {
		console.error(`Timed out. Pi stderr:\n${run.stderr}`);
		pi.kill('SIGKILL');
		process.exit(1);
	}, 120_000);
	write({ id: 'prompt', type: 'prompt', message: 'Run the permission fixture script.' });
	await settled.promise;
	pi.stdin.end();
	await new Promise((resolve) => pi.once('close', resolve));
	clearTimeout(timeout);
	return run;
}

const recordFor = (run: Run, index: number) => run.records.find((record) => record.toolCallId === `call-${index}`);
const dialogFor = (run: Run, index: number) =>
	run.dialogs.find((dialog) => dialog.request.toolCallId === `call-${index}`);
const decide = (decision: string, reason?: string): Reply => ({
	value: JSON.stringify({ decision, ...(reason && { reason }) })
});
const marker = (name: string): string => path.join(workspace, name);
const outsideFile = path.join(outside, 'escape.txt');
const probeMarker = path.join(workspace, 'probe.txt');

// Allow, deny, session approval, protected reads, wrappers, MCP, and a
// cancelled dialog in one session.
const main = await runPi(
	[
		{ tool: 'read', args: { path: 'README.md' } },
		{ tool: 'read', args: { path: '~/.ssh/id_ed25519' } },
		{ tool: 'bash', args: { command: `cat ${path.join(home, '.ssh/id_ed25519')}` } },
		{ tool: 'bash', args: { command: 'ls' } },
		{ tool: 'bash', args: { command: `touch ${marker('a.txt')}` } },
		{ tool: 'bash', args: { command: `touch ${marker('b.txt')}` } },
		{ tool: 'bash', args: { command: `bash -c "touch ${marker('c.txt')}"` } },
		{ tool: 'bash', args: { command: `env touch ${marker('d.txt')}` } },
		{ tool: 'mcp__probe__lookup', args: { path: probeMarker } },
		{ tool: 'write', args: { path: outsideFile, content: 'x' } }
	],
	{ PAU_PERMISSION_POLICY_FILE: writePolicy(fixture) },
	({ request }) => {
		switch (request.toolCallId) {
			case 'call-4': {
				return decide('allow_session');
			}
			case 'call-6': {
				return decide('deny', 'Run it directly');
			}
			case 'call-7': {
				return { value: 'deny' };
			}
			case 'call-8': {
				return decide('allow_once');
			}
			default: {
				return { cancelled: true };
			}
		}
	}
);
const end = (index: number) => main.ends.get(`call-${index}`);
const leaked = main.ends.values().some((result) => result.text.includes(SECRET));

report(
	end(0)?.isError === false && !dialogFor(main, 0) && recordFor(main, 0)?.source === 'rule',
	'read: a workspace read runs without a dialog'
);
report(
	end(1)?.isError === true && !dialogFor(main, 1) && recordFor(main, 1)?.outcome === 'denied',
	'read: a protected credential is denied without a dialog',
	end(1)?.text.slice(0, 100)
);
report(
	end(2)?.isError === true && !dialogFor(main, 2) && recordFor(main, 2)?.outcome === 'denied',
	'bash: cat of a protected credential is denied without a dialog'
);
report(!leaked, 'no tool result contains the credential');
report(end(3)?.isError === false && !dialogFor(main, 3), 'bash: a read-only command runs without a dialog');
const sessionRequest = dialogFor(main, 4)?.request;
report(
	existsSync(marker('a.txt')) &&
		sessionRequest?.operation === 'command' &&
		sessionRequest.sessionScope.some((grant) => grant.pattern === 'touch *') &&
		recordFor(main, 4)?.source === 'operator',
	'bash: allow_session runs the command',
	JSON.stringify(sessionRequest?.sessionScope)
);
report(
	existsSync(marker('b.txt')) && !dialogFor(main, 5) && recordFor(main, 5)?.source === 'session',
	'bash: a later command the session approval covers runs without a dialog'
);
report(
	dialogFor(main, 6)?.request.reason === 'wrapper' &&
		!existsSync(marker('c.txt')) &&
		end(6)?.text.includes('Run it directly') === true,
	'bash: bash -c asks, and a denial with a reason reaches the agent',
	`${dialogFor(main, 6)?.request.reason}: ${end(6)?.text.slice(0, 80)}`
);
report(
	dialogFor(main, 7)?.request.reason === 'wrapper' && !existsSync(marker('d.txt')),
	'bash: env asks, and a bare deny blocks it'
);
report(
	dialogFor(main, 8)?.request.reason === 'mcp_unannotated' &&
		dialogFor(main, 8)?.request.operation === 'mcp' &&
		existsSync(probeMarker),
	'mcp: an MCP tool without annotations asks, and allow_once runs it'
);
const escape = dialogFor(main, 9)?.request;
report(
	escape?.paths.some((entry) => entry.outsideWorkspace && entry.access === 'write') === true &&
		!existsSync(outsideFile) &&
		recordFor(main, 9)?.source === 'operator',
	'write: an outside write asks, and a cancelled dialog denies it'
);
report(
	main.dialogs.every((dialog) => dialog.request.pau === 'permission' && dialog.request.version === 1) &&
		main.records.every((record) => !JSON.stringify(record).includes(workspace)),
	'requests carry the envelope and decision records carry no paths'
);
if (failures.length > 0) console.log(`\nPi stderr:\n${main.stderr.trim()}`);

// Abort drops the pending dialog, and Pi ignores a later answer.
const aborted = await runPi(
	[{ tool: 'bash', args: { command: `touch ${marker('aborted.txt')}` } }],
	{ PAU_PERMISSION_POLICY_FILE: writePolicy(fixture) },
	(dialog, write) => {
		write({ type: 'abort' });
		setTimeout(() => write({ type: 'extension_ui_response', id: dialog.id, value: 'allow_once' }), 200);
		return;
	}
);
report(
	recordFor(aborted, 0)?.source === 'abort' && !existsSync(marker('aborted.txt')),
	'abort: the request is cancelled and a late answer does not run the command',
	JSON.stringify(aborted.records)
);

// An unanswered dialog expires and denies.
const expired = await runPi([{ tool: 'bash', args: { command: `touch ${marker('expired.txt')}` } }], {
	PAU_PERMISSION_POLICY_FILE: writePolicy(fixture, { dialogTimeoutMs: 1000 })
});
report(
	recordFor(expired, 0)?.source === 'timeout' && !existsSync(marker('expired.txt')),
	'timeout: an unanswered request is denied',
	JSON.stringify(expired.records)
);

// A missing or invalid policy file blocks every call, even a workspace read.
const invalidFile = path.join(fixture.root, 'invalid.json');
writeFileSync(invalidFile, JSON.stringify({ version: 1, profile: 'confirm-writes' }));
for (const [label, file] of [
	['missing', path.join(fixture.root, 'missing.json')],
	['invalid', invalidFile]
] as const) {
	const run = await runPi([{ tool: 'read', args: { path: 'README.md' } }], { PAU_PERMISSION_POLICY_FILE: file });
	report(
		run.ends.get('call-0')?.isError === true &&
			run.dialogs.length === 0 &&
			recordFor(run, 0)?.source === 'policy_error' &&
			run.stderr.includes('[pau-permissions]'),
		`policy: every call is blocked when the policy file is ${label}`,
		run.ends.get('call-0')?.text.slice(0, 100)
	);
}

rmSync(fixture.root, { recursive: true, force: true });
console.log(`\n${failures.length === 0 ? 'All checks passed' : `${failures.length} check(s) failed`}.`);
process.exit(failures.length === 0 ? 0 : 1);
