import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSeatbeltDenial } from './seatbelt.ts';

test('parses file denials with the responsible process', () => {
	assert.deepEqual(
		parseSeatbeltDenial(
			'2026-10-01 22:03:53.896 E kernel[0:1] (Sandbox) Sandbox: bash(46087) deny(1) file-write-create /tmp/outside/child.txt'
		),
		{ operation: 'create', kind: 'file', target: '/tmp/outside/child.txt', process: { name: 'bash', pid: 46_087 } }
	);
	assert.deepEqual(parseSeatbeltDenial('Sandbox: node(91) deny(1) file-read-data /tmp/private'), {
		operation: 'read',
		kind: 'file',
		target: '/tmp/private',
		process: { name: 'node', pid: 91 }
	});
});

test('parses direct TCP denials with the responsible process', () => {
	assert.deepEqual(parseSeatbeltDenial('Sandbox: node(46141) deny(1) network-outbound remote:*:9'), {
		operation: 'connect',
		kind: 'tcp',
		target: 'remote:*:9',
		process: { name: 'node', pid: 46_141 }
	});
});

test('ignores unrelated Seatbelt operations and malformed process identities', () => {
	assert.equal(parseSeatbeltDenial('Sandbox: node(12) deny(1) sysctl-read kern.iossupportversion'), undefined);
	assert.equal(parseSeatbeltDenial('Sandbox: node(x) deny(1) file-read-data /tmp/private'), undefined);
});
