/** Lifecycle states shown by the session surface. */
export type SessionStatus = 'starting' | 'idle' | 'running' | 'waiting' | 'stopping' | 'stopped' | 'failed';

/** Controls that an agent adapter makes available to the session surface. */
export type SessionCapabilities = {
	prompt: boolean;
	followUp: boolean;
	steer: boolean;
	interrupt: boolean;
	stop: boolean;
	/** Retries a failed turn and cancels a pending automatic retry. */
	retry?: boolean;
	/** Whether the agent can switch models. Absent means the surface offers no picker. */
	modelSelection?: boolean;
	/** Whether the agent can change the thinking level. Absent means the surface offers no control. */
	thinkingLevel?: boolean;
};

/** Thinking levels in the order the control lists them. The model may clamp a level it does not support. */
export const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export type ThinkingLevel = (typeof thinkingLevels)[number];

/** One model the agent can switch to. */
export type ModelOption = {
	provider: string;
	id: string;
	/** Display name, when the agent reports one. */
	name?: string;
	reasoning: boolean;
	current: boolean;
};

export type TranscriptMessage = {
	id: string;
	kind: 'message';
	role: 'user' | 'assistant';
	body: string;
	label?: string;
	/** Marks the error that ended an assistant turn. Only the latest one offers a retry. */
	failed?: boolean;
};

export type TranscriptThinking = { id: string; kind: 'thinking'; body: string; complete: boolean };

export type TranscriptTool = {
	id: string;
	kind: 'tool';
	name: string;
	detail: string;
	result?: string;
	status: 'running' | 'complete' | 'failed';
};

/** File operation blocked by a session's active sandbox policy. */
export type SandboxFileDenial = {
	id: string;
	kind: 'sandbox-denial';
	target: 'file';
	operation: 'read' | 'write' | 'create' | 'rename';
	path: string;
	reason: 'unreadable' | 'protected' | 'outside-writable';
};

/** Network connection blocked by a session's active sandbox policy. */
export type SandboxNetworkDenial = { id: string; kind: 'sandbox-denial'; target: 'network'; destination: string };

/** Sandboxed failure for which Pau could not identify the blocked access. */
export type UnexplainedSandboxFailure = { id: string; kind: 'sandbox-denial'; target: 'unexplained' };

/** Sandbox refusal or unexplained sandboxed failure shown in its owning session. */
export type SandboxDenial = SandboxFileDenial | SandboxNetworkDenial | UnexplainedSandboxFailure;

/** One projected transcript entry. Completed messages replace streamed text before display. */
export type TranscriptEntry = TranscriptMessage | TranscriptThinking | TranscriptTool | SandboxDenial;

/** Blocking interaction requested by a configured Pi extension. */
export type ExtensionDialog =
	| { id: string; kind: 'select'; title: string; options: string[]; timeoutMs?: number }
	| { id: string; kind: 'confirm'; title: string; message: string; timeoutMs?: number }
	| { id: string; kind: 'input'; title: string; placeholder?: string; timeoutMs?: number }
	| { id: string; kind: 'editor'; title: string; prefill?: string }
	| { id: string; kind: 'unsupported'; method: string };

/** Non-blocking message from a configured Pi extension. */
export type ExtensionNotification = { id: string; message: string; level: 'info' | 'warning' | 'error' };

/** One keyed status line from a configured Pi extension. */
export type ExtensionStatus = { key: string; text: string };

/** String-only widget from a configured Pi extension. */
export type ExtensionWidget = { key: string; lines: string[]; placement: 'above-editor' | 'below-editor' };

/** Extension-owned UI state projected from Pi RPC requests. */
export type ExtensionUiState = {
	dialog?: ExtensionDialog;
	notifications: ExtensionNotification[];
	statuses: ExtensionStatus[];
	widgets: ExtensionWidget[];
};

/** Response sent to the configured extension through Pi RPC. */
export type ExtensionUiResponse =
	{ id: string; value: string } | { id: string; confirmed: boolean } | { id: string; cancelled: true };

/** An automatic retry that Pi has scheduled after a transient provider error. */
export type AutoRetry = {
	/** One-based number of the attempt that will run next. */
	attempt: number;
	maxAttempts: number;
	/** Epoch milliseconds when the attempt starts. */
	retryAt: number;
	errorMessage?: string;
};

/** Session data consumed by the shared session surface. */
export type SessionViewModel = {
	id: string;
	workspaceId: string;
	title: string;
	agent: string;
	model?: string;
	/** Level last selected in this session, when known. */
	thinkingLevel?: ThinkingLevel;
	status: SessionStatus;
	attention?: string;
	error?: string;
	capabilities: SessionCapabilities;
	transcript: TranscriptEntry[];
	extensionUi?: ExtensionUiState;
	autoRetry?: AutoRetry;
};

/** Workspace and its sessions as shown in the contextual rail. */
export type SessionWorkspace = { id: string; name: string; sessions: SessionViewModel[] };

/** Queue used when the operator sends text during an active run. */
export type PromptQueue = 'steer' | 'follow-up';

/** A saved Pi session that a workspace can resume. */
export type SavedSession = {
	id: string;
	/** Name the operator gave the session, or the start of its first message. */
	title: string;
	/** RFC 3339 time of the last change, when known. */
	modifiedAt?: string;
};

/** Saved sessions for one workspace, newest first, with files that could not be read. */
export type SavedSessionList = { sessions: SavedSession[]; warnings: { path: string; message: string }[] };
