/**
 * Expansion of the variable references Pau leaves in a contained MCP
 * server's launch, which happens in the extension so values stay off disk.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandMcpServer } from './mcp-relay.ts';

test('expands references from the environment the way pi-mcp-adapter does', () => {
	const env = { HOME: '/home/user', TOKEN: 'mcp-secret-value', TOOLS: '/opt/tools' };
	const server = expandMcpServer(
		{
			name: 'files',
			socket: '/state/host/mcp-0.sock',
			command: '~/bin/files-mcp',
			args: ['--token=${TOKEN}', '$env:TOOLS/config', 'cost $5', '${UNSET}'],
			cwd: 'tools',
			env: { API_TOKEN: '${TOKEN}', MODE: 'ro' }
		},
		'/work',
		env
	);
	assert.equal(server.command, '/home/user/bin/files-mcp');
	assert.deepEqual(server.args, ['--token=mcp-secret-value', '/opt/tools/config', 'cost $5', '']);
	assert.equal(server.cwd, '/work/tools');
	assert.deepEqual(server.env, { API_TOKEN: 'mcp-secret-value', MODE: 'ro' });
	assert.equal(expandMcpServer({ ...server, cwd: '${TOOLS}' }, '/work', env).cwd, '/opt/tools');
});
