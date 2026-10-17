/**
 * Policy evaluation for one tool call.
 *
 * A call is split into items: the tool itself, each path it reads or writes,
 * and, for `bash`, each command unit. Each item gets an action from the last
 * matching rule, and the most restrictive item decides the call: deny, then
 * ask, then allow. Session approvals only turn asks into allows.
 */
import type { AccessPath } from '#src/access-intent/access-path';
import { pathFlavorForPlatform } from '#src/path/path-flavor';
import { PathNormalizer } from '#src/path/path-normalizer';
import { wildcardMatch } from '#src/policy/wildcard-matcher';
import { suggestBashPattern } from '#src/presentation/pattern-suggest';
import { analyzeBash, type BashUnit } from './bash.ts';
import type { Action, Policy, Rule, RuleSource, Surface } from './policy.ts';
import type { Grant, SessionApprovals } from './session-approvals.ts';

/** A tool call as Pi passes it to the `tool_call` handler. */
export type ToolCall = { toolName: string; toolCallId: string; input: Record<string, unknown> };

/** The MCP annotations the gate trusts. Servers declare them; nobody verifies them. */
export type ToolAnnotations = { readOnlyHint?: boolean; openWorldHint?: boolean };

/** The kind of operation a request describes. */
export type Operation = 'read' | 'write' | 'command' | 'mcp' | 'network' | 'tool';

/** Why a call asks or is denied. */
export type Reason =
	| 'protected'
	| 'rule'
	| 'outside_workspace'
	| 'write'
	| 'command'
	| 'network'
	| 'wrapper'
	| 'unparsed'
	| 'mcp_unannotated'
	| 'tool';

/** A path the call accesses, in its symlink-resolved form when one exists. */
export type RequestPath = { path: string; access: 'read' | 'write'; outsideWorkspace: boolean };

/** The rule that decided a call. Synthetic patterns are wrapped in `<>`. */
export type MatchedRule = { source: RuleSource; pattern: string; action: Action };

/** The gate's verdict on one call. */
export type Evaluation = {
	action: Action;
	/** Set when every item allowed and at least one allow came from a session approval. */
	bySession: boolean;
	tool: string;
	operation: Operation;
	command?: string;
	paths: RequestPath[];
	destination?: string;
	matchedRule: MatchedRule;
	reason?: Reason;
	/** A denial reason written into a policy rule, passed to the agent. */
	ruleReason?: string;
	/** What an `allow_session` answer grants. Empty unless the call asks. */
	sessionScope: Grant[];
};

type Item = {
	action: Action;
	rule: MatchedRule;
	reason?: Reason;
	ruleReason?: string;
	bySession: boolean;
	grants: Grant[];
};

/** Built-in tools whose first argument is a path. */
const PATH_TOOLS: Record<string, 'read' | 'write'> = {
	read: 'read',
	grep: 'read',
	find: 'read',
	ls: 'read',
	write: 'write',
	edit: 'write'
};

/** Pi's MCP tool names and pi-mcp-adapter's proxy tool. */
const isMcpTool = (name: string): boolean => name.startsWith('mcp__') || name === 'mcp';

/**
 * Evaluates tool calls against one loaded policy. It reads session approvals
 * but never records them; the controller does that after an operator answers.
 */
export class Gate {
	readonly #policy: Policy;
	readonly #approvals: SessionApprovals;
	readonly #annotationsOf: (tool: string) => ToolAnnotations | undefined;
	readonly #normalizer: PathNormalizer;

	constructor(
		policy: Policy,
		approvals: SessionApprovals,
		annotationsOf: (tool: string) => ToolAnnotations | undefined
	) {
		this.#policy = policy;
		this.#approvals = approvals;
		this.#annotationsOf = annotationsOf;
		this.#normalizer = new PathNormalizer(pathFlavorForPlatform(process.platform), policy.workspace);
	}

