/**
 * The check that fails a sandboxed session closed when an MCP adapter Pau
 * did not detect would start servers in the Pi process.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unsandboxedMcp } from './pi-extension.ts';

const tool = (name: string, path = '/home/user/.pi/agent/extensions/mcp.ts') => ({ name, sourceInfo: { path } });
const ownMcp = { name: 'mcp' };

test('fails closed when an undetected adapter registers MCP tools', () => {
	const policy = { mcpConfig: null };
	for (const tools of [
		[tool('mcp')],
		[tool('mcp__github__search')],
		[tool('github_search', '/home/user/.pi/agent/git/pi-mcp-adapter/index.ts')]
	]) {
		const reason = unsandboxedMcp(policy, [tool('read', 'builtin:read'), ...tools], [ownMcp]);
		assert.match(reason ?? '', /outside the sandbox/);
	}
	assert.match(unsandboxedMcp(policy, [], [{ name: 'mcp:1' }, { name: 'mcp:2' }]) ?? '', /registered \/mcp/);
});

test('passes a session without MCP tools or with a session MCP configuration', () => {
	assert.equal(unsandboxedMcp({ mcpConfig: null }, [tool('read', 'builtin:read')], [ownMcp]), null);
	assert.equal(
		unsandboxedMcp({ mcpConfig: '/state/session/mcp.json' }, [tool('mcp__files__read')], [ownMcp, { name: 'mcp:2' }]),
		null
	);
});
