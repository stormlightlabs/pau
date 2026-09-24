import * as v from "valibot";

/** The only bridge protocol version accepted by this package release. */
export const BRIDGE_PROTOCOL_VERSION = 1 as const;

/** A value that can be represented without loss in a JSON frame. */
export type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

const jsonValueSchema: v.GenericSchema<unknown, JsonValue> = v.lazy(() =>
  v.union([
    v.boolean(),
    v.null(),
    v.pipe(v.number(), v.finite()),
    v.string(),
    v.array(jsonValueSchema),
    v.record(v.string(), jsonValueSchema),
  ]),
);

const envelopeEntries = {
  version: v.literal(BRIDGE_PROTOCOL_VERSION),
};
const nonEmptyString = v.pipe(v.string(), v.minLength(1));

/** A request sent to the bridge. Responses use the same identifier. */
export const commandFrameSchema = v.strictObject({
  ...envelopeEntries,
  type: v.literal("command"),
  id: nonEmptyString,
  command: nonEmptyString,
  payload: v.optional(jsonValueSchema),
});

/** A successful command result. */
const successResponseFrameSchema = v.strictObject({
  ...envelopeEntries,
  type: v.literal("response"),
  id: nonEmptyString,
  ok: v.literal(true),
  result: v.optional(jsonValueSchema),
});

/** A failed command result with a machine-readable error. */
const errorResponseFrameSchema = v.strictObject({
  ...envelopeEntries,
  type: v.literal("response"),
  id: nonEmptyString,
  ok: v.literal(false),
  error: v.strictObject({
    code: nonEmptyString,
    message: nonEmptyString,
    recoverable: v.boolean(),
    details: v.optional(jsonValueSchema),
  }),
});

/** Runtime validator for successful and failed command responses. */
export const responseFrameSchema = v.union([
  successResponseFrameSchema,
  errorResponseFrameSchema,
]);

/** An ordered notification emitted independently of a command response. */
export const eventFrameSchema = v.strictObject({
  ...envelopeEntries,
  type: v.literal("event"),
  sequence: v.pipe(v.number(), v.integer(), v.minValue(0)),
  event: nonEmptyString,
  payload: v.optional(jsonValueSchema),
});

/**
 * A message for the diagnostic stream. Diagnostic frames are never protocol
 * frames.
 */
export const diagnosticFrameSchema = v.strictObject({
  ...envelopeEntries,
  type: v.literal("diagnostic"),
  level: v.picklist(["debug", "info", "warn", "error"]),
  message: nonEmptyString,
  context: v.optional(jsonValueSchema),
});

/** Runtime validator for frames allowed on the protocol stream. */
export const protocolFrameSchema = v.union([
  commandFrameSchema,
  responseFrameSchema,
  eventFrameSchema,
]);

/** A command accepted by the bridge protocol. */
export type CommandFrame = v.InferOutput<typeof commandFrameSchema>;
/** A successful or failed reply to one command. */
export type ResponseFrame = v.InferOutput<typeof responseFrameSchema>;
/** An ordered bridge notification. */
export type EventFrame = v.InferOutput<typeof eventFrameSchema>;
/** A message carried only on the diagnostic stream. */
export type DiagnosticFrame = v.InferOutput<typeof diagnosticFrameSchema>;
/** A frame allowed on the bidirectional protocol stream. */
export type ProtocolFrame = v.InferOutput<typeof protocolFrameSchema>;
/** Any frame carried by either bridge stream. */
export type BridgeFrame = ProtocolFrame | DiagnosticFrame;

/** Machine-readable reasons that a decoder can reject one line. */
export type FrameDecodeErrorCode = "malformed_frame" | "unsupported_version";

/** A rejected line and the reason it could not be decoded. */
export interface FrameDecodeError {
  code: FrameDecodeErrorCode;
  message: string;
  line: string;
}

/** The result of decoding one complete JSONL record. */
export type FrameDecodeResult<T> =
  | { ok: true; frame: T }
  | { ok: false; error: FrameDecodeError };

/**
 * Incrementally decodes newline-delimited JSON without letting one bad line
 * consume the next frame.
 */
export class FrameDecoder<T> {
  readonly #schema: v.GenericSchema<unknown, T>;
  readonly #textDecoder = new TextDecoder();
  #buffer = "";

  constructor(schema: v.GenericSchema<unknown, T>) {
    this.#schema = schema;
  }

  push(chunk: string | Uint8Array): FrameDecodeResult<T>[] {
    this.#buffer +=
      typeof chunk === "string"
        ? chunk
        : this.#textDecoder.decode(chunk, { stream: true });

    const lines = this.#buffer.split("\n");
    this.#buffer = lines.pop() ?? "";
    return lines.map((line) => this.#decodeLine(stripCarriageReturn(line)));
  }

  end(): FrameDecodeResult<T>[] {
    this.#buffer += this.#textDecoder.decode();
    if (this.#buffer === "") {
      return [];
    }

    const line = stripCarriageReturn(this.#buffer);
    this.#buffer = "";
    return [this.#decodeLine(line)];
  }

  #decodeLine(line: string): FrameDecodeResult<T> {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return decodeFailure("malformed_frame", "Frame is not valid JSON", line);
    }

    if (
      typeof value === "object" &&
      value !== null &&
      "version" in value &&
      value.version !== BRIDGE_PROTOCOL_VERSION
    ) {
      return decodeFailure(
        "unsupported_version",
        `Unsupported bridge protocol version: ${String(value.version)}`,
        line,
      );
    }

    const parsed = v.safeParse(this.#schema, value);
    if (!parsed.success) {
      return decodeFailure(
        "malformed_frame",
        v.summarize(parsed.issues),
        line,
      );
    }

    return { ok: true, frame: parsed.output };
  }
}

/** Create a decoder that accepts only commands, responses, and events. */
export function createProtocolDecoder(): FrameDecoder<ProtocolFrame> {
  return new FrameDecoder(protocolFrameSchema);
}

/** Create a decoder that accepts only diagnostics. */
export function createDiagnosticDecoder(): FrameDecoder<DiagnosticFrame> {
  return new FrameDecoder(diagnosticFrameSchema);
}

/** Serialize one protocol frame as a complete JSONL record. */
export function encodeProtocolFrame(frame: ProtocolFrame): string {
  return encodeFrame(v.parse(protocolFrameSchema, frame));
}

/** Serialize one diagnostic frame as a complete JSONL record. */
export function encodeDiagnosticFrame(frame: DiagnosticFrame): string {
  return encodeFrame(v.parse(diagnosticFrameSchema, frame));
}

function encodeFrame(frame: BridgeFrame): string {
  return `${JSON.stringify(frame)}\n`;
}

function stripCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function decodeFailure<T>(
  code: FrameDecodeErrorCode,
  message: string,
  line: string,
): FrameDecodeResult<T> {
  return { ok: false, error: { code, message, line } };
}
