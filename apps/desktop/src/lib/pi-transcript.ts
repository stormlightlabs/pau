import type {
	AutoRetry,
	CompactionReason,
	CompactionState,
	MessageQueue,
	ToolCallDetails,
	ToolEdit,
	ToolTruncation,
	TranscriptEntry,
	TranscriptTool
} from '@stormlightlabs/pau-ui';

/**
 * Display transcript rebuilt from native Pi messages and events.
 *
 * Entry IDs encode their owner: `<messageKey>:<contentIndex>` for message
 * blocks and `tool:<toolCallId>` for tool calls, so later events can find the
 * entry they update without a separate index. A message key comes from the
 * message's role and timestamp, which Pi keeps from `message_start` through
 * `get_messages`, so a message that arrives both in loaded history and as a
 * live event lands on the same entries. Messages without a timestamp fall
 * back to a counter.
 */
export type PiTranscript = {
	entries: TranscriptEntry[];
	/** Key of the message that is receiving streamed updates. */
	active?: string;
	/** Number of messages started so far, used to key untimed messages. */
	messages: number;
	/**
	 * Keys of messages loaded complete from history. Their replayed start and
	 * streamed updates are skipped, so the finished text never flickers back
	 * to a partial one.
	 */
	loaded?: ReadonlySet<string>;
	/** Automatic retry that Pi has scheduled and not yet started or abandoned. */
	autoRetry?: AutoRetry;
	/** Compaction that is running, or the last one that failed or was aborted. */
	compaction?: CompactionState;
};

