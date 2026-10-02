/**
 * Denial reports for failed tool calls, checked against a policy from Pau's
 * Rust resolver. The error messages are the ones Node, coreutils, and shells
 * print for sandbox refusals, so this runs without Bubblewrap or Seatbelt.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { explainFailure } from './denials.ts';
import { createFixture, sandboxSettings, SECRET } from './fixture.ts';
import { readPolicyFile, resolvePolicy, type SandboxPolicy } from './policy.ts';

const fixture = createFixture();
const { workspace, home, outside } = fixture;
const policyFor = (homeReadDeny: boolean): SandboxPolicy =>
	readPolicyFile(
		resolvePolicy({
			adapter: 'pi',
			settings: sandboxSettings('workspace-write', { home_read_deny: homeReadDeny }),
			workspace,
			home,
			sessionDirectory: fixture.session,
			toolPath: process.env.PATH ?? ''
		}).policyFile
	);
const policy = policyFor(false);
after(() => rmSync(fixture.root, { recursive: true, force: true }));

test('reports a denied credential read from the read tool', () => {
	const key = path.join(home, '.ssh/id_ed25519');
	const report = explainFailure(policy, 'read', { path: key }, `EACCES: permission denied, open '${key}'`);
	assert.deepEqual(report.denials, [{ operation: 'read', path: key, reason: 'unreadable' }]);
	assert.match(report.note, new RegExp(`- read ${key}: the sandbox blocks access`));
});

test('reports a denied workspace secret read from a shell command', () => {
	const report = explainFailure(
		policy,
		'bash',
		{ command: 'cat .env' },
		'cat: .env: Permission denied\n\nCommand exited with code 1'
	);
	assert.deepEqual(report.denials, [{ operation: 'read', path: path.join(workspace, '.env'), reason: 'unreadable' }]);
	assert.match(report.note, /- read \.env: /);
});

test('reports a read that a masked directory hides as missing', () => {
	const key = path.join(home, '.ssh/id_ed25519');
	const report = explainFailure(
		policy,
		'bash',
		{},
		`cat: ${key}: No such file or directory\n\nCommand exited with code 1`
	);
	assert.deepEqual(report.denials, [{ operation: 'read', path: key, reason: 'unreadable' }]);
});

test('reports a write to protected configuration', () => {
	const file = path.join(workspace, '.pi/settings.json');
	const report = explainFailure(
		policy,
		'edit',
		{ path: '.pi/settings.json' },
		`Could not edit file: .pi/settings.json. EROFS: read-only file system, open '${file}'.`
	);
	assert.deepEqual(report.denials, [{ operation: 'write', path: file, reason: 'protected' }]);
	assert.match(report.note, /- write \.pi\/settings\.json: the sandbox keeps this path read-only/);
});

test('reports a shell write to a readable protected path', () => {
	const report = explainFailure(
		policy,
		'bash',
		{},
		'bash: line 1: .git/config: Permission denied\n\nCommand exited with code 1'
	);
	assert.deepEqual(report.denials, [
		{ operation: 'write', path: path.join(workspace, '.git/config'), reason: 'protected' }
	]);
});

test('reports a create outside the writable folders', () => {
	const file = path.join(outside, 'escape.txt');
	const report = explainFailure(policy, 'write', { path: file }, `EACCES: permission denied, open '${file}'`);
	assert.deepEqual(report.denials, [{ operation: 'create', path: file, reason: 'outside-writable' }]);
	assert.match(report.note, /outside the folders the sandbox can write/);
});

test('reports a shell create in a protected directory', () => {
	const report = explainFailure(
		policy,
		'bash',
		{},
		"touch: cannot touch '.git/hooks/post-merge': Read-only file system\n\nCommand exited with code 1"
	);
	assert.deepEqual(report.denials, [
		{ operation: 'create', path: path.join(workspace, '.git/hooks/post-merge'), reason: 'protected' }
	]);
});

test('reports only the denied side of a rename', () => {
	const shell = explainFailure(
		policy,
		'bash',
		{},
		"mv: cannot move 'README.md' to '.pi/README.md': Read-only file system\n\nCommand exited with code 1"
	);
	assert.deepEqual(shell.denials, [
		{ operation: 'rename', path: path.join(workspace, '.pi/README.md'), reason: 'protected' }
	]);
	const node = explainFailure(
		policy,
		'bash',
		{},
		`Error: EACCES: permission denied, rename '${path.join(workspace, 'README.md')}' -> '${path.join(outside, 'README.md')}'`
	);
	assert.deepEqual(node.denials, [
		{ operation: 'rename', path: path.join(outside, 'README.md'), reason: 'outside-writable' }
	]);
});

test('follows home read-deny with workspace and secret exceptions', () => {
	const strict = policyFor(true);
	const notes = path.join(home, 'notes.txt');
	assert.equal(
		explainFailure(strict, 'read', { path: notes }, `EACCES: permission denied, open '${notes}'`).denials[0]?.reason,
		'unreadable'
	);
	assert.equal(explainFailure(strict, 'read', { path: 'README.md' }, 'EACCES: permission denied').unexplained, true);
	assert.equal(
		explainFailure(strict, 'read', { path: '.env' }, 'EACCES: permission denied').denials[0]?.reason,
		'unreadable'
	);
	assert.equal(explainFailure(strict, 'read', { path: '.env.example' }, 'EACCES: permission denied').denials.length, 0);
});

test('uses preload observations when a program omits the denied target', () => {
	const file = path.join(workspace, '.pi/settings.json');
	const report = explainFailure(policy, 'bash', {}, 'Operation not permitted', [
		{ operation: 'write', kind: 'file', target: file },
		{ operation: 'connect', kind: 'tcp', target: '203.0.113.10:443' }
	]);
	assert.deepEqual(report.denials, [{ operation: 'write', path: file, reason: 'protected' }]);
	assert.match(report.note, /- connect 203\.0\.113\.10:443: the sandbox blocks this connection/);
});

test('labels a refusal with no denied path as a sandboxed failure', () => {
	const report = explainFailure(
		policy,
		'bash',
		{},
		'curl: (7) Failed to connect to 93.184.215.14 port 443: Network is unreachable\n\nCommand exited with code 7'
	);
	assert.deepEqual(report.denials, []);
	assert.equal(report.unexplained, true);
	assert.match(report.note, /^Sandboxed failure: /);
	const allowed = explainFailure(policy, 'bash', {}, 'cat: src/app.ts: Permission denied');
	assert.equal(allowed.unexplained, true);
});

test('adds nothing to ordinary failures', () => {
	const missing = explainFailure(
		policy,
		'read',
		{ path: 'missing.txt' },
		`ENOENT: no such file or directory, open '${workspace}/missing.txt'`
	);
	assert.deepEqual(missing, { denials: [], unexplained: false, note: '' });
	const aborted = explainFailure(policy, 'write', { path: path.join(outside, 'x') }, 'Operation aborted');
	assert.equal(aborted.note, '');
	const edit = explainFailure(policy, 'edit', { path: 'src/app.ts' }, 'Could not find the exact text in src/app.ts.');
	assert.equal(edit.note, '');
});

test('reports only fixed text and the denied path', () => {
	const key = path.join(home, '.aws/credentials');
	const message = [
		`TOKEN=${SECRET}`,
		`HOME=${home}`,
		`cat: ${key}: Permission denied`,
		`ls: ${path.join(outside, 'notes.txt')}: No such file or directory`,
		'Command exited with code 1'
	].join('\n');
	const report = explainFailure(policy, 'bash', {}, message);
	assert.deepEqual(report.denials, [{ operation: 'read', path: key, reason: 'unreadable' }]);
	assert.ok(!report.note.includes(SECRET));
	assert.ok(!report.note.includes(outside));
	assert.equal(report.note.replaceAll(key, '').includes(home), false);
});
