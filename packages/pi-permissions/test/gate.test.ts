import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Gate, type ToolAnnotations } from '../src/gate.ts';
import { loadPolicy, POLICY_FILE_ENV } from '../src/policy.ts';
import { type Grant, SessionApprovals } from '../src/session-approvals.ts';
import { createFixture, type FileRule, type Fixture, writePolicy } from './fixture.ts';

const fixture: Fixture = createFixture();
afterAll(() => rmSync(fixture.root, { recursive: true, force: true }));

type Setup = {
	profile?: 'confirm-writes' | 'confirm-mutating';
	rules?: FileRule[];
	grants?: Grant[];
	annotations?: Record<string, ToolAnnotations>;
};

function gate({ profile, rules, grants = [], annotations = {} }: Setup = {}): Gate {
	const load = loadPolicy({ [POLICY_FILE_ENV]: writePolicy(fixture, { profile, rules }) });
	if (!load.ok) throw new Error(load.error);
	const approvals = new SessionApprovals();
	approvals.add(grants);
	return new Gate(load.policy, approvals, (name) => annotations[name]);
}

const call = (toolName: string, input: Record<string, unknown>) => ({ toolName, toolCallId: 'call-1', input });
const bash = (command: string, setup?: Setup) => gate(setup).evaluate(call('bash', { command }));
const user = (
	surface: FileRule['surface'],
	pattern: string,
	action: FileRule['action'],
	reason?: string
): FileRule => ({ source: 'user', surface, pattern, action, ...(reason && { reason }) });

describe('built-in path tools', () => {
	it('allows workspace reads without asking', async () => {
		for (const tool of ['read', 'grep', 'find', 'ls']) {
			const result = await gate().evaluate(call(tool, { path: 'README.md', pattern: 'x' }));
			expect(result.action, tool).toBe('allow');
			expect(result.operation).toBe('read');
		}
	});

	it('asks for a read outside the workspace and offers its directory for the session', async () => {
		const file = path.join(fixture.outside, 'notes.txt');
		const result = await gate().evaluate(call('read', { path: file }));
		expect(result).toMatchObject({
			action: 'ask',
			reason: 'outside_workspace',
			paths: [{ path: file, access: 'read', outsideWorkspace: true }],
			matchedRule: { source: 'profile', pattern: '*', action: 'ask' },
			sessionScope: [{ surface: 'read', pattern: `${fixture.outside}/*` }]
		});
	});

	it('denies protected credentials through read, including through a workspace symlink', async () => {
		for (const target of [path.join(fixture.home, '.ssh/id_ed25519'), 'key-link', '.env']) {
			const result = await gate().evaluate(call('read', { path: target }));
			expect(result, target).toMatchObject({ action: 'deny', reason: 'protected' });
			expect(result.matchedRule.source).toBe('protected');
		}
	});

	it('keeps sample files such as .env.example readable', async () => {
		await expect(gate().evaluate(call('read', { path: '.env.example' }))).resolves.toMatchObject({ action: 'allow' });
	});

	it('asks for every write, even inside the workspace', async () => {
		for (const tool of ['write', 'edit']) {
			const result = await gate().evaluate(call(tool, { path: 'new.txt' }));
			expect(result).toMatchObject({ action: 'ask', reason: 'write', operation: 'write' });
			expect(result.paths[0]).toMatchObject({ access: 'write', outsideWorkspace: false });
		}
	});

	it('denies writes to its own policy file whatever the rules say', async () => {
		const result = await gate({ rules: [user('path', '*', 'allow')] }).evaluate(
			call('write', { path: fixture.policyFile })
		);
		expect(result).toMatchObject({ action: 'deny', reason: 'protected' });
	});

	it('lets a user rule relax a protected path', async () => {
		const result = await gate({ rules: [user('read', path.join(fixture.workspace, '.env'), 'allow')] }).evaluate(
			call('read', { path: '.env' })
		);
		expect(result.action).toBe('allow');
	});

	it('reports a project rule that narrows workspace reads', async () => {
		const rule: FileRule = { source: 'project', surface: 'read', pattern: '*/README.md', action: 'ask' };
		const result = await gate({ rules: [rule] }).evaluate(call('read', { path: 'README.md' }));
		expect(result).toMatchObject({ action: 'ask', reason: 'rule', matchedRule: { source: 'project' } });
	});
});

