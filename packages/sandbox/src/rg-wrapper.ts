#!/usr/bin/env node
/**
 * ripgrep wrapper used by the sandboxed tool host.
 *
 * Pi's grep tool rejects the whole search when ripgrep exits with status 2,
 * and ripgrep uses that status for any unreadable file even when it found
 * matches. Inside the sandbox, every read-denied path under the search root,
 * including placeholders that sandbox-runtime mounts for absent protected
 * files, would therefore fail workspace searches. The wrapper drops only
 * permission-denied diagnostics and reports the search result that ripgrep
 * would give without them. Every other error keeps status 2.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const realRipgrep = process.env.PAU_REAL_RG;
if (!realRipgrep) {
	process.stderr.write('PAU_REAL_RG is not set\n');
	process.exit(2);
}

const child = spawn(realRipgrep, process.argv.slice(2), { stdio: ['ignore', 'pipe', 'pipe'] });
const seen = { output: false, otherErrors: false };
child.stdout.on('data', (chunk: Buffer) => {
	seen.output ||= chunk.length > 0;
	process.stdout.write(chunk);
});
createInterface({ input: child.stderr }).on('line', (line) => {
	if (line.endsWith('Permission denied (os error 13)')) return;
	seen.otherErrors = true;
	process.stderr.write(`${line}\n`);
});
child.once('close', (code) => {
	if (code === 2 && !seen.otherErrors) process.exit(seen.output ? 0 : 1);
	process.exit(code ?? 2);
});
