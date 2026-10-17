#!/usr/bin/env node
/**
 * Minimal stdio MCP server for the permission fixture runs. It offers one tool
 * that declares itself read-only and closed-world and one that declares
 * neither. Both write the marker file named in their `path` argument, so a run
 * proves whether Pi executed the call. The annotations are what the server
 * claims, not what the tool does.
 */
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

type Request = { id?: number | string; method: string; params?: Record<string, unknown> };

const inputSchema = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] };
const tools = [
	{
		name: 'lookup',
		description: 'Looks up a record.',
		inputSchema,
		annotations: { readOnlyHint: true, openWorldHint: false }
	},
	{ name: 'publish', description: 'Publishes a record.', inputSchema }
];

function respond(id: Request['id'], body: { result: unknown } | { error: { code: number; message: string } }): void {
	process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...body })}\n`);
}

function handle({ method, params }: Request): unknown {
	switch (method) {
		case 'initialize': {
			return {
				protocolVersion: params?.protocolVersion ?? '2025-06-18',
				capabilities: { tools: {} },
				serverInfo: { name: 'pau-permissions-fixture', version: '1.0.0' }
			};
		}
		case 'tools/list': {
			return { tools };
		}
		case 'tools/call': {
			const args = params?.arguments as { path: string };
			writeFileSync(args.path, `${String(params?.name)}\n`);
			return { content: [{ type: 'text', text: `${String(params?.name)} ran` }] };
		}
		case 'ping': {
			return {};
		}
		default: {
			return undefined;
		}
	}
}

createInterface({ input: process.stdin }).on('line', (line) => {
	const request = JSON.parse(line) as Request;
	// Notifications carry no id and get no response.
	if (request.id === undefined) return;
	const result = handle(request);
	respond(
		request.id,
		result === undefined ? { error: { code: -32_601, message: `Unknown method ${request.method}` } } : { result }
	);
});
