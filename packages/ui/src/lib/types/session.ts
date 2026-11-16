import type { WorkspaceGitStatus } from './workspace-files';
import type { PromptImage } from '../composer-images';

/** An agent Pau can start a session of, by the backend's identifier. */
export type SessionAgent = 'pi' | 'claude';

/**
 * Names an agent the way Pau shows it, from the backend's identifier. The
 * identifier arrives as a string, so any value other than `claude` reads as Pi.
 */
export function agentLabel(agent: string): string {
	return agent === 'claude' ? 'Claude Code' : 'Pi';
}

/** Lifecycle states shown by the session surface. */
export type SessionStatus =
	'starting' | 'idle' | 'running' | 'waiting' | 'not_responding' | 'stopping' | 'stopped' | 'failed';

/** Controls that an agent adapter makes available to the session surface. */
export type SessionCapabilities = {
	prompt: boolean;
	followUp: boolean;
	steer: boolean;
	interrupt: boolean;
	stop: boolean;
	/** Whether the session exposes its entry tree and can branch from it. Absent means it cannot. */
	branching?: boolean;
	/** Retries a failed turn and cancels a pending automatic retry. */
	retry?: boolean;
	/** Whether the agent can switch models. Absent means the surface offers no picker. */
	modelSelection?: boolean;
	/** Whether the agent exposes its queued messages and can clear them. */
	messageQueue?: boolean;
	/** Whether the agent can change the thinking level. Absent means the surface offers no control. */
	thinkingLevel?: boolean;
	/** Whether the agent can list its slash commands. Absent means the composer offers no completion. */
	commandDiscovery?: boolean;
	/** Whether the agent reports context and cost usage. Absent hides the context meter. */
	usage?: boolean;
	/** Whether the agent can compact its context on request. Absent means the surface offers no control. */
	compaction?: boolean;
	/** Whether the agent can rename the session. Absent means the surface offers no rename. */
	rename?: boolean;
	/** Whether the agent can clone the session into a new saved session. Absent means it cannot. */
	cloneSession?: boolean;
	/** Whether the agent can save its conversation to a file. Absent means it cannot. */
	exportTranscript?: boolean;
	/** Whether the agent can run shell commands from the composer and stop them. Absent means it cannot. */
	shellCommands?: boolean;
};

/** How much of the model's context window a session fills. */
export type ContextUsage = {
	/** Tokens in the window. Absent until the agent reports usage again after a compaction. */
	tokens?: number;
	/** The model's context window size in tokens. */
	contextWindow: number;
	/** Percent of the window in use, from 0 to 100. Absent when `tokens` is. */
	percent?: number;
};

/** Model token use and cost for a session, separate from machine resource use. */
export type SessionUsage = {
	/** Absent when the agent has no model or window size to report. */
	context?: ContextUsage;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	/** Cumulative cost in US dollars. */
	cost: number;
};

/** One slash command the agent accepts in a prompt. */
export type CommandOption = {
	/** The name typed after the slash, without the slash. */
	name: string;
	description?: string;
	/** Where the command comes from. Pau runs `builtin` commands itself instead of sending them. */
	source: 'builtin' | 'extension' | 'prompt' | 'skill';
	/** Arguments the command takes, shown after its name, such as `[level]`. */
	argument?: string;
	/** Why Pau cannot run the command. Completion lists it but does not pick it. */
	unavailable?: string;
};

/** One file or folder a prompt can mention with `@`. */
export type FileMention = {
	/** Slash-separated path relative to the workspace root. Folders end with a slash. */
	path: string;
	directory: boolean;
};

/** The files a mention search found. */
export type FileMentionSearch = {
	files: FileMention[];
	/** Whether the search stopped early, so a missing name may still exist. */
	truncated: boolean;
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
	/**
	 * Images sent with a user prompt, as the agent stored them. The view shows
	 * each one from its own data and never loads a URL.
	 */
	images?: PromptImage[];
	/**
	 * Images sent with the prompt that are not shown, by reason. The view names
	 * how many of each.
	 */
	hiddenImages?: HiddenImages;
};

/** Counts of the images in one prompt that the transcript does not show, by reason. */
export type HiddenImages = {
	/** Over the size of one image, the images of one request, or the pixel cap. */
	tooLarge?: number;
	/** Damaged data or a type prompts do not accept. */
	unreadable?: number;
	/**
	 * Dropped to keep the transcript's images within its memory budget. The
	 * view keeps a placeholder of the same size in place of each one, so the
	 * layout above the reader does not move when a newer prompt drops them.
	 */
	older?: number;
};

export type TranscriptThinking = { id: string; kind: 'thinking'; body: string; complete: boolean };