describe('bash under confirm-writes', () => {
	it('asks for every command, even one that only reads', async () => {
		const result = await bash('cat README.md', { profile: 'confirm-writes' });
		expect(result).toMatchObject({ action: 'ask', reason: 'command', operation: 'command', command: 'cat README.md' });
		expect(result.sessionScope).toEqual([{ surface: 'bash', pattern: 'cat *' }]);
	});

	it('allows a command a user rule allows', async () => {
		const result = await bash('git status --short', {
			profile: 'confirm-writes',
			rules: [user('bash', 'git status *', 'allow')]
		});
		expect(result).toMatchObject({ action: 'allow', matchedRule: { source: 'user', pattern: 'git status *' } });
	});

	it('denies protected reads through cat', async () => {
		const result = await bash(`cat ${path.join(fixture.home, '.ssh/id_ed25519')}`, { profile: 'confirm-writes' });
		expect(result).toMatchObject({ action: 'deny', reason: 'protected' });
	});
});

describe('bash under confirm-mutating', () => {
	it('allows commands the analysis proves read-only', async () => {
		for (const command of ['ls', 'cat README.md', 'grep -n readme README.md | wc -l', 'find . -name "*.md"']) {
			const result = await bash(command);
			expect(result.action, command).toBe('allow');
			expect(result.matchedRule).toEqual({ source: 'profile', pattern: '<read-only-command>', action: 'allow' });
		}
	});

	it.each([
		['a write redirect', 'cat README.md > out.txt'],
		['find -delete', 'find . -name "*.tmp" -delete'],
		['sed -i', 'sed -i s/a/b/ README.md'],
		['sort -o', 'sort -o sorted.txt README.md'],
		['an unknown command', 'mytool README.md'],
		['a path-qualified reader', './cat README.md'],
		['a mutating unit in a chain', 'ls && rm -rf build']
	])('asks for %s', async (_label, command) => {
		await expect(bash(command)).resolves.toMatchObject({ action: 'ask' });
	});

	it('names the mutating unit of a chain in its session scope', async () => {
		const result = await bash('ls && rm README.md');
		expect(result.sessionScope).toEqual([
			{ surface: 'bash', pattern: 'rm *' },
			{ surface: 'write', pattern: `${fixture.workspace}/*` }
		]);
	});

	it('denies protected reads through cat, a substitution, and a symlink', async () => {
		for (const command of [
			`cat ${path.join(fixture.home, '.ssh/id_ed25519')}`,
			`echo "$(cat ${path.join(fixture.home, '.ssh/id_ed25519')})"`,
			'cat key-link',
			'head -1 .env'
		]) {
			expect(await bash(command), command).toMatchObject({ action: 'deny', reason: 'protected' });
		}
	});

	it('asks for a read outside the workspace', async () => {
		const result = await bash(`cat ${path.join(fixture.outside, 'notes.txt')}`);
		expect(result).toMatchObject({ action: 'ask', reason: 'outside_workspace' });
		expect(result.paths).toContainEqual({
			path: path.join(fixture.outside, 'notes.txt'),
			access: 'read',
			outsideWorkspace: true
		});
	});

	it.each([
		['bash -c', 'bash -c "ls"'],
		['sh -c', "sh -c 'cat README.md'"],
		['eval', 'eval ls'],
		['sudo', 'sudo cat README.md'],
		['env', 'env cat README.md'],
		['xargs', 'echo README.md | xargs cat'],
		['find -exec', 'find . -exec cat {} ;'],
		['time', 'time ls'],
		['nohup', 'nohup cat README.md']
	])('asks for the %s wrapper, even when a rule allows everything', async (_label, command) => {
		const result = await bash(command, { rules: [user('bash', '*', 'allow')] });
		expect(result).toMatchObject({ action: 'ask', reason: 'wrapper' });
		expect(result.matchedRule).toEqual({ source: 'profile', pattern: '<wrapper>', action: 'ask' });
	});

	it.each(['confirm-writes', 'confirm-mutating'] as const)(
		'reports a wrapper as the reason under %s',
		async (profile) => {
			const result = await bash('bash -c "touch out.txt"', { profile });
			expect(result).toMatchObject({ action: 'ask', reason: 'wrapper' });
			expect(result.sessionScope).toEqual([{ surface: 'bash', pattern: 'bash -c "touch out.txt"' }]);
		}
	);

	it('keeps an explicit deny on a wrapper', async () => {
		const result = await bash('sudo rm -rf build', { rules: [user('bash', 'sudo *', 'deny', 'No sudo here')] });
		expect(result).toMatchObject({ action: 'deny', reason: 'rule', ruleReason: 'No sudo here' });
	});

	it('asks for network commands and names the destination', async () => {
		const result = await bash('curl -fsS https://example.com/install.sh');
		expect(result).toMatchObject({
			action: 'ask',
			operation: 'network',
			reason: 'network',
			destination: 'example.com'
		});
		await expect(bash('git push origin main')).resolves.toMatchObject({ operation: 'network' });
		await expect(bash('ssh deploy@build.example.org uptime')).resolves.toMatchObject({
			destination: 'build.example.org'
		});
	});

	it('asks for a command that does not parse, even when a rule allows everything', async () => {
		const result = await bash("cat 'README.md", { rules: [user('bash', '*', 'allow')] });
		expect(result).toMatchObject({ action: 'ask', reason: 'unparsed' });
		expect(result.sessionScope).toEqual([{ surface: 'bash', pattern: "cat 'README.md" }]);
	});

	it('denies an unparsed command that a deny rule names whole', async () => {
		const result = await bash(') rm -rf /', { rules: [user('bash', '*rm -rf*', 'deny')] });
		expect(result.action).toBe('deny');
	});

	it('passes a user deny reason to the agent', async () => {
		const result = await bash('git push origin main', {
			rules: [user('bash', 'git push *', 'deny', 'Push from the release script')]
		});
		expect(result).toMatchObject({ action: 'deny', ruleReason: 'Push from the release script' });
	});

	it('lets a tool rule deny bash as a whole', async () => {
		await expect(bash('ls', { rules: [user('tool', 'bash', 'deny')] })).resolves.toMatchObject({ action: 'deny' });
	});
});

