import type { Model } from '@earendil-works/pi-ai';
import type { AgentToolResult } from '@earendil-works/pi-coding-agent';

/** Pi built-in tools that the sandboxed host executes. */
export type SandboxedToolName = 'read' | 'write' | 'edit' | 'bash' | 'grep' | 'find' | 'ls';

/** Built-in tool names, in the order Pi registers them. */
export const sandboxedToolNames: SandboxedToolName[] = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'];

/**
 * Session state that built-in tools read from Pi's extension context. Bash
 * exposes it as `PI_SESSION_ID` and related variables, and read checks the
 * model's image support. The tool host has no Pi session of its own.
 */
export type ToolSession = { id: string; file?: string; model?: Model<string>; thinkingLevel?: string };

/** Requests from the Pi extension to the sandboxed tool host. */
export type ToolHostRequest =
	| { id: string; kind: 'tool'; tool: SandboxedToolName; toolCallId: string; params: unknown; session: ToolSession }
	| { id: string; kind: 'bash'; command: string; timeout?: number }
	| { id: string; kind: 'abort' };

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

/** A request before the client assigns its correlation ID. */
export type ToolHostRequestBody = WithoutId<ToolHostRequest>;

/** Responses from the tool host. Every request ends with one terminal response. */
export type ToolHostResponse =
	| { id: 'ready'; kind: 'ready'; pid: number }
	| { id: string; kind: 'update'; update: AgentToolResult<unknown> }
	| { id: string; kind: 'data'; data: string }
	| { id: string; kind: 'result'; result: AgentToolResult<unknown> }
	| { id: string; kind: 'exit'; exitCode: number | null }
	| { id: string; kind: 'error'; message: string };
