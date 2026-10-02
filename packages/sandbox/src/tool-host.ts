#!/usr/bin/env node
/**
 * Sandboxed Pi tool host. It runs inside the OS sandbox, executes Pi's own
 * built-in tool implementations and supported stdio MCP servers, and
 * exchanges JSON lines with the Pi extension over file descriptor 3.
 *
 * The host never loads Pi's model registry or credential store. It only sees
 * the workspace, the policy's readable paths, and the minimal environment that
 * the launcher built. Every process it starts inherits the same sandbox.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
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
	type AgentToolResult,
	type ExtensionContext
} from '@earendil-works/pi-coding-agent';
import type { SandboxedMcpServer } from '@stormlightlabs/pau-protocol';
import { PreloadDenialLog } from './preload.ts';
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
const placeholders = new Set<string>(JSON.parse(process.env.PAU_SANDBOX_PLACEHOLDERS ?? '[]') as string[]);
const channel = new net.Socket({ fd: 3, readable: true, writable: true });
const running = new Map<string, AbortController>();
const servers = new Map<string, ChildProcessWithoutNullStreams>();
/** Serializes grep calls, whose skipped-file report uses a process-wide variable. */
const grepLock = { busy: false, waiters: [] as (() => void)[] };
const denialLog = new PreloadDenialLog();
const denialState = { offset: 0 };

/** Forward each native report once without assigning it to a concurrent call. */
function flushDenials(): void {
	const drained = denialLog.drainAfter(denialState.offset);
	denialState.offset = drained.nextOffset;
	if (drained.denials.length > 0) send({ id: 'denial', kind: 'denial', denials: drained.denials });
}

async function acquireGrep(): Promise<void> {
	if (!grepLock.busy) {
		grepLock.busy = true;
		return;
	}
	// The releasing call hands the lock over without clearing it.
	await new Promise<void>((resolve) => {
		grepLock.waiters.push(resolve);
	});
}

function releaseGrep(): void {
	const next = grepLock.waiters.shift();
	if (next) next();
	else grepLock.busy = false;
}

function send(response: ToolHostResponse): void {
	channel.write(`${JSON.stringify(response)}\n`);
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Run grep and add the files the sandbox kept it from reading. The ripgrep
 * wrapper records them in the file named by `PAU_RG_SKIPPED`, which is
 * process-wide, so grep calls run one at a time.
 */
async function runGrep(run: () => Promise<AgentToolResult<unknown>>, id: string): Promise<AgentToolResult<unknown>> {
	const skippedFile = path.join(process.env.TMPDIR ?? cwd, `pau-rg-skipped-${process.pid}-${id}`);
	await acquireGrep();
	process.env.PAU_RG_SKIPPED = skippedFile;
	try {
		const outcome = await run();
		const skipped = readSkipped(skippedFile);
		if (skipped.length === 0) return outcome;
		const note = `Sandbox skipped ${skipped.length} unreadable ${skipped.length === 1 ? 'file' : 'files'}; the search is incomplete:\n${skipped.join('\n')}`;
		return { ...outcome, content: [...outcome.content, { type: 'text' as const, text: note }] };
	} finally {
		delete process.env.PAU_RG_SKIPPED;
		rmSync(skippedFile, { force: true });
		releaseGrep();
	}
}

function readSkipped(file: string): string[] {
	let lines: string[];
	try {
		lines = readFileSync(file, 'utf8').split('\n');
	} catch {
		return [];
	}
	const unique = new Set(lines.filter((line) => line && !placeholders.has(path.resolve(cwd, line))));
	return [...unique].sort((left, right) => left.localeCompare(right));
}

/**
 * Start one stdio MCP server as a descendant of the tool host, so it gets
 * the same filesystem, network, and environment policy as every tool.
 */
function openServer(id: string, server: SandboxedMcpServer): void {
	const child = spawn(server.command, server.args, {
		cwd: server.cwd,
		env: { ...process.env, ...server.env },
		stdio: ['pipe', 'pipe', 'pipe']
	});
	servers.set(id, child);
	child.stdout.on('data', (chunk: Buffer) => {
		flushDenials();
		send({ id, kind: 'data', data: chunk.toString('base64') });
	});
	child.stderr.on('data', (chunk: Buffer) => {
		flushDenials();
		process.stderr.write(`[mcp:${server.name}] ${chunk.toString()}`);
	});
	child.once('error', (error) => {
		servers.delete(id);
		send({ id, kind: 'error', message: `MCP server ${server.name} failed to start: ${error.message}` });
	});
	child.once('exit', (code) => {
		if (!servers.delete(id)) return;
		flushDenials();
		send({ id, kind: 'exit', exitCode: code });
	});
}

async function handle(request: ToolHostRequest): Promise<void> {
	switch (request.kind) {
		case 'abort': {
			running.get(request.id)?.abort();
			return;
		}
		case 'network': {
			// Commands inherit this process's environment when they start.
			process.env.NO_PROXY = request.noProxy;
			process.env.no_proxy = request.noProxy;
			return;
		}
		case 'mcp-open': {
			openServer(request.id, request.server);
			return;
		}
		case 'mcp-write': {
			servers.get(request.id)?.stdin.write(Buffer.from(request.data, 'base64'));
			return;
		}
		case 'mcp-close': {
			servers.get(request.id)?.kill('SIGTERM');
			return;
		}
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
			const execute = (): Promise<AgentToolResult<unknown>> =>
				tool.execute(
					request.toolCallId,
					request.params as never,
					controller.signal,
					(update) => send({ id: request.id, kind: 'update', update }),
					context
				) as Promise<AgentToolResult<unknown>>;
			const result = request.tool === 'grep' ? await runGrep(execute, request.id) : await execute();
			flushDenials();
			send({ id: request.id, kind: 'result', result });
		} else {
			const { exitCode } = await createLocalBashOperations().exec(request.command, cwd, {
				onData: (data) => send({ id: request.id, kind: 'data', data: data.toString('base64') }),
				signal: controller.signal,
				timeout: request.timeout
			});
			flushDenials();
			send({ id: request.id, kind: 'exit', exitCode });
		}
	} catch (error) {
		flushDenials();
		send({ id: request.id, kind: 'error', message: message(error) });
	} finally {
		running.delete(request.id);
	}
}

createInterface({ input: channel }).on('line', (line) => {
	void handle(JSON.parse(line) as ToolHostRequest);
});
channel.on('close', () => {
	for (const server of servers.values()) server.kill('SIGTERM');
	process.exit(0);
});
send({ id: 'ready', kind: 'ready', pid: process.pid });
