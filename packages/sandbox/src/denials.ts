import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { SandboxPolicy } from './policy.ts';
import type { PreloadDenial } from './preload.ts';
import type { SandboxedToolName } from './tool-host-protocol.ts';

/** File operation that the sandbox blocked. */
export type SandboxDenialOperation = 'read' | 'write' | 'create' | 'rename';

/**
 * Which policy rule blocked the operation. `unreadable` covers credential
 * stores, workspace secrets, and paths outside a home read-deny allowance.
 */
export type SandboxDenialReason = 'unreadable' | 'protected' | 'outside-writable';

/**
 * One access that the effective policy blocks. `path` is the only path a
 * report carries, so a report never exposes other paths outside the workspace.
 */
export type SandboxDenial = { operation: SandboxDenialOperation; path: string; reason: SandboxDenialReason };

/**
 * Result of comparing a failed tool call with the effective policy. A failure
 * that looks like an OS refusal but names no denied path is `unexplained`.
 */
export type FailureReport = { denials: SandboxDenial[]; unexplained: boolean; note: string };

/** Errors the kernel, Seatbelt, or the missing network namespace return for a refusal. */
const REFUSAL =
	/\b(EACCES|EPERM|EROFS|ENETUNREACH)\b|permission denied|operation not permitted|read-only file system|network is unreachable/i;

/** A masked directory hides its entries, so a missing path may also be a denial. */
const MISSING = /\bENOENT\b|no such file or directory|path not found/i;

const RENAME = /\brename\b|cannot move|\bmv:/i;
const WRITE =
	/\bEROFS\b|read-only file system|cannot (create|touch|remove|open .* for writing)|\b(mkdir|unlink|rmdir|write|copyfile)\b/i;

/** Quoted paths, as Node and coreutils print them. */
const QUOTED = /'([^'\n]+)'|"([^"\n]+)"|‘([^’\n]+)’/g;
/**
 * `tool: path: message`, as shells and many utilities print a failed path.
 * Paths with spaces are left to the quoted form, which keeps prose such as
 * `bash: line 1` or `file. EROFS` out of the match.
 */
