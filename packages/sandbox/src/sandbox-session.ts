import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { updateNetwork } from './launcher.ts';
import { classifyChange, readPolicyFile, type SandboxPolicy } from './policy.ts';
import { ToolHostClient } from './tool-host-client.ts';

/** Operator notice about a policy change. */
export type SandboxNotice = (message: string, level: 'info' | 'warning' | 'error') => void;

/**
 * One session's sandboxed tool host and the policy file Pau writes for it.
 *
 * Pau rewrites the policy file to change grants. Network grants reach the
 * running sandbox at once. Filesystem rules are fixed when the tool host
 * starts, so a filesystem change waits for the tool calls in flight, then
 * restarts the host before the next call. A failed start is kept: every call
 * reports it and nothing runs in the Pi process.
 */
export class SandboxSession {
	readonly #policyFile: string;
	readonly #searchPath: string;
	readonly #notify: SandboxNotice;
	#policy: SandboxPolicy;
	#pending: SandboxPolicy | undefined;
	#host: Promise<ToolHostClient> | undefined;
	#client: ToolHostClient | undefined;
	#restarting: Promise<void> | undefined;
	#active = 0;
	#idle: (() => void)[] = [];
	#watcher: FSWatcher | undefined;

	constructor(policyFile: string, searchPath: string, notify: SandboxNotice) {
		this.#policyFile = policyFile;
		this.#searchPath = searchPath;
		this.#notify = notify;
		this.#policy = readPolicyFile(policyFile);
	}

	async #start(): Promise<ToolHostClient> {
		const started = this.#policy;
		const client = await ToolHostClient.start(started, this.#searchPath);
		this.#client = client;
		// A network change that arrived while the host was starting.
		if (this.#policy !== started) {
			updateNetwork(this.#policy.runtimeConfig);
			client.setNoProxy(this.#policy.noProxy);
		}
		return client;
	}

	#restart(): Promise<void> {
		this.#restarting ??= this.#restartWhenIdle();
		return this.#restarting;
	}

	async #restartWhenIdle(): Promise<void> {
		try {
			if (this.#active > 0) {
				await new Promise<void>((resolve) => {
					this.#idle.push(resolve);
				});
			}
			await this.#stopHost();
			if (this.#pending) this.#policy = this.#pending;
			this.#pending = undefined;
			this.#notify('The sandboxed tool host restarted with the new filesystem access.', 'info');
		} finally {
			this.#restarting = undefined;
		}
	}

	async #stopHost(): Promise<void> {
		const host = this.#host;
		this.#host = undefined;
		this.#client = undefined;
		if (!host) return;
		try {
			const client = await host;
			await client.stop();
		} catch {
			// A failed start has already released the sandbox.
		}
	}

	/** The policy that the current tool host enforces. */
	get policy(): SandboxPolicy {
		return this.#policy;
	}

	/** Watch the policy file. Pau replaces it with a rename. */
	watch(): void {
		const name = path.basename(this.#policyFile);
		this.#watcher = watch(path.dirname(this.#policyFile), (_event, changed) => {
			if (changed === name) this.reload();
		});
	}

	/** Read the policy file and apply what changed. */
	reload(): void {
		let next: SandboxPolicy;
		try {
			next = readPolicyFile(this.#policyFile);
		} catch (error) {
			// Keep enforcing the current policy rather than a partial one.
			this.#notify(`Pau could not read the new sandbox policy: ${String(error)}`, 'error');
			return;
		}
		const base = this.#pending ?? this.#policy;
		const change = classifyChange(base, next);
		if (change === 'restart') {
			this.#pending = next;
			this.#notify('Filesystem access changed. The sandboxed tool host restarts after the current tool call.', 'info');
			return;
		}
		if (this.#pending) this.#pending = next;
		else this.#policy = next;
		if (!(change === 'network' && this.#client?.running) || this.#pending) {
			return;
		}

		updateNetwork(next.runtimeConfig);
		this.#client.setNoProxy(next.noProxy);
		this.#notify('Network access for the sandbox changed.', 'info');
	}

	/**
	 * Run one operation against the tool host. Operations started while a
	 * restart is pending wait for it.
	 */
	async run<T>(operation: (client: ToolHostClient) => Promise<T>): Promise<T> {
		if (this.#pending) await this.#restart();
		this.#active++;
		try {
			return await operation(await this.connect());
		} finally {
			this.#active--;
			if (this.#active === 0) for (const resolve of this.#idle.splice(0)) resolve();
		}
	}

	/**
	 * Return the running tool host, starting it on first use. Long-lived
	 * connections such as MCP relays use this directly so they do not hold
	 * back a restart; the restart closes them.
	 */
	async connect(): Promise<ToolHostClient> {
		if (this.#client && !this.#client.running) {
			// The host crashed or was killed. Release its sandbox and start a new
			// one; the failed call has already reported the exit.
			this.#notify('The sandboxed tool host exited. Pau starts a new one for the next call.', 'warning');
			await this.#stopHost();
		}
		this.#host ??= this.#start();
		return this.#host;
	}

	/** Stop watching and stop the tool host. */
	async stop(): Promise<void> {
		this.#watcher?.close();
		await this.#stopHost();
	}
}
