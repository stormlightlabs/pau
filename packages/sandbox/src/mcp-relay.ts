import { chmodSync, rmSync } from 'node:fs';
import net from 'node:net';
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
			server,
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
