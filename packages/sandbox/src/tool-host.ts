#!/usr/bin/env node
/**
 * Sandboxed Pi tool host. It runs inside the OS sandbox, executes Pi's own
 * built-in tool implementations, and exchanges JSON lines with the Pi
 * extension over file descriptor 3.
 *
 * The host never loads Pi's model registry or credential store. It only sees
 * the workspace, the policy's readable paths, and the minimal environment that
 * the launcher built.
 */
import net from 'node:net';
import { createInterface } from 'node:readline';
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLocalBashOperations,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ExtensionContext
} from '@earendil-works/pi-coding-agent';
import type { ToolHostRequest, ToolHostResponse } from './tool-host-protocol.ts';

const cwd = process.cwd();
const tools = {
	read: createReadToolDefinition(cwd),
	write: createWriteToolDefinition(cwd),
	edit: createEditToolDefinition(cwd),
	bash: createBashToolDefinition(cwd),
	grep: createGrepToolDefinition(cwd),
	find: createFindToolDefinition(cwd),
	ls: createLsToolDefinition(cwd)
};
const channel = new net.Socket({ fd: 3, readable: true, writable: true });
const running = new Map<string, AbortController>();

function send(response: ToolHostResponse): void {
	channel.write(`${JSON.stringify(response)}\n`);
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function handle(request: ToolHostRequest): Promise<void> {
	if (request.kind === 'abort') {
		running.get(request.id)?.abort();
		return;
	}
	const controller = new AbortController();
	running.set(request.id, controller);
	try {
		if (request.kind === 'tool') {
			const tool = tools[request.tool];
			// Built-in tools read only these context fields. The host has no Pi
			// session, so the extension forwards the values bash exposes.
			const { session } = request;
			const context = {
				cwd,
				sessionManager: { getSessionId: () => session.id, getSessionFile: () => session.file },
				model: session.model,
				thinkingLevel: session.thinkingLevel
			} as unknown as ExtensionContext;
			const result = await tool.execute(
				request.toolCallId,
				request.params as never,
				controller.signal,
				(update) => send({ id: request.id, kind: 'update', update }),
				context
			);
			send({ id: request.id, kind: 'result', result });
		} else {
			const { exitCode } = await createLocalBashOperations().exec(request.command, cwd, {
				onData: (data) => send({ id: request.id, kind: 'data', data: data.toString('base64') }),
				signal: controller.signal,
				timeout: request.timeout
			});
			send({ id: request.id, kind: 'exit', exitCode });
		}
	} catch (error) {
		send({ id: request.id, kind: 'error', message: message(error) });
	} finally {
		running.delete(request.id);
	}
}

createInterface({ input: channel }).on('line', (line) => {
	void handle(JSON.parse(line) as ToolHostRequest);
});
channel.on('close', () => process.exit(0));
send({ id: 'ready', kind: 'ready', pid: process.pid });
