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
