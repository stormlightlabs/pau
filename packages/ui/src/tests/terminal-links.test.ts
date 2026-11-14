import { describe, expect, test } from 'vitest';

import { findTerminalPaths } from '../lib/terminal-links';

const paths = (text: string) => findTerminalPaths(text).map(({ path, line, column }) => ({ path, line, column }));

describe('findTerminalPaths', () => {
	test.each([
		['src/main.rs', { path: 'src/main.rs' }],
		['./packages/ui/src/index.ts', { path: 'packages/ui/src/index.ts' }],
		['.github/workflows/ci.yml', { path: '.github/workflows/ci.yml' }],
		['node_modules/@xterm/xterm/package.json', { path: 'node_modules/@xterm/xterm/package.json' }],
		['src/lib.rs:12', { path: 'src/lib.rs', line: 12 }],
		['src/lib.rs:12:5', { path: 'src/lib.rs', line: 12, column: 5 }]
	])('finds %s', (text, expected) => {
		expect(paths(text)).toEqual([{ line: undefined, column: undefined, ...expected }]);
	});

	test('finds paths inside compiler and test runner output', () => {
		expect(paths('  --> crates/term/src/modes.rs:48:9')).toEqual([
			{ path: 'crates/term/src/modes.rs', line: 48, column: 9 }
		]);
		expect(paths(' FAIL  src/tests/a.test.ts > opens (12 ms)')).toEqual([
			{ path: 'src/tests/a.test.ts', line: undefined, column: undefined }
		]);
		expect(paths('error in "src/app.css", see (src/app.ts:3).')).toEqual([
			{ path: 'src/app.css', line: undefined, column: undefined },
			{ path: 'src/app.ts', line: 3, column: undefined }
		]);
	});

	test('reports where each match starts and ends, suffix included', () => {
		expect(findTerminalPaths('at src/a.ts:4: oops')).toEqual([
			{ path: 'src/a.ts', line: 4, column: undefined, start: 3, end: 13 }
		]);
	});

	test.each([
		['a version number', 'v1.2.3 and 1.2.3'],
		['a word pair', 'and/or'],
		['a date', '2026/11/13'],
		['a parent directory', '../secrets/key.pem'],
		['a parent directory inside a path', 'src/../../etc/passwd.txt'],
		['an absolute path', '/etc/hosts.conf'],
		['a home path', '~/notes.md'],
		['a variable path', '$HOME/notes.md'],
		['a web address', 'https://example.com/docs/index.html'],
		['a bare domain', 'www.example.com/page.html'],
		['an email address', 'someone@example.com'],
		['a file without an extension', 'src/Makefile'],
		['a hidden file without an extension', '.env'],
		['a Windows path', String.raw`C:\Users\me\file.txt`],
		['a bare file name', 'README.md'],
		['a bare file name after ./', './README.md']
	])('ignores %s', (_, text) => {
		expect(paths(text)).toEqual([]);
	});
});
