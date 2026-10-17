/**
 * The per-session policy file and the rules each profile starts from.
 *
 * Pau merges user and project rules, adds its protected paths, and writes the
 * result to the file named by `PAU_PERMISSION_POLICY_FILE`. The extension
 * reads only that file. It never reads Pi's own settings or upstream's
 * configuration files.
 */
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import * as v from 'valibot';

/** The environment variable that names the policy file. */
export const POLICY_FILE_ENV = 'PAU_PERMISSION_POLICY_FILE';

/** A rule surface: a tool name, a bash command unit, or a path access. */
export type Surface = 'tool' | 'bash' | 'read' | 'write';

/** What a matching rule does. */
export type Action = 'allow' | 'ask' | 'deny';

/** Where a rule came from, as reported in requests. */
export type RuleSource = 'profile' | 'protected' | 'user' | 'project' | 'session';

/** One ordered rule. The last matching rule wins. */
export type Rule = {
	source: RuleSource;
	surface: Surface;
	pattern: string;
	action: Action;
	/** A denial reason passed to the agent. */
	reason?: string;
};

const absolutePath = v.pipe(
	v.string(),
	v.check((value) => path.isAbsolute(value), 'must be an absolute path')
);

const ReasonSchema = v.pipe(v.string(), v.maxLength(500));
const RuleSchema = v.strictObject({
	source: v.picklist(['protected', 'user', 'project']),
	// `path` is shorthand for one `read` rule and one `write` rule.
	surface: v.picklist(['tool', 'bash', 'read', 'write', 'path']),
	pattern: v.pipe(v.string(), v.minLength(1)),
	action: v.picklist(['allow', 'ask', 'deny']),
	reason: v.optional(ReasonSchema)
});

/** The policy file schema, version 1. */
export const PolicyFileSchema = v.strictObject({
	version: v.literal(1),
	profile: v.picklist(['confirm-writes', 'confirm-mutating']),
	workspace: absolutePath,
	/** How long a request waits for an answer before it is denied. */
	dialogTimeoutMs: v.pipe(v.number(), v.integer(), v.minValue(1000), v.maxValue(86_400_000)),
	rules: v.array(RuleSchema)
});

/** A confirming permission profile. */
export type Profile = v.InferOutput<typeof PolicyFileSchema>['profile'];

/** A loaded policy with `path` rules expanded and the profile layer prepended. */
export type Policy = { profile: Profile; workspace: string; dialogTimeoutMs: number; rules: Rule[] };

/** The outcome of reading the policy file. A failure blocks every gated call. */
export type PolicyLoad = { ok: true; policy: Policy } | { ok: false; error: string };

/**
 * Read and validate the policy file named by `PAU_PERMISSION_POLICY_FILE`.
 * Never throws: a missing variable, unreadable file, malformed JSON, or schema
 * violation is returned as an error.
 */
export function loadPolicy(env: NodeJS.ProcessEnv = process.env): PolicyLoad {
	const file = env[POLICY_FILE_ENV];
	if (!file) return { ok: false, error: `${POLICY_FILE_ENV} is not set` };
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(file, 'utf8'));
	} catch (error) {
		return { ok: false, error: `cannot read ${file}: ${(error as Error).message}` };
	}
	const parsed = v.safeParse(PolicyFileSchema, raw);
	if (!parsed.success) {
		const issue = parsed.issues[0];
		const at = v.getDotPath(issue);
		return { ok: false, error: `invalid policy file ${file}: ${at ? `${at}: ` : ''}${issue.message}` };
	}
	return { ok: true, policy: buildPolicy(parsed.output, file) };
}

function buildPolicy(file: v.InferOutput<typeof PolicyFileSchema>, policyFile: string): Policy {
	const fileRules = file.rules.flatMap(({ surface, ...rule }): Rule[] =>
		surface === 'path'
			? [
					{ ...rule, surface: 'read' },
					{ ...rule, surface: 'write' }
				]
			: [{ ...rule, surface }]
	);
	return {
		profile: file.profile,
		workspace: file.workspace,
		dialogTimeoutMs: file.dialogTimeoutMs,
		rules: [
			...profileRules(file.workspace),
			...fileRules,
			// Applied last so no rule can let the agent rewrite its own policy.
			{ source: 'protected', surface: 'write', pattern: policyFile, action: 'deny' }
		]
	};
}

/** Built-in tools whose effect is fully described by the path they are given. */
const PATH_TOOLS = ['read', 'grep', 'find', 'ls', 'write', 'edit'];

/**
 * The rules both confirming profiles share. Workspace reads pass, other reads
 * and every write ask, and every tool other than the built-in path tools asks.
 * The path tools pass the tool surface because their path rules decide them.
 * Read-only `bash` commands and annotated MCP tools are decided in the gate
 * because a pattern cannot express them.
 */
function profileRules(workspace: string): Rule[] {
	const rule = (surface: Surface, pattern: string, action: Action): Rule => ({
		source: 'profile',
		surface,
		pattern,
		action
	});
	// The gate decides on the symlink-resolved path, so a workspace spelled
	// through a symlink (`/tmp` on macOS) must match in its resolved form too.
	const roots = [...new Set([workspace, realpathOr(workspace)])];
	return [
		rule('tool', '*', 'ask'),
		...PATH_TOOLS.map((name) => rule('tool', name, 'allow')),
		rule('bash', '*', 'ask'),
		rule('read', '*', 'ask'),
		...roots.flatMap((root) => [rule('read', root, 'allow'), rule('read', path.join(root, '*'), 'allow')]),
		rule('write', '*', 'ask')
	];
}

function realpathOr(file: string): string {
	try {
		return realpathSync(file);
	} catch {
		return file;
	}
}
