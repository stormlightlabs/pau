#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

if (process.env.PAU_CLAUDE_LIVE !== '1') {
	throw new Error('Live Claude smoke is opt-in. Set PAU_CLAUDE_LIVE=1 to allow a paid Claude request.');
}

const { buildClaudeArguments, ClaudeProcessRegistry, discoverClaude } = await import('../dist/index.js');

const discovery = await discoverClaude({ executablePath: process.env.PAU_CLAUDE_PATH });
if (discovery.warning) process.stderr.write(`WARNING: ${discovery.warning}\n`);

const maxBudgetUsd = Number(process.env.PAU_CLAUDE_MAX_BUDGET_USD ?? '1');
if (!Number.isFinite(maxBudgetUsd) || maxBudgetUsd <= 0) {
	throw new Error('PAU_CLAUDE_MAX_BUDGET_USD must be a positive number');
}

const registry = new ClaudeProcessRegistry();
const child = await registry.start({
	discovery,
	cwd: resolve(process.env.PAU_CLAUDE_SMOKE_CWD ?? process.cwd()),
	args: buildClaudeArguments('review', {
		configurationMode: process.env.PAU_CLAUDE_CONFIG_MODE ?? 'native',
		maxTurns: 1,
		maxBudgetUsd
	})
});
const pid = child.pid;

try {
	const completion = await child.prompt('Reply with exactly PAU_CLAUDE_LIVE_OK. Do not use tools.');
	if (
		completion.status !== 'completed' ||
		!completion.result?.includes('PAU_CLAUDE_LIVE_OK') ||
		!completion.sessionId
	) {
		throw new Error(`Unexpected live Claude result: ${JSON.stringify(completion)}`);
	}
	if (process.env.PAU_CLAUDE_SESSION_ID_FILE) {
		await writeFile(process.env.PAU_CLAUDE_SESSION_ID_FILE, completion.sessionId);
	}
	process.stdout.write(
		`Live Claude ${discovery.version.raw} completed session ${completion.sessionId}; ` +
			`reported cost $${(completion.costUsd ?? 0).toFixed(4)}.\n`
	);
} finally {
	await registry.stopAll();
}

if (pid !== undefined && isAlive(pid)) {
	throw new Error(`Claude child ${pid} remained alive after bridge shutdown`);
}

function isAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
