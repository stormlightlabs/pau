#!/usr/bin/env node
/** Verify macOS Seatbelt reports for sandboxed processes and descendants. */
import path from 'node:path';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import { createFixture, sandboxSettings } from './fixture.ts';
import { runSandboxed, shellQuote, startSandbox } from './launcher.ts';
import { readPolicyFile, resolvePolicy, type SandboxPolicy } from './policy.ts';
import { SeatbeltDenialLog, type SeatbeltDenial } from './seatbelt.ts';

if (process.platform !== 'darwin') {
	console.log('Seatbelt smoke test skipped outside macOS.');
	process.exit(0);
}

const fixture = createFixture();
const probe = `${shellQuote(process.execPath)} ${shellQuote(fileURLToPath(new URL('probe.ts', import.meta.url)))}`;
const failures: string[] = [];

function report(ok: boolean, label: string, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
	if (!ok) failures.push(label);
}

function policy(): SandboxPolicy {
	const resolved = resolvePolicy(
		{
			adapter: 'pi',
			settings: sandboxSettings('workspace-write'),
			workspace: fixture.workspace,
			home: fixture.home,
			sessionDirectory: fixture.session,
			toolPath: process.env.PATH ?? ''
		},
		process.env
	);
	return readPolicyFile(resolved.policyFile);
}

async function denied(commandId: string, command: string): Promise<SeatbeltDenial[]> {
	const active = policy();
	await startSandbox(active.runtimeConfig, active.environment, active.workspace);
	const log = new SeatbeltDenialLog(commandId);
	try {
		// Give `log stream` time to install its predicate before the short fixture runs.
		await new Promise((resolve) => setTimeout(resolve, 150));
		const result = await runSandboxed(command, {
			env: active.environment,
			cwd: active.workspace,
			commandId,
			noProxy: active.noProxy
		});
		report(result.code !== 0, `${commandId}: operation is denied`, result.stderr.trim());
		return await log.take(1_000);
	} finally {
		log.stop();
		await SandboxManager.reset();
	}
}

try {
	process.chdir(fixture.workspace);
	// The first Seatbelt launch starts macOS's detailed sandbox report service.
	// Warm it before measuring the unified-log stream used by a long-lived tool host.
	await denied('seatbelt-log-warmup', `${probe} read ${shellQuote(path.join(fixture.home, '.ssh/id_ed25519'))}`);
	const directFile = await denied(
		'seatbelt-file-process',
		`${probe} read ${shellQuote(path.join(fixture.home, '.ssh/id_ed25519'))}`
	);
	const childFile = await denied(
		'seatbelt-file-descendant',
		`${probe} child-write ${shellQuote(path.join(fixture.outside, 'child.txt'))}`
	);
	const directTcp = await denied('seatbelt-tcp-process', `${probe} tcp 127.0.0.1 9`);
	const childTcp = await denied('seatbelt-tcp-descendant', `sh -c ${shellQuote(`${probe} tcp 127.0.0.1 9`)}`);

	for (const [label, reports, operation, kind] of [
		['file process', directFile, 'read', 'file'],
		['file descendant', childFile, 'create', 'file'],
		['TCP process', directTcp, 'connect', 'tcp'],
		['TCP descendant', childTcp, 'connect', 'tcp']
	] as const) {
		const match = reports.find((entry) => entry.operation === operation && entry.kind === kind);
		report(
			match !== undefined && match.process.pid > 0 && match.process.name.length > 0,
			`${label}: denial identifies the responsible process`,
			JSON.stringify(reports)
		);
	}
} finally {
	await SandboxManager.reset();
	rmSync(fixture.root, { recursive: true, force: true });
}

console.log(
	`\n${failures.length === 0 ? 'All Seatbelt checks passed' : `${failures.length} Seatbelt check(s) failed`}.`
);
process.exit(failures.length === 0 ? 0 : 1);
