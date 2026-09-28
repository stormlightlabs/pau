#!/usr/bin/env node
/**
 * ripgrep wrapper used by the sandboxed tool host.
 *
 * Pi's grep tool rejects the whole search when ripgrep exits with status 2,
 * and ripgrep uses that status for any unreadable file even when it found
 * matches. Inside the sandbox, every read-denied path under the search root
 * would therefore fail workspace searches. The wrapper drops only the
 * diagnostics for refused reads, which Linux reports as `EACCES` and macOS
 * Seatbelt as `EPERM`, records those paths in the file named by
 * `PAU_RG_SKIPPED` so the tool host can report an incomplete search, and
 * reports the result ripgrep would give without them. Every other error
 * keeps status 2.
 */
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const realRipgrep = process.env.PAU_REAL_RG;
if (!realRipgrep) {
	process.stderr.write('PAU_REAL_RG is not set\n');
	process.exit(2);
}
const skippedFile = process.env.PAU_RG_SKIPPED;
const denied = /^rg: (.+): (?:Permission denied \(os error 13\)|Operation not permitted \(os error 1\))$/;

const child = spawn(realRipgrep, process.argv.slice(2), { stdio: ['ignore', 'pipe', 'pipe'] });
const seen = { output: false, otherErrors: false };
child.stdout.on('data', (chunk: Buffer) => {
	seen.output ||= chunk.length > 0;
	process.stdout.write(chunk);
});

createInterface({ input: child.stderr }).on('line', (line) => {
	const match = denied.exec(line);
	if (match) {
		if (skippedFile && match[1]) appendFileSync(skippedFile, `${match[1]}\n`);
		return;
	}
	seen.otherErrors = true;
	process.stderr.write(`${line}\n`);
});

child.once('close', (code) => {
	if (code === 2 && !seen.otherErrors) process.exit(seen.output ? 0 : 1);
	process.exit(code ?? 2);
});
