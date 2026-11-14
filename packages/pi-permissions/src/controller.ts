/**
 * The request lifecycle around the gate: policy loading, the FIFO queue,
 * dialogs, session approvals, abort, timeout, and decision records.
 */
import { randomUUID } from 'node:crypto';
import { Gate, type ToolAnnotations, type ToolCall } from './gate.ts';
import { DECISIONS, decisionRecord, type OutcomeSource, parseAnswer, requestTitle, STATUS_KEY } from './messages.ts';
import type { PolicyLoad } from './policy.ts';
import { SessionApprovals } from './session-approvals.ts';

/** The part of Pi's extension UI the controller uses. */
export type PermissionUi = {
	select(
		title: string,
		options: string[],
		opts: { signal?: AbortSignal; timeout?: number }
	): Promise<string | undefined>;
	setStatus(key: string, text: string | undefined): void;
};

/** Pi's `tool_call` handler result: `undefined` lets the call run. */
export type Verdict = { block: true; reason: string } | undefined;

export class PermissionController {
	readonly #load: () => PolicyLoad;
	readonly #annotationsOf: (tool: string) => ToolAnnotations | undefined;
	readonly #approvals = new SessionApprovals();
	#state!: { ok: true; gate: Gate; timeout: number } | { ok: false; error: string };
	/**
	 * Calls are evaluated one at a time so dialogs reach Pau in order and a
	 * session approval from one answer applies to the calls queued behind it.
	 * Pi prepares calls serially, but codemode can start nested calls at once.
	 */
	#queue: Promise<unknown> = Promise.resolve();

	constructor(load: () => PolicyLoad, annotationsOf: (tool: string) => ToolAnnotations | undefined) {
		this.#load = load;
		this.#annotationsOf = annotationsOf;
		this.reset();
	}

	/** Reread the policy file and drop session approvals, as a new session starts. */
	reset(): void {
		this.#approvals.clear();
		const load = this.#load();
		this.#state = load.ok
			? {
					ok: true,
					gate: new Gate(load.policy, this.#approvals, this.#annotationsOf),
					timeout: load.policy.dialogTimeoutMs
				}
			: load;
		if (!load.ok) process.stderr.write(`[pau-permissions] ${load.error}; every tool call will be blocked\n`);
	}

	/** Drop session approvals when the session ends. */
	clearApprovals(): void {
		this.#approvals.clear();
	}

	/** Decide one tool call. `signal` is the run's abort signal. */
	handle(call: ToolCall, ui: PermissionUi, signal: AbortSignal | undefined): Promise<Verdict> {
		const requestId = randomUUID();
		const record = (outcome: 'allowed' | 'denied', source: OutcomeSource): void =>
			ui.setStatus(STATUS_KEY, decisionRecord(requestId, call.toolCallId, outcome, source));
		const deny = (source: OutcomeSource, reason: string): Verdict => {
			record('denied', source);
			return { block: true, reason };
		};
		const state = this.#state;
		if (!state.ok) return Promise.resolve(deny('policy_error', `Pau permission policy unavailable: ${state.error}`));

		const task = async (): Promise<Verdict> => {
			if (signal?.aborted) return deny('abort', ABORTED);
			const evaluation = await state.gate.evaluate(call);
			if (evaluation.action === 'allow') {
				record('allowed', evaluation.bySession ? 'session' : 'rule');
				return undefined;
			}
			if (evaluation.action === 'deny') {
				return deny('rule', evaluation.ruleReason ?? `Blocked by the Pau permission policy (${evaluation.reason}).`);
			}
			// The controller's own timer decides a timeout. Measuring the elapsed
			// time after the dialog closes misreads a timeout as a denial, because
			// Pi's timer can fire a millisecond early by `performance.now()`. This
			// timer starts before the dialog's, so with the same delay it fires
			// first.
			let expired = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const expiry = new Promise<undefined>((resolve) => {
				timer = setTimeout(() => {
					expired = true;
					resolve(undefined);
				}, state.timeout);
			});
			let value: string | undefined;
			try {
				value = await Promise.race([
					ui.select(requestTitle(requestId, call, evaluation), [...DECISIONS], {
						...(signal && { signal }),
						timeout: state.timeout
					}),
					expiry
				]);
			} finally {
				clearTimeout(timer);
			}
			// Pi resolves an aborted, expired, or cancelled dialog as `undefined`
			// and drops its pending entry, so a late answer is ignored.
			if (signal?.aborted) return deny('abort', ABORTED);
			if (value === undefined && expired) {
				return deny('timeout', 'The permission request timed out without an answer.');
			}
			const answer = parseAnswer(value);
			if (answer.decision === 'deny') {
				return deny('operator', `Denied by the operator${answer.reason ? `: ${answer.reason}` : '.'}`);
			}
			if (answer.decision === 'allow_session') this.#approvals.add(evaluation.sessionScope);
			record('allowed', 'operator');
			return undefined;
		};
		const previous = this.#queue;
		const run = (async (): Promise<Verdict> => {
			await previous;
			try {
				return await task();
			} catch (error) {
				return deny('policy_error', `The Pau permission check failed: ${(error as Error).message}`);
			}
		})();
		this.#queue = run;
		return run;
	}
}

const ABORTED = 'The permission request was cancelled because the run was aborted.';
