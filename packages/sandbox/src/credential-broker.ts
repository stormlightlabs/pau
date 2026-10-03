import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

/** One host credential and the sentinel already placed in the tool environment. */
export type BrokerCredential = { source: string; destinations: string[]; sentinel: string; value: string };

type ReadyMessage = { kind: 'ready'; credentials: { source: string; sentinel: string }[] };

type BrokerMessage = ReadyMessage | { kind: 'stopped' } | { kind: 'error'; message: string };

/**
 * Owns one session's trusted credential process.
 *
 * Real values cross only the broker's standard-input pipe. They are absent
 * from process arguments, the broker environment, the sandbox policy, and
 * worker output. Call {@link stop} when the session ends.
 */
export class CredentialBroker {
	static async start(credentials: BrokerCredential[]): Promise<CredentialBroker> {
		const script = fileURLToPath(new URL('credential-broker-process.ts', import.meta.url));
		const child = spawn(process.execPath, [script], { env: { LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe'] });
		const broker = new CredentialBroker(child);
		const ready = broker.#waitFor('ready');
		child.stdin?.write(`${JSON.stringify({ kind: 'start', credentials })}\n`);
		const message = (await ready) as ReadyMessage;
		broker.#sentinels = new Map(message.credentials.map(({ source, sentinel }) => [source, sentinel]));
		return broker;
	}

	readonly #messages: BrokerMessage[] = [];
	readonly #waiters: ((message: BrokerMessage) => void)[] = [];
	#sentinels = new Map<string, string>();
	#stderr = '';
	#exited = false;
	readonly child: ChildProcess;

	private constructor(child: ChildProcess) {
		this.child = child;
		child.stderr?.on('data', (chunk: Buffer) => {
			this.#stderr += chunk.toString();
		});
		if (child.stdout) {
			createInterface({ input: child.stdout }).on('line', (line) => {
				const message = JSON.parse(line) as BrokerMessage;
				const waiter = this.#waiters.shift();
				if (waiter) waiter(message);
				else this.#messages.push(message);
			});
		}
		child.once('exit', () => {
			this.#exited = true;
			this.#sentinels.clear();
			const message: BrokerMessage = {
				kind: 'error',
				message: `credential broker exited before completing a request${this.#stderr ? `: ${this.#stderr.trim()}` : ''}`
			};
			for (const waiter of this.#waiters.splice(0)) waiter(message);
		});
	}

	async #waitFor(kind: BrokerMessage['kind']): Promise<BrokerMessage> {
		for (;;) {
			const message =
				this.#messages.shift() ??
				(await new Promise<BrokerMessage>((resolve) => {
					this.#waiters.push(resolve);
				}));
			if (message.kind === 'error') throw new Error(message.message);
			if (message.kind === kind) return message;
		}
	}

	/** Sentinel environment for the sandboxed tool host and its descendants. */
	get environment(): ReadonlyMap<string, string> {
		return this.#sentinels;
	}

	/** Broker process identifier, used by process ownership and tests. */
	get processId(): number | undefined {
		return this.child.pid;
	}

	/** Stop the broker and discard this session's sentinel mapping. */
	async stop(): Promise<void> {
		if (this.#exited) return;
		const stopped = this.#waitFor('stopped');
		const exited = new Promise<void>((resolve) => this.child.once('exit', () => resolve()));
		this.child.stdin?.write(`${JSON.stringify({ kind: 'stop' })}\n`);
		await stopped;
		await exited;
		this.#sentinels.clear();
	}

	/** Captured broker diagnostics. They never include protocol input. */
	get diagnostics(): string {
		return this.#stderr;
	}
}