export type TranscriptTool = {
	id: string;
	kind: 'tool';
	name: string;
	/** One-line summary of the arguments: a path, a command, or the arguments as JSON. */
	detail: string;
	/** Text the tool returned, or its latest partial output while it runs. */
	result?: string;
	status: 'running' | 'complete' | 'failed';
	/**
	 * Arguments and result details for a built-in tool the transcript can
	 * render natively. Absent for other tools and while the model is still
	 * streaming the arguments; those render from `detail` and `result`.
	 */
	call?: ToolCallDetails;
	/** Set for a command the operator ran from the composer, rather than a call the model made. */
	shell?: ShellCommand;
};

/**
 * A command the operator ran from the composer with `!command` or
 * `!!command`. The entry's `call` holds the command line, exit code, and
 * full output path, and `result` holds the output, or the error when the
 * command could not run.
 */
export type ShellCommand = {
	/** Whether `!!` kept the command and its output out of the model context. */
	excludedFromContext: boolean;
	/** Whether the operator stopped the command before it finished. */
	cancelled?: boolean;
	/** Whether Pi kept only the end of a long output. */
	truncated?: boolean;
};

/** How much of a long output the tool kept. */
export type ToolTruncation = {
	/** The limit that cut the output. */
	truncatedBy: 'lines' | 'bytes';
	totalLines: number;
	/** Complete lines included in `result`. */
	outputLines: number;
};

/** One exact-text replacement requested from the `edit` tool. */
export type ToolEdit = { oldText: string; newText: string };

/** A `bash` call. Its output is the tool's `result`. */
export type BashToolCall = {
	tool: 'bash';
	command: string;
	/** Timeout the model requested, in seconds. */
	timeout?: number;
	/** Exit code, reported only while the session that ran the command is live. */
	exitCode?: number;
	/** Wall-clock run time, reported only while the session that ran the command is live. */
	durationMs?: number;
	/** Set when `result` holds only the tail of the output. */
	truncation?: ToolTruncation;
	/** File that holds the complete output when it was truncated. */
	fullOutputPath?: string;
};

/** A `read` call. The file text is the tool's `result`. */
export type ReadToolCall = {
	tool: 'read';
	path: string;
	/** First line requested, counting from 1. */
	offset?: number;
	/** Number of lines requested. */
	limit?: number;
	/** Set when `result` holds only part of the requested range. */
	truncation?: ToolTruncation;
};

/** An `edit` call, with the diff once the edit succeeds. */
export type EditToolCall = {
	tool: 'edit';
	path: string;
	edits: ToolEdit[];
	/** Display diff from the agent, with line numbers and `+`/`-` markers. */
	diff?: string;
	/** Standard unified patch of the same change. */
	patch?: string;
	/** First changed line in the new file. */
	firstChangedLine?: number;
};

/** A `write` call. The agent reports no diff; `content` is the whole new file. */
export type WriteToolCall = { tool: 'write'; path: string; content: string };

/** Structured data for the built-in tools, keyed by `tool`. */
export type ToolCallDetails = BashToolCall | ReadToolCall | EditToolCall | WriteToolCall;

/** What started a compaction: the operator, a full context, or a provider overflow. */
export type CompactionReason = 'manual' | 'threshold' | 'overflow';

/** Marker for a finished compaction, where older context became a summary. */
export type TranscriptCompaction = {
	id: string;
	kind: 'compaction';
	/** Absent for a compaction read from saved history, where Pi does not record what started it. */
	reason?: CompactionReason;
	summary: string;
	tokensBefore?: number;
	/** First agent entry kept verbatim after the summary. Hosts match later estimates to the marker by it. */
	firstKeptEntryId?: string;
	/** Estimate of the context size after compaction, when the agent reported one. */
	tokensAfter?: number;
	/** Whether the agent resends the interrupted message once compaction ends. */
	willRetry?: boolean;
};

/** A compaction in progress, or the last one that did not finish. A finished one becomes a transcript marker. */
export type CompactionState =
	| { status: 'running'; reason: CompactionReason }
	| { status: 'failed'; reason: CompactionReason; message?: string }
	| { status: 'aborted'; reason: CompactionReason };

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
export type TranscriptEntry =
	TranscriptMessage | TranscriptThinking | TranscriptTool | TranscriptCompaction | SandboxDenial;

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

/** Messages waiting to be delivered to a running session. */
export type MessageQueue = {
	/** Delivered after the current assistant turn and its tool calls. */
	steering: string[];
	/** Delivered after all current work finishes. */
	followUp: string[];
};

