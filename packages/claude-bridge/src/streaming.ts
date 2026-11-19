import { randomUUID } from 'node:crypto';
import type { Readable, Writable } from 'node:stream';

import { BRIDGE_PROTOCOL_VERSION, type DiagnosticFrame, type EventFrame, type JsonValue } from './protocol.js';

/** Final state reported by Claude's authoritative result record. */
export type ClaudeTurnCompletion = {
	readonly status: 'completed' | 'failed' | 'interrupted';
	readonly result?: string;
	readonly error?: string;
	readonly sessionId?: string;
	/** Turn count reported by Claude's authoritative result record. */
	readonly turns?: number;
	/** Dollar cost reported by Claude's authoritative result record. */
	readonly costUsd?: number;
};

/** Streaming callbacks for one Claude prompt. */
export type ClaudePromptHandlers = {
	readonly onEvent?: (event: EventFrame) => void;
	readonly onDiagnostic?: (diagnostic: DiagnosticFrame) => void;
};

/** Machine-readable prompt failures raised before a result record arrives. */
export type ClaudePromptErrorCode = 'empty_prompt' | 'prompt_in_progress' | 'process_exited' | 'write_failed';

/** Machine-readable failures raised while interrupting an active turn. */
export type ClaudeInterruptErrorCode = 'no_active_turn' | 'interrupt_rejected' | 'interrupt_timeout' | 'write_failed';

/** A failure to request or confirm interruption of an active turn. */
export class ClaudeInterruptError extends Error {
	readonly code: ClaudeInterruptErrorCode;

	constructor(code: ClaudeInterruptErrorCode, message: string, cause?: unknown) {
		super(message, { cause });
		this.name = 'ClaudeInterruptError';
		this.code = code;
	}
}

/** A failure to submit or finish one Claude prompt. */
export class ClaudePromptError extends Error {
	readonly code: ClaudePromptErrorCode;

	constructor(code: ClaudePromptErrorCode, message: string, cause?: unknown) {
		super(message, { cause });
		this.name = 'ClaudePromptError';
		this.code = code;
	}
}

/** Machine-readable reasons that a native Claude session cannot be resumed. */
export type ClaudeResumeErrorCode = 'unknown_session' | 'session_mismatch';

/** A recoverable failure to attach a process to a native Claude session. */
export class ClaudeResumeError extends Error {
	readonly recoverable = true;

	constructor(
		readonly code: ClaudeResumeErrorCode,
		readonly requestedSessionId: string,
		readonly actualSessionId?: string
	) {
		super(
			code === 'unknown_session'
				? `Claude session was not found: ${requestedSessionId}`
				: `Claude resumed session ${actualSessionId ?? '<missing>'} instead of ${requestedSessionId}`
		);
		this.name = 'ClaudeResumeError';
	}
}

type PromptStreams = {
	readonly input: Writable;
	readonly output: Readable;
	readonly diagnostics: Readable;
	readonly exit: Promise<unknown>;
};

/**
 * Correlates one interrupt control request without treating its result as a
 * process exit. The turn's result record remains the completion authority.
 */
export class ClaudeTurnInterrupt {
	readonly #input: Writable;
	readonly #timeoutMs: number;
	readonly #requestId = randomUUID();
	#completion: Promise<ClaudeTurnCompletion> | undefined;
	#requestPromise: Promise<ClaudeTurnCompletion> | undefined;
	#resolveResponse!: () => void;
	#rejectResponse!: (error: unknown) => void;
	readonly #response: Promise<void>;
	#acknowledged = false;

	constructor(input: Writable, timeoutMs: number) {
		this.#input = input;
		this.#timeoutMs = timeoutMs;
		this.#response = new Promise((resolve, reject) => {
			this.#resolveResponse = resolve;
			this.#rejectResponse = reject;
		});
	}

	/** Whether Claude accepted the interrupt before reporting the turn result. */
	get acknowledged(): boolean {
		return this.#acknowledged;
	}

	/** Attach the authoritative completion promise before interruption is exposed. */
	attach(completion: Promise<ClaudeTurnCompletion>): void {
		this.#completion = completion;
	}

	/** Send one correlated interrupt and wait for Claude to settle the turn. */
	request(): Promise<ClaudeTurnCompletion> {
		this.#requestPromise ??= this.#runRequest();
		return this.#requestPromise;
	}

	/**
	 * Consume the control response while leaving normal records to the
	 * translator.
	 */
	handleRecord(value: unknown): void {
		if (
			!isRecord(value) ||
			value.type !== 'control_response' ||
			!isRecord(value.response) ||
			value.response.request_id !== this.#requestId
		) {
			return;
		}

		if (value.response.subtype === 'success') {
			this.#acknowledged = true;
			this.#resolveResponse();
			return;
		}

		const message = typeof value.response.error === 'string' ? value.response.error : 'Claude rejected the interrupt';
		this.#rejectResponse(new ClaudeInterruptError('interrupt_rejected', message));
	}

	async #runRequest(): Promise<ClaudeTurnCompletion> {
		if (!this.#completion) {
			throw new Error('Interrupt control was not attached to a prompt');
		}

		try {
			await writeInput(this.#input, {
				type: 'control_request',
				request_id: this.#requestId,
				request: { subtype: 'interrupt' }
			});
		} catch (error) {
			throw new ClaudeInterruptError('write_failed', 'Could not send interrupt to Claude', error);
		}

		return withTimeout(
			Promise.all([this.#response, this.#completion]).then(([, result]) => result),
			this.#timeoutMs,
			() =>
				new ClaudeInterruptError('interrupt_timeout', `Claude did not confirm interruption within ${this.#timeoutMs}ms`)
		);
	}
}