const PREFIXED =
	/(?:^|:\s)([^:\s'"][^:\s]*):\s*(?:permission denied|operation not permitted|read-only file system|no such file or directory)/gi;

/** Tools whose `path` argument names the file or directory they access. */
const READ_TOOLS = new Set<SandboxedToolName>(['read', 'grep', 'find', 'ls']);

type Rule = { pattern: RegExp; depth: number };

function rule(entry: string): Rule {
	const source = entry
		.split('*')
		.map((part) => part.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`))
		.join('[^/]*');
	return { pattern: new RegExp(`^${source}(?:/.*)?$`), depth: entry.split('/').length };
}

/** Depth of the most specific rule that covers any form of the path, or -1. */
function match(rules: Rule[], forms: string[]): number {
	let depth = -1;
	for (const { pattern, depth: ruleDepth } of rules) {
		if (ruleDepth > depth && forms.some((form) => pattern.test(form))) depth = ruleDepth;
	}
	return depth;
}

/**
 * The path as the tool named it and as the kernel sees it. Policy entries
 * are canonical, except session paths that Pau joins without resolving, so a
 * rule may match either form. A path being created resolves through its
 * nearest existing ancestor.
 */
function forms(target: string): string[] {
	let existing = target;
	const rest: string[] = [];
	while (!existsSync(existing) && path.dirname(existing) !== existing) {
		rest.unshift(path.basename(existing));
		existing = path.dirname(existing);
	}
	try {
		return [target, path.join(realpathSync(existing), ...rest)];
	} catch {
		return [target];
	}
}

/** Compiled filesystem rules of one policy. */
class PolicyRules {
	readonly #denyRead: Rule[];
	readonly #allowRead: Rule[];
	readonly #allowWrite: Rule[];
	readonly #denyWrite: Rule[];

	constructor(policy: SandboxPolicy) {
		const { filesystem } = policy.runtimeConfig;
		// Placeholders mask absent protected paths for reads and writes.
		this.#denyRead = [...filesystem.denyRead, ...policy.placeholders].map((entry) => rule(entry));
		this.#allowRead = (filesystem.allowRead ?? []).map((entry) => rule(entry));
		this.#allowWrite = filesystem.allowWrite.map((entry) => rule(entry));
		this.#denyWrite = [...filesystem.denyWrite, ...policy.placeholders].map((entry) => rule(entry));
	}

	/** The most specific rule wins, as in sandbox-runtime. */
	unreadable(paths: string[]): boolean {
		const denied = match(this.#denyRead, paths);
		return denied >= 0 && denied >= match(this.#allowRead, paths);
	}

	unwritable(paths: string[]): SandboxDenialReason | undefined {
		const allowed = match(this.#allowWrite, paths);
		if (allowed < 0) return 'outside-writable';
		return match(this.#denyWrite, paths) >= allowed ? 'protected' : undefined;
	}
}

/** Paths a failure message names on lines that describe a refusal or a missing path. */
function namedPaths(message: string): { path: string; line: string }[] {
	const found: { path: string; line: string }[] = [];
	for (const line of message.split('\n')) {
		if (!REFUSAL.test(line) && !MISSING.test(line)) continue;
		for (const pattern of [QUOTED, PREFIXED]) {
			for (const groups of line.matchAll(pattern)) {
				const named = groups.slice(1).find(Boolean);
				if (named) found.push({ path: named, line });
			}
		}
	}
	return found;
}

function display(workspace: string, target: string): string {
	const relative = path.relative(workspace, target);
	return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : target;
}

const REASON_TEXT: Record<SandboxDenialReason, string> = {
	unreadable: 'the sandbox blocks access to this path',
	protected: 'the sandbox keeps this path read-only',
	'outside-writable': 'this path is outside the folders the sandbox can write'
};

/**
 * Compare a failed tool call with the effective policy and describe what the
 * sandbox blocked. It reads only the error message, the tool's `path`
 * argument, and the policy; the note names denied paths and nothing else, so
 * it never repeats file contents or environment values.
 */
export function explainFailure(
	policy: SandboxPolicy,
	tool: SandboxedToolName,
	params: unknown,
	message: string,
	observed: PreloadDenial[] = []
): FailureReport {
	const rules = new PolicyRules(policy);
	const { workspace } = policy;
	const argument = (params as { path?: unknown } | undefined)?.path;
	const candidates = namedPaths(message);
	if (typeof argument === 'string' && tool !== 'bash') candidates.unshift({ path: argument, line: message });

	const denials: SandboxDenial[] = [];
	for (const denial of observed) {
		if (denial.kind !== 'file' || denial.operation === 'connect') continue;
		const target = path.resolve(workspace, denial.target);
		const paths = forms(target);
		const reason =
			denial.operation === 'read' ? (rules.unreadable(paths) ? 'unreadable' : undefined) : rules.unwritable(paths);
		if (reason && denials.every((existing) => !(existing.path === target && existing.operation === denial.operation))) {
			denials.push({ operation: denial.operation, path: target, reason });
		}
	}
	for (const candidate of candidates) {
		const refused = REFUSAL.test(candidate.line);
		if (!refused && !MISSING.test(candidate.line)) continue;
		const target = path.resolve(workspace, candidate.path);
		const paths = forms(target);
		const reading =
			tool === 'bash' ? !WRITE.test(candidate.line) && !RENAME.test(candidate.line) : READ_TOOLS.has(tool);
		let reason: SandboxDenialReason | undefined = rules.unreadable(paths) ? 'unreadable' : undefined;
		// A shell command refused access to a readable path, so it was a write.
		if (!reason && (!reading || (tool === 'bash' && refused))) reason = rules.unwritable(paths);
		if (!reason) continue;
		const operation: SandboxDenialOperation =
			reason === 'unreadable' && reading
				? 'read'
				: RENAME.test(candidate.line)
					? 'rename'
					: existsSync(target)
						? 'write'
						: 'create';
		if (denials.every((denial) => !(denial.path === target && denial.operation === operation))) {
			denials.push({ operation, path: target, reason });
		}
	}

	const connections = observed.filter((denial) => denial.operation === 'connect');
	if (denials.length > 0 || connections.length > 0) {
		const lines = denials.map(
			(denial) => `- ${denial.operation} ${display(workspace, denial.path)}: ${REASON_TEXT[denial.reason]}`
		);
		for (const connection of connections) {
			lines.push(`- connect ${connection.target}: the sandbox blocks this connection`);
		}
		return {
			denials,
			unexplained: false,
			note: `Pau sandbox denied this call:\n${lines.join('\n')}\nRetrying will fail until the operator changes the sandbox policy.`
		};
	}
	if (REFUSAL.test(message)) {
		return {
			denials,
			unexplained: true,
			note: 'Sandboxed failure: this call ran in the Pau sandbox, which may have blocked it. Pau could not identify a denied path.'
		};
	}
	return { denials, unexplained: false, note: '' };
}
