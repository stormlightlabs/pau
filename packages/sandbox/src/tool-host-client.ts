import { spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import { getAgentDir, type AgentToolResult } from '@earendil-works/pi-coding-agent';
import { spawnSandboxed, startSandbox } from './launcher.ts';
import { buildRuntimeConfig, buildToolEnvironment, type SandboxPolicyInput } from './profile.ts';
import type {
	SandboxedToolName,
	ToolHostRequest,
	ToolHostRequestBody,
	ToolHostResponse,
	ToolSession
} from './tool-host-protocol.ts';

/** Find a search binary the way Pi does: its agent `bin` directory, then `PATH`. */
function resolveSearchTool(name: string, searchPath: string): string | undefined {
	const managed = path.join(getAgentDir(), 'bin', name);
	if (existsSync(managed)) return managed;
	const found = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8', env: { PATH: searchPath } });
	return found.status === 0 ? found.stdout.trim() : undefined;
}

/**
 * Give the tool host its own Pi agent directory. It keeps the host away from
 * Pi's settings and credential store and puts the ripgrep wrapper where Pi
 * looks first.
 */
function prepareAgentDir(tempDir: string, searchPath: string): Record<string, string> {
	const agentDir = path.join(tempDir, 'pi-agent');
	const bin = path.join(agentDir, 'bin');
	mkdirSync(bin, { recursive: true });
	const env: Record<string, string> = { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1' };
	const rg = resolveSearchTool('rg', searchPath);
	if (rg) {
		const wrapper = fileURLToPath(new URL('rg-wrapper.ts', import.meta.url));
		writeFileSync(
			path.join(bin, 'rg'),
			`#!/bin/sh
exec ${process.execPath} ${wrapper} "$@"
`,
			{ mode: 0o755 }
		);
		env.PAU_REAL_RG = rg;
	}
	const fd = resolveSearchTool('fd', searchPath);
	if (fd && !existsSync(path.join(bin, 'fd'))) symlinkSync(fd, path.join(bin, 'fd'));
	return env;
}

type Pending = { onResponse: (response: ToolHostResponse) => void };

/**
 * Host-side connection to one sandboxed tool host. Every request goes to the
 * sandbox; when the host is unavailable the request fails instead of running
 * in the Pi process.
 */
export class ToolHostClient {
	/**
	 * Start the sandbox for `policy` and launch the tool host inside it. The
	 * promise rejects with {@link SandboxUnavailableError} when containment
	 * cannot be proven.
	 */
	static async start(policy: SandboxPolicyInput, searchPath: string): Promise<ToolHostClient> {
		const env = {
			...buildToolEnvironment({ home: policy.home, tempDir: policy.tempDir, searchPath }),
			...prepareAgentDir(policy.tempDir, searchPath)
		};
		await startSandbox(buildRuntimeConfig(policy), env, policy.workspace);
		const script = fileURLToPath(new URL('tool-host.ts', import.meta.url));
		try {
			const child = await spawnSandboxed(`exec ${process.execPath} ${script}`, {
				env,
				cwd: policy.workspace,
				commandId: 'pau-tool-host',
				channel: true
			});
			const client = new ToolHostClient(child);
			await client.ready;
			return client;
		} catch (error) {
			await SandboxManager.reset();
			throw error;
		}
	}

	private readonly channel: Duplex;
	private readonly pending = new Map<string, Pending>();
	private nextId = 0;
	private exited = false;

	readonly child: ChildProcess;
	/** Process ID reported by the tool host from inside the sandbox. */
	readonly ready: Promise<number>;

	private constructor(child: ChildProcess) {
		this.child = child;
		this.channel = child.stdio[3] as Duplex;
		let stderr = '';
		child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
		this.ready = new Promise((resolve, reject) => {
			this.pending.set('ready', {
				onResponse: (response) => {
					this.pending.delete('ready');
					if (response.kind === 'ready') resolve(response.pid);
					else reject(new Error(`tool host failed to start: ${stderr.trim()}`));
				}
			});
		});
		createInterface({ input: this.channel }).on('line', (line) => {
			const response = JSON.parse(line) as ToolHostResponse;
			this.pending.get(response.id)?.onResponse(response);
		});
		child.once('exit', (code, signal) => {
			this.exited = true;
			const reason = `sandboxed tool host exited (${signal ?? code})`;
			for (const [id, pending] of this.pending) pending.onResponse({ id, kind: 'error', message: reason });
			this.pending.clear();
		});
	}

	private request(
		body: ToolHostRequestBody,
		signal: AbortSignal | undefined,
		onResponse: (response: ToolHostResponse, done: () => void) => void
	): Promise<void> {
		if (this.exited) return Promise.reject(new Error('sandboxed tool host is not running'));
		const id = `${this.nextId++}`;
		return new Promise((resolve) => {
			const done = (): void => {
				this.pending.delete(id);
				signal?.removeEventListener('abort', abort);
				resolve();
			};
			const abort = (): void => this.send({ id, kind: 'abort' });
			signal?.addEventListener('abort', abort, { once: true });
			this.pending.set(id, { onResponse: (response) => onResponse(response, done) });
			this.send({ ...body, id } as ToolHostRequest);
		});
	}

	private send(request: ToolHostRequest): void {
		this.channel.write(`${JSON.stringify(request)}\n`);
	}

	/** Run one built-in tool call inside the sandbox. */
	async executeTool(
		call: { tool: SandboxedToolName; toolCallId: string; params: unknown; session: ToolSession },
		signal: AbortSignal | undefined,
		onUpdate: ((update: AgentToolResult<unknown>) => void) | undefined
	): Promise<AgentToolResult<unknown>> {
		let outcome: AgentToolResult<unknown> | Error = new Error('tool host returned no result');
		await this.request({ kind: 'tool', ...call }, signal, (response, done) => {
			if (response.kind === 'update') {
				onUpdate?.(response.update);
				return;
			}
			if (response.kind === 'result') outcome = response.result;
			else if (response.kind === 'error') outcome = new Error(response.message);
			else return;
			done();
		});
		if (outcome instanceof Error) throw outcome;
		return outcome;
	}

	/** Run an operator `!` command inside the sandbox and stream its output. */
	async executeBash(
		command: string,
		options: { onData: (data: Buffer) => void; signal?: AbortSignal; timeout?: number }
	): Promise<{ exitCode: number | null }> {
		let outcome: Error | { exitCode: number | null } = new Error('tool host returned no exit');
		await this.request({ kind: 'bash', command, timeout: options.timeout }, options.signal, (response, done) => {
			if (response.kind === 'data') {
				options.onData(Buffer.from(response.data, 'base64'));
				return;
			}
			if (response.kind === 'exit') outcome = { exitCode: response.exitCode };
			else if (response.kind === 'error') outcome = new Error(response.message);
			else return;
			done();
		});
		if (outcome instanceof Error) throw outcome;
		return outcome;
	}

	/** Stop the tool host and release sandbox-runtime proxies and mount points. */
	async stop(): Promise<void> {
		this.channel.end();
		if (!this.exited) this.child.kill('SIGTERM');
		await SandboxManager.reset();
	}
}
