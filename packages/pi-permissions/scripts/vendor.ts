/**
 * Check or refresh the vendored upstream files against SOURCE.md.
 *
 *   node scripts/vendor.ts --verify
 *     Hash every file listed in SOURCE.md and fail on a mismatch, a missing
 *     file, or an unlisted file in the vendored directory.
 *   node scripts/vendor.ts --verify --upstream <pi-packages checkout>
 *     Also compare each file with the recorded commit in that checkout.
 *   node scripts/vendor.ts --sync <pi-packages checkout> <commit> <release>
 *     Copy the listed files from that commit, then rewrite the commit,
 *     release, and hashes in SOURCE.md. Review the upstream diff and run the
 *     tests before committing the result.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The vendored directory, holding upstream's package-relative paths. */
export const VENDOR_DIR = fileURLToPath(new URL('../src/vendor/pi-permission-system/', import.meta.url));
const SOURCE = path.join(VENDOR_DIR, 'SOURCE.md');
const PACKAGE_PATH = 'packages/pi-permission-system';
const ROW = /^\| `([^`]+)` \| `([\da-f]{64})` \|$/;

export type Source = { commit: string; release: string; files: Map<string, string> };

export function readSource(text = readFileSync(SOURCE, 'utf8')): Source {
	const field = (name: string): string => {
		const match = new RegExp(`^- ${name}: \`([^\`]+)\`$`, 'm').exec(text);
		if (!match?.[1]) throw new Error(`SOURCE.md has no ${name}`);
		return match[1];
	};
	const files = new Map<string, string>();
	for (const line of text.split('\n')) {
		const match = ROW.exec(line);
		if (match?.[1] && match[2]) files.set(match[1], match[2]);
	}
	return { commit: field('Commit'), release: field('Release'), files };
}

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

function listFiles(dir: string, prefix = ''): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const relative = path.posix.join(prefix, entry.name);
		return entry.isDirectory() ? listFiles(path.join(dir, entry.name), relative) : [relative];
	});
}

function upstreamFile(checkout: string, commit: string, file: string): Buffer {
	return execFileSync('git', ['-C', checkout, 'show', `${commit}:${PACKAGE_PATH}/${file}`], {
		maxBuffer: 64 * 1024 * 1024
	});
}

/** Return every difference between the vendored directory and SOURCE.md. */
export function verifyVendor(upstream?: string): string[] {
	const { commit, files } = readSource();
	const problems: string[] = [];
	const present = new Set(listFiles(VENDOR_DIR).filter((file) => file !== 'SOURCE.md'));
	for (const file of present) if (!files.has(file)) problems.push(`unlisted file: ${file}`);
	for (const [file, hash] of files) {
		if (!present.has(file)) {
			problems.push(`missing file: ${file}`);
			continue;
		}
		const local = readFileSync(path.join(VENDOR_DIR, file));
		if (sha256(local) !== hash) problems.push(`hash mismatch: ${file}`);
		if (upstream && !local.equals(upstreamFile(upstream, commit, file))) {
			problems.push(`differs from ${commit}: ${file}`);
		}
	}
	return problems;
}

function sync(checkout: string, commit: string, release: string): void {
	const text = readFileSync(SOURCE, 'utf8');
	const { files } = readSource(text);
	const hashes = new Map<string, string>();
	for (const file of files.keys()) {
		const data = upstreamFile(checkout, commit, file);
		mkdirSync(path.dirname(path.join(VENDOR_DIR, file)), { recursive: true });
		writeFileSync(path.join(VENDOR_DIR, file), data);
		hashes.set(file, sha256(data));
	}
	const updated = text
		.replace(/^- Commit: `[^`]+`$/m, () => `- Commit: \`${commit}\``)
		.replace(/^- Release: `[^`]+`$/m, () => `- Release: \`${release}\``)
		.split('\n')
		.map((line) => {
			const file = ROW.exec(line)?.[1];
			return file ? `| \`${file}\` | \`${hashes.get(file)}\` |` : line;
		})
		.join('\n');
	writeFileSync(SOURCE, updated);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [mode, ...rest] = process.argv.slice(2);
	if (mode === '--sync' && rest.length === 3) {
		const [checkout, commit, release] = rest as [string, string, string];
		sync(checkout, commit, release);
	} else if (mode === '--verify') {
		const upstream = rest[0] === '--upstream' ? rest[1] : undefined;
		const problems = verifyVendor(upstream);
		for (const problem of problems) console.error(problem);
		if (problems.length > 0) process.exitCode = 1;
		else console.log(`Vendored files match SOURCE.md${upstream ? ' and the recorded upstream commit' : ''}.`);
	} else {
		console.error('usage: vendor.ts --verify [--upstream <checkout>] | --sync <checkout> <commit> <release>');
		process.exitCode = 2;
	}
}
