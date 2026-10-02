import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { parsePreloadDenials, PreloadDenialLog } from './preload.ts';

const root = mkdtempSync(path.join(tmpdir(), 'pau-preload-log-'));
const report = path.join(root, 'denials.log');
after(() => rmSync(root, { recursive: true, force: true }));

test('parses versioned file and connection denial records', () => {
	assert.deepEqual(
		parsePreloadDenials('PAU1\tread\tfile\t/work/a\\tb\\x20c\nPAU1\tconnect\ttcp\t203.0.113.10:443\npartial'),
		[
			{ operation: 'read', kind: 'file', target: '/work/a\tb c' },
			{ operation: 'connect', kind: 'tcp', target: '203.0.113.10:443' }
		]
	);
});

test('ignores unknown versions, fields, and malformed escapes', () => {
	assert.deepEqual(
		parsePreloadDenials(
			'PAU2\tread\tfile\t/a\nPAU1\tremove\tfile\t/a\nPAU1\tread\tpipe\t/a\nPAU1\tread\tfile\t/a\\q\n'
		),
		[]
	);
});

test('reads only records appended after a checkpoint', () => {
	writeFileSync(report, 'PAU1\tread\tfile\t/old\n');
	const log = new PreloadDenialLog(report);
	const checkpoint = log.checkpoint();
	writeFileSync(report, 'PAU1\tconnect\tunix\t/run/service.sock\n', { flag: 'a' });
	assert.deepEqual(log.readAfter(checkpoint), [{ operation: 'connect', kind: 'unix', target: '/run/service.sock' }]);
});
