import type { Readable, Writable } from "node:stream";

import {
  BRIDGE_PROTOCOL_VERSION,
  type DiagnosticFrame,
  type EventFrame,
  type JsonValue,
} from "./protocol.js";

/** Final state reported by Claude's authoritative result record. */
export type ClaudeTurnCompletion = {
  readonly status: "completed" | "failed";
  readonly result?: string;
  readonly error?: string;
};

/** Streaming callbacks for one Claude prompt. */
export type ClaudePromptHandlers = {
  readonly onEvent?: (event: EventFrame) => void;
  readonly onDiagnostic?: (diagnostic: DiagnosticFrame) => void;
};

/** Machine-readable prompt failures raised before a result record arrives. */
export type ClaudePromptErrorCode =
  | "empty_prompt"
  | "prompt_in_progress"
  | "process_exited"
  | "write_failed";

/** A failure to submit or finish one Claude prompt. */
export class ClaudePromptError extends Error {
  readonly code: ClaudePromptErrorCode;

  constructor(code: ClaudePromptErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ClaudePromptError";
    this.code = code;
  }
}

type PromptStreams = {
  readonly input: Writable;
  readonly output: Readable;
  readonly diagnostics: Readable;
  readonly exit: Promise<unknown>;
};

type MutablePromptState = {
  nextSequence: number;
  sawTextDelta: boolean;
  readonly startedToolIds: Set<string>;
  completion?: ClaudeTurnCompletion;
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
): Promise<{ completion: ClaudeTurnCompletion; nextSequence: number }> {
  if (task.trim() === "") {
    throw new ClaudePromptError("empty_prompt", "Claude prompt must not be empty");
  }

  const outputLines = new JsonLineDecoder();
  const diagnosticLines = new TextLineDecoder();
  const state: MutablePromptState = {
    nextSequence: firstSequence,
    sawTextDelta: false,
    startedToolIds: new Set(),
  };

  let resolveCompletion!: (value: ClaudeTurnCompletion) => void;
  let rejectCompletion!: (reason: unknown) => void;
  const completion = new Promise<ClaudeTurnCompletion>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });

  const finishRecord = (record: unknown): void => {
    translateRecord(record, state, handlers);
    if (state.completion) resolveCompletion(state.completion);
  };
  const onOutput = (chunk: Buffer | string): void => {
    for (const record of outputLines.push(chunk)) finishRecord(record);
  };
  const onDiagnostics = (chunk: Buffer | string): void => {
    for (const line of diagnosticLines.push(chunk)) {
      handlers.onDiagnostic?.(toDiagnosticFrame(line));
    }
  };
  streams.output.on("data", onOutput);
  streams.diagnostics.on("data", onDiagnostics);

  void streams.exit.then(() => {
    if (!state.completion) {
      rejectCompletion(
        new ClaudePromptError(
          "process_exited",
          "Claude exited before reporting the prompt result",
        ),
      );
    }
  });

  try {
    await writeInput(streams.input, {
      type: "user",
      message: { role: "user", content: task },
    });
    const result = await completion;
    return { completion: result, nextSequence: state.nextSequence };
  } finally {
    streams.output.off("data", onOutput);
    streams.diagnostics.off("data", onDiagnostics);
  }
}

function translateRecord(
  value: unknown,
  state: MutablePromptState,
  handlers: ClaudePromptHandlers,
): void {
  if (!isRecord(value) || typeof value.type !== "string") return;

  if (value.type === "stream_event" && isRecord(value.event)) {
    translateStreamEvent(value.event, state, handlers);
    return;
  }

  if (value.type === "assistant" && isRecord(value.message)) {
    const content = value.message.content;
    if (!Array.isArray(content)) return;
    for (const block of content) translateContentBlock(block, state, handlers);
    return;
  }

  if (value.type === "user" && isRecord(value.message)) {
    const content = value.message.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (!isRecord(block) || block.type !== "tool_result") continue;
      emitEvent(state, handlers, "tool.completed", {
        id: stringOrEmpty(block.tool_use_id),
        content: jsonValue(block.content),
        isError: block.is_error === true,
      });
    }
    return;
  }

  if (value.type === "result") {
    const failed = value.is_error === true || value.subtype !== "success";
    const completion: ClaudeTurnCompletion = {
      status: failed ? "failed" : "completed",
      ...(typeof value.result === "string" ? { result: value.result } : {}),
      ...(failed && typeof value.error === "string" ? { error: value.error } : {}),
    };
    state.completion = completion;
    emitEvent(state, handlers, "turn.completed", completion);
  }
}