describe('MCP and extension tools', () => {
	const closed = { readOnlyHint: true, openWorldHint: false };

	it.each(['confirm-writes', 'confirm-mutating'] as const)(
		'allows an MCP tool annotated read-only and closed-world under %s',
		async (profile) => {
			const result = await gate({ profile, annotations: { mcp__docs__search: closed } }).evaluate(
				call('mcp__docs__search', {})
			);
			expect(result).toMatchObject({ action: 'allow', operation: 'mcp' });
			expect(result.matchedRule.pattern).toBe('<mcp-read-only-closed-world>');
		}
	);

	it.each([
		['no annotations', undefined],
		['an open-world tool', { readOnlyHint: true, openWorldHint: true }],
		['a tool that writes', { readOnlyHint: false, openWorldHint: false }],
		['a missing openWorldHint', { readOnlyHint: true }]
	])('asks for an MCP tool with %s', async (_label, hints) => {
		const result = await gate({ annotations: hints ? { mcp__docs__search: hints } : {} }).evaluate(
			call('mcp__docs__search', {})
		);
		expect(result).toMatchObject({ action: 'ask', reason: 'mcp_unannotated' });
		expect(result.sessionScope).toEqual([{ surface: 'tool', pattern: 'mcp__docs__search' }]);
	});

	it('asks for the pi-mcp-adapter proxy tool, which has no per-tool annotations', async () => {
		await expect(gate().evaluate(call('mcp', { tool: 'search' }))).resolves.toMatchObject({ action: 'ask' });
	});

	it('ignores annotations on tools that are not MCP tools', async () => {
		const result = await gate({ annotations: { deploy: closed } }).evaluate(call('deploy', {}));
		expect(result).toMatchObject({ action: 'ask', reason: 'tool', operation: 'tool' });
	});

	it('lets a deny rule override annotations', async () => {
		const result = await gate({
			annotations: { mcp__docs__search: closed },
			rules: [user('tool', 'mcp__docs__*', 'deny')]
		}).evaluate(call('mcp__docs__search', {}));
		expect(result.action).toBe('deny');
	});
});

