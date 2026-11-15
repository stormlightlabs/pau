import { chmodSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { SandboxedMcpServer } from '@stormlightlabs/pau-protocol';
import type { SandboxSession } from './sandbox-session.ts';

/**
 * Serve each contained stdio MCP server on the host-side Unix socket that
 * Pau wrote into the session's MCP configuration. The MCP client connects
 * with its socket transport, and each connection starts the server as a
 * descendant of the sandboxed tool host. The socket stays outside the
 * sandbox because the sandbox's seccomp filter blocks Unix sockets.
 */
export function startMcpRelays(session: SandboxSession, servers: SandboxedMcpServer[]): () => void {
	const listeners = servers.map((server) => {
		rmSync(server.socket, { force: true });
		const listener = net.createServer((connection) => void relay(session, server, connection));
		listener.listen(server.socket, () => chmodSync(server.socket, 0o600));
		return listener;
	});
	return () => {
		for (const listener of listeners) listener.close();
		for (const server of servers) rmSync(server.socket, { force: true });
	};
}

async function relay(session: SandboxSession, server: SandboxedMcpServer, connection: net.Socket): Promise<void> {
	try {
		const client = await session.connect();
		const stream = client.openMcp(
			expandMcpServer(server, session.policy.workspace),
			(data) => connection.write(data),
			(reason) => {
				process.stderr.write(`[pau-sandbox] MCP server ${server.name} ${reason}\n`);
				connection.destroy();
			}
		);
		connection.on('data', (data: Buffer) => stream.write(data));
		connection.once('close', () => stream.close());
	} catch (error) {
		process.stderr.write(`[pau-sandbox] MCP server ${server.name} unavailable: ${String(error)}\n`);
		connection.destroy();
	}
}

/**
 * Expand the `~/`, `${NAME}`, and `$env:NAME` references that Pau leaves in a
 * contained server's command, arguments, working directory, and variables,
 * the way pi-mcp-adapter does for stdio servers. Values come from this
 * process's environment, which is Pau's, so they reach the tool host over
 * its socket and never the policy file. An unset variable expands to
 * nothing, and a relative working directory resolves against the workspace.
 */
export function expandMcpServer(
	server: SandboxedMcpServer,
	workspace: string,
	env: NodeJS.ProcessEnv = process.env
): SandboxedMcpServer {
	const expand = (value: string): string => {
		const home = value.startsWith('~/') && env.HOME !== undefined ? `${env.HOME}/${value.slice(2)}` : value;
		return home.replace(/\$\{([^}]+)\}|\$env:([A-Za-z0-9_]+)/g, (_match, braced?: string, named?: string) => {
			return env[braced ?? named ?? ''] ?? '';
		});
	};
	return {
		...server,
		command: expand(server.command),
		args: server.args.map((arg) => expand(arg)),
		cwd: path.resolve(workspace, expand(server.cwd)),
		env: Object.fromEntries(Object.entries(server.env).map(([name, value]) => [name, expand(value)]))
	};
}