function translateStreamEvent(
  event: Record<string, unknown>,
  state: MutablePromptState,
  handlers: ClaudePromptHandlers,
): void {
  if (event.type === "content_block_delta" && isRecord(event.delta)) {
    if (event.delta.type === "text_delta" && typeof event.delta.text === "string") {
      state.sawTextDelta = true;
      emitEvent(state, handlers, "text.delta", { text: event.delta.text });
    }
    return;
  }

  if (event.type === "content_block_start") {
    translateContentBlock(event.content_block, state, handlers);
  }
}

function translateContentBlock(
  block: unknown,
  state: MutablePromptState,
  handlers: ClaudePromptHandlers,
): void {
  if (!isRecord(block)) return;
  if (block.type === "text" && typeof block.text === "string") {
    // The final assistant message repeats text when partial stream events are on.
    if (!state.sawTextDelta) {
      emitEvent(state, handlers, "text.delta", { text: block.text });
    }
    return;
  }
  if (block.type === "tool_use") {
    const id = stringOrEmpty(block.id);
    if (state.startedToolIds.has(id)) return;
    state.startedToolIds.add(id);
    emitEvent(state, handlers, "tool.started", {
      id,
      name: stringOrEmpty(block.name),
      input: jsonValue(block.input),
    });
  }
}

function emitEvent(
  state: MutablePromptState,
  handlers: ClaudePromptHandlers,
  event: string,
  payload: JsonValue,
): void {
  handlers.onEvent?.({
    version: BRIDGE_PROTOCOL_VERSION,
    type: "event",
    sequence: state.nextSequence++,
    event,
    payload,
  });
}

function toDiagnosticFrame(line: string): DiagnosticFrame {
  try {
    const value: unknown = JSON.parse(line);
    if (
      isRecord(value) &&
      value.version === BRIDGE_PROTOCOL_VERSION &&
      value.type === "diagnostic" &&
      isDiagnosticLevel(value.level) &&
      typeof value.message === "string" &&
      value.message !== ""
    ) {
      return {
        version: BRIDGE_PROTOCOL_VERSION,
        type: "diagnostic",
        level: value.level,
        message: value.message,
        ...(value.context === undefined
          ? {}
          : { context: jsonValue(value.context) }),
      };
    }
  } catch {
    // Plain stderr is still a diagnostic; it is never parsed as protocol output.
  }
  return {
    version: BRIDGE_PROTOCOL_VERSION,
    type: "diagnostic",
    level: "error",
    message: line,
  };
}

function writeInput(input: Writable, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    input.write(`${JSON.stringify(value)}\n`, (error) => {
      if (error) {
        reject(
          new ClaudePromptError(
            "write_failed",
            "Could not send prompt to Claude",
            error,
          ),
        );
      } else {
        resolve();
      }
    });
  });
}

class TextLineDecoder {
  readonly #decoder = new TextDecoder();
  #buffer = "";

  push(chunk: Buffer | string): string[] {
    this.#buffer +=
      typeof chunk === "string"
        ? chunk
        : this.#decoder.decode(chunk, { stream: true });
    const lines = this.#buffer.split("\n");
    this.#buffer = lines.pop() ?? "";
    return lines.map((line) => line.endsWith("\r") ? line.slice(0, -1) : line);
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
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDiagnosticLevel(value: unknown): value is DiagnosticFrame["level"] {
  return (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  );
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function jsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
