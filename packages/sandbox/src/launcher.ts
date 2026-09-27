import { spawn, type ChildProcess } from 'node:child_process';
import { SandboxManager, type SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';

/**
 * Raised when Pau cannot prove that the sandbox works. Callers report it and
 * stop; they never retry the command without containment.
 */
export class SandboxUnavailableError extends Error {
	readonly reasons: string[];

	constructor(reasons: string[]) {
		super(`Sandbox unavailable: ${reasons.join('; ')}`);
		this.name = 'SandboxUnavailableError';
		this.reasons = reasons;
	}
}

/** Options for one sandboxed child process. */
export type SandboxSpawnOptions = {
	/** Complete environment. Nothing from the caller's environment is added. */
	env: Record<string, string>;
	cwd: string;
	/** Correlates sandbox-runtime violations with this invocation. */
	commandId: string;
	/** Add a pipe on file descriptor 3 for a structured protocol channel. */
	channel?: boolean;
};

/**
 * Start the wrapped command with standard input closed. Node connects piped
 * standard streams with Unix sockets, and bash treats a socket on standard
 * input as a remote shell login: NixOS then sources the system bashrc and
 * replaces `PATH`, while Debian sources the user's `~/.bashrc`. Structured
 * protocols therefore use file descriptor 3.
 */
function run(command: string, options: SandboxSpawnOptions): ChildProcess {
	return spawn('/bin/sh', ['-c', command], {
		cwd: options.cwd,
		env: options.env,
		stdio: options.channel ? ['ignore', 'pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe']
	});
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

function collect(child: ChildProcess): Promise<{ code: number | null; stderr: string }> {
	let stderr = '';
	child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
	return new Promise((resolve) => child.once('close', (code) => resolve({ code, stderr })));
}

/**
 * Start sandbox-runtime for one policy and prove it with a no-op command.
 *
 * sandbox-runtime reports missing binaries, but it cannot see every
 * restriction that stops Bubblewrap at run time, such as Ubuntu's AppArmor
 * user-namespace limit. The self-test turns those failures into a startup
 * error instead of a failure on the first tool call.
 */
export async function startSandbox(
	config: SandboxRuntimeConfig,
	probeEnv: Record<string, string>,
	cwd: string
): Promise<void> {
	if (!SandboxManager.isSupportedPlatform()) {
		throw new SandboxUnavailableError([`unsupported platform ${process.platform}`]);
	}
	const dependencies = SandboxManager.checkDependencies();
	if (dependencies.errors.length > 0) throw new SandboxUnavailableError(dependencies.errors);
	await SandboxManager.initialize(config);
	const selfTest = await collect(await spawnSandboxed('true', { env: probeEnv, cwd, commandId: 'pau-self-test' }));
	if (selfTest.code === 0) return;
	await SandboxManager.reset();
	throw new SandboxUnavailableError([
		`self-test exited ${selfTest.code}: ${selfTest.stderr.trim() || 'no diagnostic'}`
	]);
}

/** Wrap and start one command inside the initialized sandbox. */
export async function spawnSandboxed(command: string, options: SandboxSpawnOptions): Promise<ChildProcess> {
	// sandbox-runtime replaces TMPDIR with its shared /tmp/claude directory.
	// Restore the per-session directory inside the sandbox.
	const tempDir = options.env.TMPDIR;
	const inner = tempDir ? `export TMPDIR=${shellQuote(tempDir)}; ${command}` : command;
	const wrapped = await SandboxManager.wrapWithSandbox(inner, undefined, undefined, undefined, {
		commandId: options.commandId,
		commandText: command
	});
	return run(wrapped, options);
}

/** Run a sandboxed command to completion. */
export async function runSandboxed(
	command: string,
	options: SandboxSpawnOptions
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	const child = await spawnSandboxed(command, options);
	let stdout = '';
	child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
	const { code, stderr } = await collect(child);
	return { code, stdout, stderr };
}
