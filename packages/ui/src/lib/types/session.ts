/** Lifecycle states shown by the session surface. */
export type SessionStatus = 'starting' | 'idle' | 'running' | 'waiting' | 'stopping' | 'stopped' | 'failed';

/** Controls that an agent adapter makes available to the session surface. */
export type SessionCapabilities = {
	prompt: boolean;
	followUp: boolean;
	steer: boolean;
	interrupt: boolean;
	stop: boolean;
};

export type TranscriptMessage = {
	id: string;
	kind: 'message';
	role: 'user' | 'assistant';
	body: string;
	label?: string;
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

/** One projected transcript entry. Completed messages replace streamed text before display. */
export type TranscriptEntry = TranscriptMessage | TranscriptThinking | TranscriptTool;

/** Session data consumed by the shared session surface. */
export type SessionViewModel = {
	id: string;
	workspaceId: string;
	title: string;
	agent: string;
	model?: string;
	status: SessionStatus;
	attention?: string;
	error?: string;
	capabilities: SessionCapabilities;
	transcript: TranscriptEntry[];
};

/** Workspace and its sessions as shown in the contextual rail. */
export type SessionWorkspace = { id: string; name: string; sessions: SessionViewModel[] };

/** Queue used when the operator sends text during an active run. */
export type PromptQueue = 'steer' | 'follow-up';
