import { describe, expect, it } from 'vitest';

import { CLAUDE_STRUCTURED_ARGS } from '../src/lifecycle.js';
import { claudeArguments, parseBridgeArguments } from '../src/stdio-bridge.js';

describe('stdio bridge arguments', () => {
	it('starts Claude with its own sandbox and no MCP servers when Pau passes settings', () => {
		const options = parseBridgeArguments([
			'--claude',
			'/bin/claude',
			'--cwd',
			'/work',
			'--settings',
			'/host/claude.json'
		]);
		expect(options).toEqual({ claudePath: '/bin/claude', cwd: '/work', settingsPath: '/host/claude.json' });
		expect(claudeArguments(options)).toEqual([
			...CLAUDE_STRUCTURED_ARGS,
			'--settings',
			'/host/claude.json',
			'--strict-mcp-config'
		]);
	});

	it('keeps the structured arguments for an unsandboxed session', () => {
		const options = parseBridgeArguments(['--claude', '/bin/claude', '--cwd', '/work', '--resume', 'native']);
		expect(options).toEqual({ claudePath: '/bin/claude', cwd: '/work', nativeSessionId: 'native' });
		expect(claudeArguments(options)).toEqual(CLAUDE_STRUCTURED_ARGS);
	});

	it('rejects incomplete arguments', () => {
		expect(() => parseBridgeArguments(['--claude', '/bin/claude'])).toThrow('Usage');
		expect(() => parseBridgeArguments(['--settings'])).toThrow('Invalid bridge argument');
	});
});