type MutablePromptState = {
	nextSequence: number;
	sawTextDelta: boolean;
	readonly startedToolIds: Set<string>;
	readonly expectedSessionId?: string;
	completion?: ClaudeTurnCompletion;
	resumeError?: ClaudeResumeError;
};

/**
 * Submit one task through Claude's stream-json protocol and emit bridge frames
 * as complete child records arrive. The `result` record alone settles the turn.
 */
export async function runClaudePrompt(
	streams: PromptStreams,
	task: string,
	firstSequence: number,
	handlers: ClaudePromptHandlers = {},
	expectedSessionId?: string,
	interrupt?: ClaudeTurnInterrupt
): Promise<{ completion: ClaudeTurnCompletion; nextSequence: number }> {
	if (task.trim() === '') {
		throw new ClaudePromptError('empty_prompt', 'Claude prompt must not be empty');
	}

	const outputLines = new JsonLineDecoder();
	const diagnosticLines = new TextLineDecoder();
	const state: MutablePromptState = {
		nextSequence: firstSequence,
		sawTextDelta: false,
		startedToolIds: new Set(),
		expectedSessionId
	};

	let resolveCompletion!: (value: ClaudeTurnCompletion) => void;
	let rejectCompletion!: (reason: unknown) => void;
	const completion = new Promise<ClaudeTurnCompletion>((resolve, reject) => {
		resolveCompletion = resolve;
		rejectCompletion = reject;
	});

	const finishRecord = (record: unknown): void => {
		interrupt?.handleRecord(record);
		translateRecord(record, state, handlers, interrupt);
		if (state.resumeError) rejectCompletion(state.resumeError);
		else if (state.completion) resolveCompletion(state.completion);
	};
	const onOutput = (chunk: Buffer | string): void => {
		for (const record of outputLines.push(chunk)) finishRecord(record);
	};
	const onDiagnostics = (chunk: Buffer | string): void => {
		for (const line of diagnosticLines.push(chunk)) {
			handlers.onDiagnostic?.(toDiagnosticFrame(line));
		}
	};
	streams.output.on('data', onOutput);
	streams.diagnostics.on('data', onDiagnostics);

	void streams.exit.then(() => {
		if (!state.completion) {
			rejectCompletion(new ClaudePromptError('process_exited', 'Claude exited before reporting the prompt result'));
		}
	});

	try {
		await writeInput(streams.input, { type: 'user', message: { role: 'user', content: task } });
		const result = await completion;
		return { completion: result, nextSequence: state.nextSequence };
	} finally {
		streams.output.off('data', onOutput);
		streams.diagnostics.off('data', onDiagnostics);
	}
}

function translateRecord(
	value: unknown,
	state: MutablePromptState,
	handlers: ClaudePromptHandlers,
	interrupt?: ClaudeTurnInterrupt
): void {
	if (!isRecord(value) || typeof value.type !== 'string') return;

	// Claude opens each turn with an init record that names the model it runs.
	if (value.type === 'system' && value.subtype === 'init') {
		if (typeof value.model === 'string' && value.model)
			emitEvent(state, handlers, 'session.model', { model: value.model });
		return;
	}

	if (value.type === 'stream_event' && isRecord(value.event)) {
		translateStreamEvent(value.event, state, handlers);
		return;
	}

	if (value.type === 'assistant' && isRecord(value.message)) {
		const content = value.message.content;
		if (!Array.isArray(content)) return;
		for (const block of content) translateContentBlock(block, state, handlers);
		return;
	}

	if (value.type === 'user' && isRecord(value.message)) {
		const content = value.message.content;
		if (!Array.isArray(content)) return;
		for (const block of content) {
			if (!isRecord(block) || block.type !== 'tool_result') continue;
			emitEvent(state, handlers, 'tool.completed', {
				id: stringOrEmpty(block.tool_use_id),
				content: jsonValue(block.content),
				isError: block.is_error === true
			});
		}
		return;
	}

	if (value.type === 'result') {
		const sessionId = typeof value.session_id === 'string' ? value.session_id : undefined;
		const failed = value.is_error === true || value.subtype !== 'success';
		if (state.expectedSessionId) {
			if (failed && sessionId === undefined) {
				state.resumeError = new ClaudeResumeError('unknown_session', state.expectedSessionId);
				return;
			}
			if (sessionId !== state.expectedSessionId) {
				state.resumeError = new ClaudeResumeError('session_mismatch', state.expectedSessionId, sessionId);
				return;
			}
		}

		const completion: ClaudeTurnCompletion = {
			status: interrupt?.acknowledged ? 'interrupted' : failed ? 'failed' : 'completed',
			...(typeof value.result === 'string' ? { result: value.result } : {}),
			...(failed && typeof value.error === 'string' ? { error: value.error } : {}),
			...(sessionId === undefined ? {} : { sessionId }),
			...(typeof value.num_turns === 'number' ? { turns: value.num_turns } : {}),
			...(typeof value.total_cost_usd === 'number' ? { costUsd: value.total_cost_usd } : {})
		};
		state.completion = completion;
		emitEvent(state, handlers, 'turn.completed', completion);
	}
}

