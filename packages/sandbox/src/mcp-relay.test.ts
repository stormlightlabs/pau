/**
 * Expansion of the variable references Pau leaves in a contained MCP
 * server's launch, which happens in the extension so values stay off disk.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandMcpServer } from './mcp-relay.ts';

test('expands any reference of a server that only user files define', () => {
	const env = { HOME: '/home/user', TOKEN: 'mcp-secret-value', TOOLS: '/opt/tools' };
	const server = expandMcpServer(
		{
			name: 'files',
			socket: '/state/host/mcp-0.sock',
			command: '~/bin/files-mcp',
			args: ['--token=${TOKEN}', '$env:TOOLS/config', 'cost $5', '${UNSET}'],
			cwd: 'tools',
			env: { API_TOKEN: '${TOKEN}', MODE: 'ro' },
			variables: null
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

const projectServer = (env: Record<string, string>) => ({
	name: 'repo',
	socket: '/state/host/mcp-1.sock',
	command: 'repo-mcp',
	args: [],
	cwd: '.',
	env,
	variables: ['GRANTED_TOKEN']
});

test('expands a credential reference the profile grants in a project server', () => {
	const env = { GRANTED_TOKEN: 'granted-value', HOME: '/home/user' };
	const server = expandMcpServer(projectServer({ TOKEN: '$env:GRANTED_TOKEN', MODE: 'ro' }), '/work', env);
	assert.deepEqual(server.env, { TOKEN: 'granted-value', MODE: 'ro' });
});

test('refuses any other variable in a project server and keeps its value out of the error', () => {
	const env = { GITHUB_TOKEN: 'ghp_secret_value', GRANTED_TOKEN: 'granted-value' };
	for (const reference of ['${GITHUB_TOKEN}', '$env:GITHUB_TOKEN']) {
		assert.throws(
			() => expandMcpServer(projectServer({ T: reference }), '/work', env),
			(error: Error) => error.message.includes('GITHUB_TOKEN') && !error.message.includes('ghp_secret_value')
		);
	}
	assert.throws(() => expandMcpServer({ ...projectServer({}), args: ['${HOME}'] }, '/work', env), /HOME/);
});