/** A transcript with no events applied. */
export const emptyPiTranscript: PiTranscript = { entries: [], messages: 0 };

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function numberField(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function compactionReason(value: unknown): CompactionReason {
	return value === 'threshold' || value === 'overflow' ? value : 'manual';
}

/** Applies a finished compaction: a marker on success, or the state that explains why none was added. */
function applyCompactionEnd(state: PiTranscript, event: JsonObject): PiTranscript {
	const reason = compactionReason(event.reason);
	const result = isObject(event.result) ? event.result : undefined;
	if (event.aborted === true) return { ...state, compaction: { status: 'aborted', reason } };
	if (!result) return { ...state, compaction: { status: 'failed', reason, message: text(event.errorMessage) } };
	const count = state.entries.filter((entry) => entry.kind === 'compaction').length;
	return {
		...state,
		compaction: undefined,
		entries: [
			...state.entries,
			{
				id: `compaction:${count}`,
				kind: 'compaction',
				reason,
				summary: text(result.summary) ?? '',
				firstKeptEntryId: text(result.firstKeptEntryId),
				tokensBefore: numberField(result.tokensBefore),
				willRetry: event.willRetry === true || undefined
			}
		]
	};
}

function toolEntryId(callId: string): string {
	return `tool:${callId}`;
}

function toolDetail(args: unknown): string {
	if (!isObject(args)) return '';
	const preferred = text(args.path) ?? text(args.command) ?? text(args.pattern);
	return preferred ?? JSON.stringify(args);
}

function truncation(details: JsonObject): ToolTruncation | undefined {
	const value = details.truncation;
	if (!isObject(value) || value.truncated !== true) return undefined;
	const totalLines = numberField(value.totalLines);
	const outputLines = numberField(value.outputLines);
	if (totalLines === undefined || outputLines === undefined) return undefined;
	return { truncatedBy: value.truncatedBy === 'bytes' ? 'bytes' : 'lines', totalLines, outputLines };
}

function edits(args: JsonObject): ToolEdit[] | undefined {
	// Older Pi sessions stored a single replacement as top-level oldText and newText.
	const list: unknown[] = Array.isArray(args.edits) ? args.edits : [args];
	const parsed = list.flatMap((edit) => {
		if (!isObject(edit)) return [];
		const oldText = text(edit.oldText);
		const newText = text(edit.newText);
		return oldText === undefined || newText === undefined ? [] : [{ oldText, newText }];
	});
	return parsed.length === 0 ? undefined : parsed;
}

/**
 * Reads the arguments of Pi's built-in `bash`, `read`, `edit`, and `write`
 * tools. Returns undefined for other tools and for arguments missing a
 * required field, so those calls keep their text summary.
 */
function toolCall(name: string, args: unknown): ToolCallDetails | undefined {
	if (!isObject(args)) return undefined;
	const path = text(args.path);
	switch (name) {
		case 'bash': {
			const command = text(args.command);
			return command === undefined ? undefined : { tool: 'bash', command, timeout: numberField(args.timeout) };
		}
		case 'read': {
			return path === undefined
				? undefined
				: { tool: 'read', path, offset: numberField(args.offset), limit: numberField(args.limit) };
		}
		case 'edit': {
			const list = edits(args);
			return path === undefined || !list ? undefined : { tool: 'edit', path, edits: list };
		}
		case 'write': {
			const content = text(args.content);
			return path === undefined || content === undefined ? undefined : { tool: 'write', path, content };
		}
		default: {
			return undefined;
		}
	}
}

/**
 * Adds result details to a built-in tool call. `result` is either a
 * `toolResult` message from history or the result of a live tool execution
 * event; both carry Pi's `details`. Only live results carry
 * `structuredContent`, which holds the `bash` exit code and run time.
 */
function withResult(call: ToolCallDetails | undefined, result: unknown): ToolCallDetails | undefined {
	if (!call || !isObject(result)) return call;
	const details = isObject(result.details) ? result.details : {};
	switch (call.tool) {
		case 'bash': {
			const structured = isObject(result.structuredContent) ? result.structuredContent : {};
			const seconds = numberField(structured.wall_time_seconds);
			return {
				...call,
				exitCode: numberField(structured.exit_code) ?? call.exitCode,
				durationMs: seconds === undefined ? call.durationMs : Math.round(seconds * 1000),
				truncation: truncation(details) ?? call.truncation,
				fullOutputPath: text(details.fullOutputPath) ?? call.fullOutputPath
			};
		}
		case 'read': {
			return { ...call, truncation: truncation(details) ?? call.truncation };
		}
		case 'edit': {
			return {
				...call,
				diff: text(details.diff) ?? call.diff,
				patch: text(details.patch) ?? call.patch,
				firstChangedLine: numberField(details.firstChangedLine) ?? call.firstChangedLine
			};
		}
		case 'write': {
			return call;
		}
	}
}

/**
 * Replaces a call's arguments and keeps any result details already applied,
 * because an authoritative `message_end` can repeat the arguments after a live
 * result has arrived.
 */
function withArguments(
	previous: ToolCallDetails | undefined,
	name: string,
	args: unknown
): ToolCallDetails | undefined {
	const next = toolCall(name, args);
	if (!next || previous?.tool !== next.tool) return next ?? previous;
	return { ...previous, ...next } as ToolCallDetails;
}

function toolOutput(result: unknown): string | undefined {
	if (!isObject(result) || !Array.isArray(result.content)) return undefined;
	const parts = result.content.flatMap((block) =>
		isObject(block) && block.type === 'text' ? [text(block.text) ?? ''] : []
	);
	return parts.length === 0 ? undefined : parts.join('\n');
}

function upsert(entries: TranscriptEntry[], entry: TranscriptEntry): TranscriptEntry[] {
	const index = entries.findIndex((candidate) => candidate.id === entry.id);
	if (index === -1) return [...entries, entry];
	return entries.map((candidate, position) => (position === index ? entry : candidate));
}

function updateTool(
	entries: TranscriptEntry[],
	callId: string,
	update: (tool: TranscriptTool) => TranscriptTool,
	fallbackName: string
): TranscriptEntry[] {
	const id = toolEntryId(callId);
	const existing = entries.find((entry): entry is TranscriptTool => entry.id === id && entry.kind === 'tool');
	return upsert(entries, update(existing ?? { id, kind: 'tool', name: fallbackName, detail: '', status: 'running' }));
}

function messageKey(message: JsonObject): string | undefined {
	const timestamp = numberField(message.timestamp);
	return timestamp !== undefined && typeof message.role === 'string' ? `${message.role}-${timestamp}` : undefined;
}

/**
 * Widest gap between a saved entry's time and its message's time that still
 * counts as the same message. Pi stamps the entry just after the message.
 */
const ENTRY_TIME_TOLERANCE_MS = 5000;

/**
 * Finds the transcript entry that shows a saved Pi entry. The transcript
 * keeps no Pi entry IDs, so the match uses the message key's role and time.
 * Returns `undefined` when the loaded transcript has no such message, such
 * as a tool result or a message older than the loaded history.
 */
export function findTranscriptEntry(
	entries: TranscriptEntry[],
	role: string | undefined,
	timestamp: string | undefined
): string | undefined {
	const time = timestamp ? Date.parse(timestamp) : NaN;
	if (!role || Number.isNaN(time)) return undefined;
	let found: string | undefined;
	let nearest = ENTRY_TIME_TOLERANCE_MS + 1;
	for (const entry of entries) {
		const key = /^([^:]+)-(\d+):/.exec(entry.id);
		if (key?.[1] !== role) continue;
		const gap = Math.abs(Number(key[2]) - time);
		if (gap >= nearest) continue;
		found = entry.id;
		nearest = gap;
	}
	return found;
}

/**
 * Labels for Pi's context summaries. A compaction summary stands in for the
 * turns it replaced, and a branch summary for the branch left behind.
 *
 * Both render as labelled messages until the transcript has a dedicated
 * compaction marker.
 */
const SUMMARY_LABELS: Record<string, string> = {
	compactionSummary: 'Earlier conversation, summarized',
	branchSummary: 'Previous branch, summarized'
};

/** Projects one authoritative or starting message into transcript entries. */
function projectMessage(
	key: string,
	message: JsonObject,
	existing: TranscriptEntry[],
	complete: boolean
): TranscriptEntry[] {
	const role = message.role;
	const summaryLabel = typeof role === 'string' ? SUMMARY_LABELS[role] : undefined;
	if (summaryLabel) {
		const body = text(message.summary);
		return body ? [{ id: `${key}:0`, kind: 'message', role: 'assistant', label: summaryLabel, body }] : [];
	}
	if (role === 'user') {
		const content = message.content;
		const body =
			text(content) ??
			(Array.isArray(content)
				? content
						.flatMap((block) => (isObject(block) && block.type === 'text' ? [text(block.text) ?? ''] : []))
						.join('\n')
				: '');
		return body ? [{ id: `${key}:0`, kind: 'message', role: 'user', body }] : [];
	}
	if (role !== 'assistant' || !Array.isArray(message.content)) return [];

	const projected: TranscriptEntry[] = [];
	for (const [index, block] of (message.content as unknown[]).entries()) {
		if (!isObject(block)) continue;
		const id = `${key}:${index}`;
		if (block.type === 'text' && text(block.text)) {
			projected.push({ id, kind: 'message', role: 'assistant', body: text(block.text) ?? '' });
		} else if (block.type === 'thinking' && text(block.thinking)) {
			projected.push({ id, kind: 'thinking', body: text(block.thinking) ?? '', complete });
		} else if (block.type === 'toolCall' && text(block.id)) {
			const toolId = toolEntryId(text(block.id) ?? '');
			const previous = existing.find((entry): entry is TranscriptTool => entry.id === toolId && entry.kind === 'tool');
			const name = text(block.name) ?? previous?.name ?? 'tool';
			projected.push({
				...(previous ?? { status: 'running' as const }),
				id: toolId,
				kind: 'tool',
				name,
				detail: toolDetail(block.arguments),
				call: withArguments(previous?.call, name, block.arguments)
			});
		}
	}
	const error = text(message.errorMessage);
	if (complete && error && message.stopReason === 'error') {
		projected.push({
			id: `${key}:error`,
			kind: 'message',
			role: 'assistant',
			label: 'Pi · error',
			body: error,
			failed: true
		});
	}
	return projected;
}

/** Replaces every entry the message owns with its authoritative projection, in place. */
function replaceMessage(entries: TranscriptEntry[], key: string, projected: TranscriptEntry[]): TranscriptEntry[] {
	const replaced = new Set(projected.map((entry) => entry.id));
	const owned = (entry: TranscriptEntry) => entry.id.startsWith(`${key}:`) || replaced.has(entry.id);
	const first = entries.findIndex((entry) => owned(entry));
	const kept = entries.filter((entry) => !owned(entry));
	const at = first === -1 ? kept.length : entries.slice(0, first).filter((entry) => !owned(entry)).length;
	return [...kept.slice(0, at), ...projected, ...kept.slice(at)];
}

function applyMessageUpdate(state: PiTranscript, update: JsonObject): PiTranscript {
	const key = state.active;
	const index = update.contentIndex;
	if (key === undefined || typeof index !== 'number' || state.loaded?.has(key)) return state;
	const id = `${key}:${index}`;
	const existing = state.entries.find((entry) => entry.id === id);
	const body = existing && (existing.kind === 'message' || existing.kind === 'thinking') ? existing.body : '';

	switch (update.type) {
		case 'text_delta': {
			return {
				...state,
				entries: upsert(state.entries, {
					id,
					kind: 'message',
					role: 'assistant',
					body: body + (text(update.delta) ?? '')
				})
			};
		}
		case 'text_end': {
			return {
				...state,
				entries: upsert(state.entries, { id, kind: 'message', role: 'assistant', body: text(update.content) ?? body })
			};
		}
		case 'thinking_delta': {
			return {
				...state,
				entries: upsert(state.entries, {
					id,
					kind: 'thinking',
					body: body + (text(update.delta) ?? ''),
					complete: false
				})
			};
		}
		case 'thinking_end': {
			return {
				...state,
				entries: upsert(state.entries, { id, kind: 'thinking', body: text(update.content) ?? body, complete: true })
			};
		}
		case 'toolcall_start': {
			const callId = text(update.id);
			if (!callId) return state;
			const name = text(update.toolName) ?? 'tool';
			return { ...state, entries: updateTool(state.entries, callId, (tool) => ({ ...tool, name }), name) };
		}
		case 'toolcall_end': {
			const call = update.toolCall;
			if (!isObject(call) || !text(call.id)) return state;
			const name = text(call.name) ?? 'tool';
			return {
				...state,
				entries: updateTool(
					state.entries,
					text(call.id) ?? '',
					(tool) => ({
						...tool,
						name,
						detail: toolDetail(call.arguments),
						call: withArguments(tool.call, name, call.arguments)
					}),
					name
				)
			};
		}
		default: {
			return state;
		}
	}
}

/**
 * Applies a complete message. A tool result also settles its tool call, so
 * history that holds no tool execution events still shows each outcome.
 */
function endMessage(state: PiTranscript, message: JsonObject): PiTranscript {
	const key = state.active ?? messageKey(message) ?? `m${state.messages}`;
	const messages = state.active === undefined ? state.messages + 1 : state.messages;
	const callId = text(message.toolCallId);
	const entries =
		callId && message.role === 'toolResult'
			? updateTool(
					state.entries,
					callId,
					(tool) => ({
						...tool,
						result: toolOutput(message) ?? tool.result,
						status: message.isError === true ? 'failed' : 'complete',
						call: withResult(tool.call, message)
					}),
					text(message.toolName) ?? 'tool'
				)
			: replaceMessage(state.entries, key, projectMessage(key, message, state.entries, true));
	return { ...state, active: undefined, entries, messages };
}

/**
 * Builds a transcript from the native messages Pi reports for a session, the
 * same shapes `message_end` events carry. Live events applied afterwards with
 * {@link reducePiEvent} update it in place.
 */
export function piTranscriptFromMessages(messages: unknown[]): PiTranscript {
	let transcript = emptyPiTranscript;
	for (const message of messages) {
		if (isObject(message)) transcript = endMessage(transcript, message);
	}
	const loaded = new Set(messages.flatMap((message) => (isObject(message) ? (messageKey(message) ?? []) : [])));
	return { ...transcript, loaded };
}

/**
 * Applies one native Pi event to a display transcript.
 *
 * Streamed deltas build provisional entries. `message_end` replaces them with
 * the authoritative message, so provider corrections win. Tool execution
 * events update the tool call by its ID. Unknown events and fields are
 * ignored, which keeps newer Pi versions from breaking the view.
 */
export function reducePiEvent(state: PiTranscript, event: unknown): PiTranscript {
	if (!isObject(event)) return state;
	switch (event.type) {
		case 'message_start': {
			if (!isObject(event.message)) return state;
			const key = messageKey(event.message) ?? `m${state.messages}`;
			const next = { ...state, active: key, messages: state.messages + 1 };
			if (state.loaded?.has(key)) return next;
			const projected = projectMessage(key, event.message, state.entries, false);
			return { ...next, entries: replaceMessage(state.entries, key, projected) };
		}
		case 'message_update': {
			return isObject(event.assistantMessageEvent) ? applyMessageUpdate(state, event.assistantMessageEvent) : state;
		}
		case 'message_end': {
			return isObject(event.message) ? endMessage(state, event.message) : state;
		}
		case 'tool_execution_start':
		case 'tool_execution_update':
		case 'tool_execution_end': {
			const callId = text(event.toolCallId);
			if (!callId) return state;
			const name = text(event.toolName) ?? 'tool';
			const ended = event.type === 'tool_execution_end';
			const result = ended ? event.result : event.partialResult;
			const output = toolOutput(result);
			return {
				...state,
				entries: updateTool(
					state.entries,
					callId,
					(tool) => ({
						...tool,
						name,
						detail: tool.detail || toolDetail(event.args),
						result: output ?? tool.result,
						status: ended ? (event.isError === true ? 'failed' : 'complete') : 'running',
						call: withResult(tool.call ?? toolCall(name, event.args), result)
					}),
					name
				)
			};
		}
		case 'compaction_start': {
			return { ...state, compaction: { status: 'running', reason: compactionReason(event.reason) } };
		}
		case 'compaction_end': {
			return applyCompactionEnd(state, event);
		}
		case 'agent_start': {
			return state.compaction && state.compaction.status !== 'running' ? { ...state, compaction: undefined } : state;
		}
		case 'auto_retry_start': {
			const attempt = numberField(event.attempt);
			const maxAttempts = numberField(event.maxAttempts);
			const delayMs = numberField(event.delayMs);
			if (attempt === undefined || maxAttempts === undefined || delayMs === undefined) return state;
			return {
				...state,
				autoRetry: { attempt, maxAttempts, retryAt: Date.now() + delayMs, errorMessage: text(event.errorMessage) }
			};
		}
		case 'auto_retry_end': {
			return state.autoRetry ? { ...state, autoRetry: undefined } : state;
		}
		default: {
			return state;
		}
	}
}

function queuedMessages(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

/**
 * Reads a `queue_update` event, which carries the whole queue each time.
 * Returns undefined for any other event.
 */
export function queueFromEvent(event: unknown): MessageQueue | undefined {
	if (!isObject(event) || event.type !== 'queue_update') return undefined;
	return { steering: queuedMessages(event.steering), followUp: queuedMessages(event.followUp) };
}
