import type { TranscriptEntry, TranscriptTool } from '@stormlightlabs/pau-ui';

import type { PiTranscript } from './pi-transcript';

/**
 * Builds a Claude Code session's transcript from the Claude bridge events the
 * backend forwards as `session_output`, each `{ sequence, event, payload }`.
 *
 * The bridge streams assistant text as `text.delta`, tool calls as
 * `tool.started` and `tool.completed`, and ends each turn with
 * `turn.completed`. It never echoes the operator's prompt, so the store adds
 * that with {@link withClaudePrompt} once the backend accepts it. The bridge
 * has no message history to read, so a transcript holds only what streamed
 * while Pau watched. Unknown events are ignored, which keeps newer bridges
 * from breaking the view.
 *
 * The transcript reuses {@link PiTranscript}: `active` is the assistant
 * message receiving text, and `messages` numbers entries for their keys.
 */
export function reduceClaudeEvent(state: PiTranscript, output: unknown): PiTranscript {
	if (!isObject(output)) return state;
	const payload = isObject(output.payload) ? output.payload : {};
	switch (output.event) {
		case 'text.delta': {
			const delta = typeof payload.text === 'string' ? payload.text : '';
			if (!delta) return state;
			const active = state.active;
			const current = active ? state.entries.find((entry) => entry.id === active) : undefined;
			if (current?.kind === 'message' && current.role === 'assistant') {
				return {
					...state,
					entries: state.entries.map((entry) =>
						entry === current ? { ...current, body: current.body + delta } : entry
					)
				};
			}
			const id = `claude-${state.messages}`;
			return {
				...state,
				active: id,
				messages: state.messages + 1,
				entries: [...state.entries, { id, kind: 'message', role: 'assistant', body: delta }]
			};
		}
		case 'tool.started': {
			const callId = typeof payload.id === 'string' ? payload.id : '';
			if (!callId) return state;
			const tool: TranscriptTool = {
				id: `tool:${callId}`,
				kind: 'tool',
				name: typeof payload.name === 'string' && payload.name ? payload.name : 'tool',
				detail: toolDetail(payload.input),
				status: 'running'
			};
			return { ...state, active: undefined, entries: upsert(state.entries, tool) };
		}
		case 'tool.completed': {
			const callId = typeof payload.id === 'string' ? payload.id : '';
			const id = `tool:${callId}`;
			const existing = state.entries.find((entry): entry is TranscriptTool => entry.id === id && entry.kind === 'tool');
			if (!callId || !existing) return state;
			const tool: TranscriptTool = {
				...existing,
				result: toolResult(payload.content) ?? existing.result,
				status: payload.isError === true ? 'failed' : 'complete'
			};
			return { ...state, entries: upsert(state.entries, tool) };
		}
		case 'turn.completed': {
			if (payload.status !== 'failed') return { ...state, active: undefined };
			const id = `claude-${state.messages}`;
			const body =
				typeof payload.error === 'string' && payload.error
					? `Claude Code could not finish this turn: ${payload.error}`
					: 'Claude Code could not finish this turn.';
			return {
				...state,
				active: undefined,
				messages: state.messages + 1,
				entries: [...state.entries, { id, kind: 'message', role: 'assistant', body, failed: true }]
			};
		}
		default: {
			return state;
		}
	}
}

/**
 * Adds a prompt the backend accepted, which the bridge does not echo. `at` is
 * the entry count when the prompt was sent, so a reply that streamed before
 * the backend answered still follows the prompt.
 */
export function withClaudePrompt(state: PiTranscript, text: string, at = state.entries.length): PiTranscript {
	const prompt: TranscriptEntry = { id: `claude-${state.messages}`, kind: 'message', role: 'user', body: text };
	return {
		...state,
		messages: state.messages + 1,
		entries: [...state.entries.slice(0, at), prompt, ...state.entries.slice(at)]
	};
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One line for the tool row: a path, a command, or the input as JSON. */
function toolDetail(input: unknown): string {
	if (!isObject(input)) return '';
	for (const key of ['file_path', 'path', 'command', 'pattern', 'url']) {
		if (typeof input[key] === 'string') return input[key];
	}
	return JSON.stringify(input);
}

/** A tool result is a string or a list of content blocks; only text blocks show. */
function toolResult(content: unknown): string | undefined {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return undefined;
	const parts = content.flatMap((block) =>
		isObject(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
	);
	return parts.length === 0 ? undefined : parts.join('\n');
}

function upsert(entries: TranscriptEntry[], entry: TranscriptEntry): TranscriptEntry[] {
	const index = entries.findIndex((candidate) => candidate.id === entry.id);
	if (index === -1) return [...entries, entry];
	return entries.map((candidate, position) => (position === index ? entry : candidate));
}
