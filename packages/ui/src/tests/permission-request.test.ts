import { describe, expect, test } from 'vitest';

import { permissionTitle } from '../fixtures/bay';
import { permissionDecision, permissionQuestion, permissionRequest } from '../lib/permission-request';

const select = (title: string) => ({
	id: 'dialog',
	kind: 'select' as const,
	title,
	options: ['allow_once', 'allow_session', 'deny']
});

describe('permissionRequest', () => {
	test("reads Pau's permission envelope from a select dialog", () => {
		expect(permissionRequest(select(permissionTitle))).toMatchObject({
			id: 'dialog',
			tool: 'edit',
			operation: 'write',
			paths: ['crates/server/src/sessions.rs'],
			reason: 'Writes outside the plan ask first.',
			options: ['allow_once', 'allow_session', 'deny']
		});
	});

	test.each([
		['a plain title', select('Pick a model')],
		['other JSON', select('{"kind":"other"}')],
		['broken JSON', select('{"pau":"permission"')],
		['a confirm dialog', { id: 'dialog', kind: 'confirm' as const, title: permissionTitle, message: 'Sure?' }]
	])('leaves %s to the extension dialog', (_name, dialog) => {
		expect(permissionRequest(dialog)).toBeUndefined();
	});
});

/** The question for an envelope with these fields. */
function ask(fields: object) {
	const request = permissionRequest(select(JSON.stringify({ pau: 'permission', ...fields })));
	return permissionQuestion(request!);
}

describe('permissionQuestion', () => {
	test('asks to run a command', () => {
		expect(ask({ tool: 'bash', command: 'pnpm install' })).toEqual({
			before: 'Run ',
			target: 'pnpm install',
			after: '?'
		});
	});

	test('asks for network access', () => {
		expect(ask({ tool: 'fetch', destination: 'registry.npmjs.org' })).toMatchObject({ target: 'registry.npmjs.org' });
	});

	test('names the first path and counts the rest', () => {
		expect(ask({ tool: 'write', operation: 'write', paths: ['a.rs', 'b.rs', 'c.rs'] })).toEqual({
			before: 'Allow write to ',
			target: 'a.rs',
			after: ' and 2 more?'
		});
	});

	test('falls back to the tool', () => {
		expect(ask({ tool: 'browser' })).toEqual({ before: 'Allow browser?', after: '' });
	});
});

test('labels each decision with its key, and an unknown option as written', () => {
	expect(permissionDecision('allow_once')).toEqual({ label: 'Allow once', key: 'y' });
	expect(permissionDecision('allow_session')).toEqual({ label: 'Allow for session', key: 'a' });
	expect(permissionDecision('deny')).toEqual({ label: 'Deny', key: 'n' });
	expect(permissionDecision('later')).toEqual({ label: 'later' });
});
