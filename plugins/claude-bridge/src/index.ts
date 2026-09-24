export {
  CLAUDE_CAPABILITIES,
  MAX_SUPPORTED_CLAUDE_MAJOR,
  MIN_SUPPORTED_CLAUDE_VERSION,
  ClaudeDiscoveryError,
  discoverClaude,
} from "./discovery.js";

export type {
  ClaudeCapabilities,
  ClaudeDiscovery,
  ClaudeDiscoveryErrorCode,
  ClaudeVersion,
  DiscoverClaudeOptions,
} from "./discovery.js";

export {
  CLAUDE_STRUCTURED_ARGS,
  ClaudeProcess,
  ClaudeProcessError,
  ClaudeProcessRegistry,
} from "./lifecycle.js";

export type {
  ClaudeProcessErrorCode,
  ClaudeProcessExit,
  ClaudeProcessState,
  ClaudeShutdownStage,
  ClaudeShutdownTimeouts,
  ResumeClaudeProcessOptions,
  StartClaudeProcessOptions,
} from "./lifecycle.js";

export { ClaudePromptError, ClaudeResumeError } from "./streaming.js";
export type {
  ClaudePromptErrorCode,
  ClaudeResumeErrorCode,
  ClaudePromptHandlers,
  ClaudeTurnCompletion,
} from "./streaming.js";

export {
  BRIDGE_PROTOCOL_VERSION,
  FrameDecoder,
  commandFrameSchema,
  createDiagnosticDecoder,
  createProtocolDecoder,
  diagnosticFrameSchema,
  encodeDiagnosticFrame,
  encodeProtocolFrame,
  eventFrameSchema,
  protocolFrameSchema,
  responseFrameSchema,
} from "./protocol.js";

export type {
  BridgeFrame,
  CommandFrame,
  DiagnosticFrame,
  EventFrame,
  FrameDecodeError,
  FrameDecodeErrorCode,
  FrameDecodeResult,
  JsonValue,
  ProtocolFrame,
  ResponseFrame,
} from "./protocol.js";
