import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadPolicy, POLICY_FILE_ENV } from '../src/policy.ts';
import { createFixture, type Fixture, writePolicy } from './fixture.ts';

const fixture: Fixture = createFixture();
afterAll(() => rmSync(fixture.root, { recursive: true, force: true }));

const load = (file: string | undefined) => loadPolicy(file === undefined ? {} : { [POLICY_FILE_ENV]: file });

function loadJson(value: unknown) {
	writeFileSync(fixture.policyFile, typeof value === 'string' ? value : JSON.stringify(value));
	return load(fixture.policyFile);
}

const valid = () => ({
	version: 1,
	profile: 'confirm-writes',
	workspace: fixture.workspace,
	dialogTimeoutMs: 300_000,
	rules: []
});

describe('loadPolicy', () => {
	it('reports a missing environment variable', () => {
		expect(load(undefined)).toEqual({ ok: false, error: `${POLICY_FILE_ENV} is not set` });
	});

	it('reports a missing file', () => {
		const result = load(path.join(fixture.root, 'missing.json'));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('cannot read');
	});

	it('reports malformed JSON', () => {
		const result = loadJson('{"version": 1,');
		expect(result.ok).toBe(false);
	});

	it.each([
		['an unknown version', { version: 2 }, 'version'],
		['an unknown profile', { profile: 'no-prompts' }, 'profile'],
		['a relative workspace', { workspace: 'workspace' }, 'workspace'],
		['a short dialog timeout', { dialogTimeoutMs: 10 }, 'dialogTimeoutMs'],
		['an unknown field', { extra: true }, 'extra'],
		[
			'a rule with an unknown source',
			{ rules: [{ source: 'session', surface: 'bash', pattern: '*', action: 'allow' }] },
			'rules.0.source'
		],
		[
			'a rule with an empty pattern',
			{ rules: [{ source: 'user', surface: 'bash', pattern: '', action: 'allow' }] },
			'rules.0.pattern'
		]
	])('rejects %s', (_label, change, at) => {
		const result = loadJson({ ...valid(), ...change });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain(at);
	});

	it('expands path rules, puts the profile first, and protects the policy file last', () => {
		const result = load(writePolicy(fixture, { rules: [] }));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const { rules } = result.policy;
		expect(rules[0]).toEqual({ source: 'profile', surface: 'tool', pattern: '*', action: 'ask' });
		const ssh = rules.filter((rule) => rule.pattern === path.join(fixture.home, '.ssh'));
		expect(ssh.map((rule) => rule.surface)).toEqual(['read', 'write']);
		expect(rules.at(-1)).toEqual({
			source: 'protected',
			surface: 'write',
			pattern: fixture.policyFile,
			action: 'deny'
		});
	});
});