/** Session data consumed by the shared session surface. */
export type SessionViewModel = {
	id: string;
	workspaceId: string;
	/**
	 * The saved Pi session this session runs, once Pi has one. The rail leaves
	 * it out of the workspace's recent saved sessions, so it is listed once.
	 */
	savedSessionId?: string;
	title: string;
	agent: string;
	model?: string;
	/** Level last selected in this session, when known. */
	thinkingLevel?: ThinkingLevel;
	/**
	 * Levels the current model supports, in order. A model without reasoning
	 * offers only `off`. Absent until the agent reports them.
	 */
	thinkingLevels?: ThinkingLevel[];
	/** Context and cost use, when the agent has reported it. */
	usage?: SessionUsage;
	status: SessionStatus;
	attention?: string;
	/**
	 * Whether the session waited for input, failed, or finished a turn while
	 * the operator was looking at another session, and has not been opened
	 * since. The rail shows a marker until this clears.
	 */
	unseen?: boolean;
	error?: string;
	/**
	 * Whether the operator started this ended session again, which runs as a
	 * new session. It keeps its status and error as history and racks in
	 * Settled instead of Needs you.
	 */
	restarted?: boolean;
	capabilities: SessionCapabilities;
	transcript: TranscriptEntry[];
	extensionUi?: ExtensionUiState;
	autoRetry?: AutoRetry;
	compaction?: CompactionState;
	/** Queued steering and follow-up messages. Absent or empty hides the queue. */
	messageQueue?: MessageQueue;
};

/** Workspace and its sessions as shown in the contextual rail. */
export type SessionWorkspace = {
	id: string;
	name: string;
	/** The workspace folder, when known. Path actions in the rail need it. */
	path?: string;
	/** The current Git branch. Absent outside a repository, on a detached HEAD, or until it is read. */
	branch?: string;
	/** Changed files and HEAD from Git, once read. The workspace column lists the changes. */
	git?: WorkspaceGitStatus;
	/** Whether new agent sessions start sandboxed, with a one-line summary such as "Sandbox on, network off". */
	sandbox?: { sandboxed: boolean; label: string };
	/** Terminals open in the workspace, newest last. */
	terminals?: WorkspaceTerminal[];
	sessions: SessionViewModel[];
};

/** A terminal open in a workspace, as the workspace column lists it. */
export type WorkspaceTerminal = {
	id: string;
	/** The program it runs, such as `zsh`. */
	label: string;
	/** Its state in words, such as "Running" or "Exited 1". */
	status: string;
	/** Whether it has exited with a failure. */
	failed?: boolean;
};

/** Queue used when the operator sends text during an active run. */
export type PromptQueue = 'steer' | 'follow-up';

/** A saved Pi session that a workspace can resume. */
export type SavedSession = {
	id: string;
	/** Name the operator gave the session, or the start of its first message. */
	title: string;
	/** RFC 3339 time of the last change, when known. */
	modifiedAt?: string;
	/** Whether a live session already runs it, so opening it selects that session. */
	live?: boolean;
};

/** Saved sessions for one workspace, newest first, with files that could not be read. */
export type SavedSessionList = { sessions: SavedSession[]; warnings: { path: string; message: string }[] };

/** One entry in a session's persisted tree, such as a message or a compaction. */
export type SessionTreeItem = {
	id: string;
	/** The entry this one continues. Absent for a root or when the parent was left out. */
	parentId?: string;
	/** The agent's entry type, such as `message` or `compaction`. */
	kind: string;
	/** The message role, such as `user` or `assistant`, for message entries. */
	role?: string;
	/** The start of the entry's text, empty when it has none. */
	preview: string;
	/** ISO 8601 time the entry was recorded, when known. */
	timestamp?: string;
};

/** A session's entry tree, oldest entry first. */
export type SessionTreeSnapshot = {
	entries: SessionTreeItem[];
	/** The entry the session currently continues from. */
	leafId?: string;
	/** Whether older entries were left out to bound the response. */
	truncated: boolean;
};

/** One transcript entry that contains the searched text. */
export type SessionSearchHit = {
	/** The agent's entry identifier. */
	id: string;
	/** The message role, such as `user` or `assistant`. Absent for summaries. */
	role?: string;
	/** Whitespace-collapsed text around the first occurrence. */
	snippet: string;
	/** Start of the occurrence in `snippet`, in UTF-16 code units. */
	matchStart: number;
	/** End of the occurrence in `snippet`, in UTF-16 code units. */
	matchEnd: number;
	/** ISO 8601 time the entry was recorded, when known. */
	timestamp?: string;
	/** The transcript entry that shows this match. Absent when the loaded transcript has none. */
	entryKey?: string;
};

/** Matches for a transcript search, newest first. */
export type SessionSearchOutcome = {
	hits: SessionSearchHit[];
	/** Whether older matches were left out to honour the limit. */
	truncated: boolean;
};

/**
 * Result of branching from an earlier user message. `text` is that message's
 * prompt, which the composer offers for editing. `cancelled` reports that an
 * extension stopped the branch.
 */
export type SessionBranchOutcome = { text?: string; cancelled: boolean };