const grant = (surface: Grant['surface'], pattern: string): Grant => ({ surface, pattern });

describe('session approvals', () => {
	it('allows a later command its pattern covers', async () => {
		const result = await bash('touch other.txt', { grants: [grant('bash', 'touch *'), grant('write', '*')] });
		expect(result).toMatchObject({ action: 'allow', bySession: true });
	});

	it('does not cover the other units of a chain', async () => {
		const result = await bash('touch a.txt && rm b.txt', { grants: [grant('bash', 'touch *'), grant('write', '*')] });
		expect(result).toMatchObject({ action: 'ask', command: 'touch a.txt && rm b.txt' });
		expect(result.sessionScope).toEqual([{ surface: 'bash', pattern: 'rm *' }]);
	});

	it('never overrides a deny', async () => {
		const result = await gate({ grants: [grant('read', '*'), grant('tool', '*')] }).evaluate(
			call('read', { path: path.join(fixture.home, '.ssh/id_ed25519') })
		);
		expect(result.action).toBe('deny');
	});

	it('covers other files in an approved outside directory, but not its siblings', async () => {
		const setup = { grants: [grant('read', `${fixture.outside}/*`)] };
		const inside = await gate(setup).evaluate(call('read', { path: path.join(fixture.outside, 'other/notes.txt') }));
		expect(inside).toMatchObject({ action: 'allow', bySession: true });
		const sibling = await gate(setup).evaluate(call('read', { path: `${fixture.outside}-evil/notes.txt` }));
		expect(sibling.action).toBe('ask');
	});

	it('honors a grant recorded for a command typed with ~', async () => {
		const result = await bash('~/.local/bin/indexer', {
			profile: 'confirm-writes',
			grants: [grant('bash', '~/.local/bin/indexer')]
		});
		expect(result).toMatchObject({ action: 'allow', bySession: true });
	});

	// Upstream 40.0.2 (#1033): a session grant on one bash unit must not
	// approve the chain's other asking units.
	describe('a grant covers only the unit it names', () => {
		const rules = [user('bash', '*', 'allow'), user('bash', 'git push *', 'ask')];

		it('asks for a rule-asking unit that follows the granted one', async () => {
			const result = await bash('sudo rm y && git push origin main', {
				rules,
				grants: [grant('bash', 'sudo rm y'), grant('write', '*')]
			});
			expect(result).toMatchObject({ action: 'ask', reason: 'rule' });
			expect(result.matchedRule).toEqual({ source: 'user', pattern: 'git push *', action: 'ask' });
		});

		it('asks for a floored wrapper beside the granted one', async () => {
			const result = await bash('sudo rm y && sudo rm z', {
				rules,
				grants: [grant('bash', 'sudo rm y'), grant('write', '*')]
			});
			expect(result).toMatchObject({ action: 'ask', reason: 'wrapper' });
			expect(result.sessionScope).toEqual([{ surface: 'bash', pattern: 'sudo rm *' }]);
		});

		it('allows a lone granted wrapper under the grant pattern', async () => {
			const result = await bash('sudo rm y', { rules, grants: [grant('bash', 'sudo rm y'), grant('write', '*')] });
			expect(result).toMatchObject({ action: 'allow', bySession: true });
		});

		it('allows a chain whose every unit the session granted', async () => {
			const result = await bash('sudo rm y && sudo rm z', {
				rules,
				grants: [grant('bash', 'sudo rm y'), grant('bash', 'sudo rm z'), grant('write', '*')]
			});
			expect(result).toMatchObject({ action: 'allow', bySession: true });
		});
	});
});