	/** Evaluate every unit and path of a command, appending items. */
	async #bashItems(
		command: string,
		items: Item[],
		addPath: (access: 'read' | 'write', path: AccessPath) => void
	): Promise<BashUnit[]> {
		// The whole command is the only surface a deny rule can reach when the
		// parse found no unit, and an empty or comment-only command has nothing
		// else to decide on.
		const whole = (reason: Reason): Item => {
			const rule = this.#match('bash', [command]);
			if (rule.action === 'deny') return this.#denyItem(rule);
			const grants: Grant[] = [{ surface: 'bash', pattern: command.trim() }];
			const item: Item =
				reason === 'unparsed'
					? { action: 'ask', rule: synthetic('profile', reason, 'ask'), reason, bySession: false, grants }
					: { ...this.#base(rule, reason), grants };
			return this.#lift(item, [command]);
		};
		let analysis;
		try {
			analysis = await analyzeBash(command, this.#normalizer);
		} catch {
			// The parser could not load or crashed. Nothing about the command is known.
			items.push(whole('unparsed'));
			return [];
		}
		if (analysis.unparsed) items.push(whole('unparsed'));
		else if (analysis.units.length === 0) items.push(whole('command'));
		for (const unit of analysis.units) items.push(this.#unitItem(unit, command));
		for (const { access, path } of analysis.paths) addPath(access, path);
		return analysis.units;
	}

	#unitItem(unit: BashUnit, command: string): Item {
		const values = [unit.text, ...unit.spellings];
		const rule = this.#match('bash', values);
		if (rule.action === 'deny') return this.#denyItem(rule);
		const fallback: Reason = unit.wrapper
			? 'wrapper'
			: unit.unparsed
				? 'unparsed'
				: unit.network
					? 'network'
					: 'command';
		let item: Item = {
			...this.#base(rule, fallback),
			grants: [{ surface: 'bash', pattern: suggestBashPattern(unit.text) }]
		};
		if (rule.source === 'profile' && this.#policy.profile === 'confirm-mutating' && unit.readOnly) {
			item = { ...item, action: 'allow', rule: synthetic('profile', 'read-only-command', 'allow') };
			delete item.reason;
		}
		// A wrapper hides what runs and an unparsed unit is not evidence of what
		// runs, so neither may ride an allow. The session check below still lets
		// an explicit approval of this exact unit through.
		if (item.action === 'allow' && (unit.wrapper || unit.unparsed)) {
			item = { ...item, action: 'ask', rule: synthetic('profile', fallback, 'ask'), reason: fallback };
		}
		// A unit the parser could not resolve is approved by the whole command,
		// so a session grant cannot cover more than the operator saw.
		if (unit.unparsed && !unit.wrapper) item.grants = [{ surface: 'bash', pattern: command.trim() }];
		return this.#lift(item, values);
	}

	#pathItem(access: 'read' | 'write', path: AccessPath, outside: boolean): Item {
		const options = this.#normalizer.flavor.matchOptions;
		const values = path.matchValues();
		// Any spelling hitting a deny denies. Otherwise the resolved path decides,
		// so a workspace symlink to an outside file is treated as outside.
		const denied = values.map((value) => this.#match(access, [value])).find((rule) => rule.action === 'deny');
		if (denied) return this.#denyItem(denied);
		const rule = this.#match(access, [path.boundaryValue() || path.value()]);
		const fallback: Reason = access === 'write' ? 'write' : outside ? 'outside_workspace' : 'rule';
		const grants = this.#normalizer.approvalPatternsFor(path).map((pattern) => ({ surface: access, pattern }));
		const item = { ...this.#base(rule, fallback), grants };
		if (item.action !== 'ask') return item;
		const grant = this.#approvals.covering(access, values, options);
		return grant ? { ...item, ...this.#sessionAllow(grant) } : item;
	}

	#toolItem(tool: string): Item {
		const rule = this.#match('tool', [tool]);
		if (rule.action === 'deny') return this.#denyItem(rule);
		const mcp = isMcpTool(tool);
		const item = {
			...this.#base(rule, mcp ? 'mcp_unannotated' : 'tool'),
			grants: [{ surface: 'tool' as const, pattern: tool }]
		};
		const hints = mcp ? this.#annotationsOf(tool) : undefined;
		if (rule.source === 'profile' && hints?.readOnlyHint === true && hints.openWorldHint === false) {
			return {
				...item,
				action: 'allow',
				rule: synthetic('profile', 'mcp-read-only-closed-world', 'allow'),
				reason: undefined
			};
		}
		return this.#lift(item, [tool]);
	}

	/** The last rule on `surface` matching any of `values`. The profile layer always matches. */
	#match(surface: Surface, values: readonly string[]): Rule {
		const options = surface === 'read' || surface === 'write' ? this.#normalizer.flavor.matchOptions : undefined;
		const rule = this.#policy.rules.findLast(
			(candidate) =>
				candidate.surface === surface && values.some((value) => wildcardMatch(candidate.pattern, value, options))
		);
		return rule ?? { source: 'profile', surface, pattern: '*', action: 'ask' };
	}

	/** An item from a rule; profile asks take the item's own reason, other rules report `rule`. */
	#base(rule: Rule, fallback: Reason): Omit<Item, 'grants'> {
		const matched = { source: rule.source, pattern: rule.pattern, action: rule.action };
		if (rule.action === 'allow') return { action: 'allow', rule: matched, bySession: false };
		return {
			action: rule.action,
			rule: matched,
			reason: rule.source === 'profile' ? fallback : 'rule',
			bySession: false
		};
	}

	#denyItem(rule: Rule): Item {
		return {
			action: 'deny',
			rule: { source: rule.source, pattern: rule.pattern, action: 'deny' },
			reason: rule.source === 'protected' ? 'protected' : 'rule',
			...(rule.reason && { ruleReason: rule.reason }),
			bySession: false,
			grants: []
		};
	}

	/** Turn an ask into an allow when a session approval covers it. */
	#lift(item: Item, values: readonly string[]): Item {
		if (item.action !== 'ask') return item;
		const surface = item.grants[0]?.surface;
		const grant = surface && this.#approvals.covering(surface, values);
		return grant ? { ...item, ...this.#sessionAllow(grant) } : item;
	}

	#sessionAllow(grant: Grant): Pick<Item, 'action' | 'rule' | 'reason' | 'bySession'> {
		return {
			action: 'allow',
			rule: { source: 'session', pattern: grant.pattern, action: 'allow' },
			reason: undefined,
			bySession: true
		};
	}

	#isOutside(path: AccessPath): boolean {
		const canonical = path.boundaryValue();
		return !canonical || this.#normalizer.isBoundaryOutsideWorkingDirectory(canonical);
	}

	async evaluate(call: ToolCall): Promise<Evaluation> {
		const { toolName: tool } = call;
		const items: Item[] = [];
		const paths: RequestPath[] = [];
		const addPath = (access: 'read' | 'write', path: AccessPath): void => {
			const outsideWorkspace = this.#isOutside(path);
			paths.push({ path: path.boundaryValue() || path.value(), access, outsideWorkspace });
			items.push(this.#pathItem(access, path, outsideWorkspace));
		};
		let operation: Operation;
		let command: string | undefined;
		let destination: string | undefined;

		if (tool === 'bash') {
			// The profile decides `bash` per command unit, so the tool surface
			// counts only when a policy rule names the tool.
			if (this.#match('tool', [tool]).source !== 'profile') items.push(this.#toolItem(tool));
			command = typeof call.input.command === 'string' ? call.input.command : '';
			const units = await this.#bashItems(command, items, addPath);
			destination = units.find((unit) => unit.network?.destination)?.network?.destination;
			operation = units.some((unit) => unit.network) ? 'network' : 'command';
		} else {
			items.push(this.#toolItem(tool));
			const access = PATH_TOOLS[tool];
			if (access) {
				const raw = typeof call.input.path === 'string' && call.input.path !== '' ? call.input.path : '.';
				addPath(access, this.#normalizer.forToolPath(tool, raw));
				operation = access;
			} else {
				operation = isMcpTool(tool) ? 'mcp' : 'tool';
			}
		}

		const winner =
			items.find((item) => item.action === 'deny') ?? items.find((item) => item.action === 'ask') ?? items[0];
		if (!winner) throw new Error('a tool call produced nothing to evaluate');
		const asking = winner.action === 'ask' ? items.filter((item) => item.action === 'ask') : [];
		return {
			action: winner.action,
			bySession: winner.action === 'allow' && items.some((item) => item.bySession),
			tool,
			operation,
			...(command !== undefined && { command }),
			paths,
			...(destination && { destination }),
			matchedRule: winner.rule,
			...(winner.reason && { reason: winner.reason }),
			...(winner.ruleReason && { ruleReason: winner.ruleReason }),
			sessionScope: uniqueGrants(asking.flatMap((item) => item.grants))
		};
	}
}

function synthetic(source: RuleSource, name: string, action: Action): MatchedRule {
	return { source, pattern: `<${name}>`, action };
}

function uniqueGrants(grants: Grant[]): Grant[] {
	const seen = new Map(grants.map((grant) => [`${grant.surface}\0${grant.pattern}`, grant]));
	return seen.values().toArray();
}