function translateStreamEvent(
	event: Record<string, unknown>,
	state: MutablePromptState,
	handlers: ClaudePromptHandlers
): void {
	if (event.type === 'content_block_delta' && isRecord(event.delta)) {
		if (event.delta.type === 'text_delta' && typeof event.delta.text === 'string') {
			state.sawTextDelta = true;
			emitEvent(state, handlers, 'text.delta', { text: event.delta.text });
		}
		return;
	}

	if (event.type === 'content_block_start') {
		translateContentBlock(event.content_block, state, handlers);
	}
}

function translateContentBlock(block: unknown, state: MutablePromptState, handlers: ClaudePromptHandlers): void {
	if (!isRecord(block)) return;
	if (block.type === 'text' && typeof block.text === 'string') {
		// The final assistant message repeats text when partial stream events are on.
		if (!state.sawTextDelta) {
			emitEvent(state, handlers, 'text.delta', { text: block.text });
		}
		return;
	}
	if (block.type === 'tool_use') {
		const id = stringOrEmpty(block.id);
		if (state.startedToolIds.has(id)) return;
		state.startedToolIds.add(id);
		emitEvent(state, handlers, 'tool.started', { id, name: stringOrEmpty(block.name), input: jsonValue(block.input) });
	}
}

function emitEvent(state: MutablePromptState, handlers: ClaudePromptHandlers, event: string, payload: JsonValue): void {
	handlers.onEvent?.({
		version: BRIDGE_PROTOCOL_VERSION,
		type: 'event',
		sequence: state.nextSequence++,
		event,
		payload
	});
}

function toDiagnosticFrame(line: string): DiagnosticFrame {
	try {
		const value: unknown = JSON.parse(line);
		if (
			isRecord(value) &&
			value.version === BRIDGE_PROTOCOL_VERSION &&
			value.type === 'diagnostic' &&
			isDiagnosticLevel(value.level) &&
			typeof value.message === 'string' &&
			value.message !== ''
		) {
			return {
				version: BRIDGE_PROTOCOL_VERSION,
				type: 'diagnostic',
				level: value.level,
				message: value.message,
				...(value.context === undefined ? {} : { context: jsonValue(value.context) })
			};
		}
	} catch {
		// Plain stderr is still a diagnostic; it is never parsed as protocol output.
	}
	return { version: BRIDGE_PROTOCOL_VERSION, type: 'diagnostic', level: 'error', message: line };
}

function writeInput(input: Writable, value: unknown): Promise<void> {
	return new Promise((resolve, reject) => {
		input.write(`${JSON.stringify(value)}\n`, (error) => {
			if (error) {
				reject(new ClaudePromptError('write_failed', 'Could not send prompt to Claude', error));
			} else {
				resolve();
			}
		});
	});
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, createError: () => Error): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(createError()), timeoutMs);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

class TextLineDecoder {
	readonly #decoder = new TextDecoder();
	#buffer = '';

	push(chunk: Buffer | string): string[] {
		this.#buffer += typeof chunk === 'string' ? chunk : this.#decoder.decode(chunk, { stream: true });
		const lines = this.#buffer.split('\n');
		this.#buffer = lines.pop() ?? '';
		return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
	}
}

class JsonLineDecoder {
	readonly #lines = new TextLineDecoder();

	push(chunk: Buffer | string): unknown[] {
		return this.#lines.push(chunk).flatMap((line) => {
			try {
				return [JSON.parse(line) as unknown];
			} catch {
				return [];
			}
		});
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDiagnosticLevel(value: unknown): value is DiagnosticFrame['level'] {
	return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
}

function stringOrEmpty(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function jsonValue(value: unknown): JsonValue {
	if (value === undefined) return null;
	return JSON.parse(JSON.stringify(value)) as JsonValue;
}
