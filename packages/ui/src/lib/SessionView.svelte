<script lang="ts">
	import MetaText from './MetaText.svelte';
	import '../styles/tokens.css';
	import { onDestroy, tick, untrack, type Snippet } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { fade } from 'svelte/transition';
	import ApplicationShell, { type ShellNavItem, type ShellPaneWidths } from './ApplicationShell.svelte';
	import type { PaletteEntry } from './command-palette';
	import type { ThemeName, UiFontName } from '../theme';
	import {
		historyLimit,
		idleHistoryCursor,
		navigateHistory,
		recordPrompt,
		type HistoryCursor
	} from './composer-history';
	import {
		encodeImage,
		imageAccept,
		imageDragKind,
		imageRejection,
		imageTypeRule,
		isImageType,
		type ComposerImage,
		type ImageDragKind,
		type PromptImage
	} from './composer-images';
	import { announcementSnapshot, describeChanges, type AnnouncementSnapshot } from './transcript-announcements';
	import { copyText, findMessage, lastAssistantReply, type CopyResult } from './clipboard';
	import CopyButton from './CopyButton.svelte';
	import EmptyState from './EmptyState.svelte';
	import SessionStatusMark from './SessionStatusMark.svelte';
	import CommandCompletion from './CommandCompletion.svelte';
	import ContextMenu from './ContextMenu.svelte';
	import AgentReadinessNotice from './AgentReadinessNotice.svelte';
	import { codeSpans, withoutCodeMarks } from './code-spans';
	import type { AgentReadinessProblem } from './types/launch';
	import {
		contextMenuRequest,
		isContextMenuKey,
		revealLabel,
		type ContextMenuItem,
		type ContextMenuRequest
	} from './context-menu';
	import { builtinInvocation, withBuiltins, type BuiltinAction, type BuiltinInvocation } from './builtin-commands';
	import { commandName, commandQuery, filterCommands } from './command-completion';
	import ExtensionUi from './ExtensionUi.svelte';
	import SessionStatusLine from './SessionStatusLine.svelte';
	import { insertMention, mentionAt } from './file-mention';
	import MentionCompletion from './MentionCompletion.svelte';
	import { settlePendingPrompts, userMessageIds, type PendingPrompt } from './pending-prompts';
	import { COMPOSER_ATTRIBUTE, createFocusReturn } from './focus-return';
	import Icon from './Icon.svelte';
	import { composerKeyAction, resolveComposerKeys, type ComposerKeyAction } from './composer-keys';
	import { detectPlatform, eventChord, formatChord, getKeymap, useKeyActions } from './keymap.svelte';
	import Markdown from './Markdown.svelte';
	import { isReducedMotion, motion } from '../motion';
	import { BusyIndicator } from './busy-indicator.svelte';
	import ModelPicker from './ModelPicker.svelte';
	import ContextMeter from './ContextMeter.svelte';
	import ThinkingLevelPicker from './ThinkingLevelPicker.svelte';
	import SessionPicker from './SessionPicker.svelte';
	import Select from './Select.svelte';
	import SessionResourceSummary from './SessionResourceSummary.svelte';
	import SessionTree from './SessionTree.svelte';
	import { groupToolCalls, openByDefault, type TranscriptToolGroup } from './transcript-disclosure';
	import { followTranscript, scrollToLatest as scrollTranscriptToLatest, scrollToPrompt } from './transcript-follow';
	import ToolCallGroup from './ToolCallGroup.svelte';
	import ToolCallView from './ToolCallView.svelte';
	import TranscriptSearch from './TranscriptSearch.svelte';
	import type { ProcessResourceSnapshot } from './types/resource-monitoring';
	import type {
		CommandOption,
		CompactionReason,
		FileMention,
		FileMentionSearch,
		ExtensionUiResponse,
		ExtensionUiState,
		ModelOption,
		MessageQueue,
		ThinkingLevel,
		PromptQueue,
		SandboxDenial,
		SavedSession,
		SavedSessionList,
		SessionAgent,
		SessionBranchOutcome,
		SessionSearchHit,
		SessionSearchOutcome,
		SessionStatus,
		SessionTreeSnapshot,
		SessionViewModel,
		SessionWorkspace,
		TranscriptCompaction,
		TranscriptEntry,
		TranscriptTool
	} from './types/session';
	import { thinkingLevels } from './types/session';

	type Props = {
		workspaces: SessionWorkspace[];
		activeSessionId?: string;
		/** Terminals docked below the session. The app supplies them for the workspace in view. */
		dock?: Snippet;
		/** Whether the terminal dock shows. */
		dockOpen?: boolean;
		/** Called when the operator shows or hides the terminal dock. */
		onDockToggle?: (open: boolean) => void;
		/** Operator-chosen dock height in CSS pixels. */
		dockHeight?: number | null;
		/** Called with the new dock height after the operator resizes it. */
		onDockResize?: (height: number | null) => void;
		disconnected?: boolean;
		/** Shows the loading state until the first session list arrives. */
		loading?: boolean;
		onSelectSession?: (sessionId: string) => void;
		/**
		 * Called when the operator presses Shift+Esc to dismiss every session
		 * attention marker. Opening a session clears its own marker through
		 * `onSelectSession`.
		 */
		onClearAttention?: () => void;
		/** Called with the attached images only when there are any. */
		onSend?: (sessionId: string, text: string, queue?: PromptQueue, images?: PromptImage[]) => void | Promise<void>;
		/**
		 * Loads a session's earlier prompts, newest first, for recall with the
		 * Up and Down keys in the composer. A rejection leaves the history empty.
		 */
		onLoadHistory?: (sessionId: string) => Promise<string[]>;
		/**
		 * Lists the slash commands a session accepts, for completion in the
		 * composer. Called once per session and again after it restarts. A
		 * rejection leaves the composer without completion until the next try.
		 */
		onLoadCommands?: (sessionId: string) => Promise<CommandOption[]>;
		/**
		 * Lists the workspace files and folders that match the path typed after an
		 * `@` in the composer. Folders end with a slash. A rejection shows that the
		 * search failed, and the view aborts `signal` once a newer search starts.
		 * Without it, `@` does not open completion.
		 */
		onSearchFiles?: (workspaceId: string, query: string, signal: AbortSignal) => Promise<FileMentionSearch>;
		/**
		 * Interrupts the running turn. Pi drops any queued messages on interrupt,
		 * so return what the queue held and the view puts that text back in the
		 * composer. Return nothing, or an empty queue, when there is nothing to
		 * restore. A rejected promise shows its message in the notices.
		 */
		onInterrupt?: (sessionId: string) => void | MessageQueue | Promise<void | MessageQueue>;
		/**
		 * Runs a `!command` or `!!command` draft in the session's shell and
		 * resolves once it finishes. The transcript shows the command from the
		 * session's entries, not from this call. A rejection shows its message
		 * under the composer.
		 */
		onRunShellCommand?: (sessionId: string, command: string, excludeFromContext: boolean) => Promise<void>;
		/** Stops every running shell command in the session. */
		onStopShellCommands?: (sessionId: string) => Promise<void>;
		onStop?: (sessionId: string) => void | Promise<void>;
		/**
		 * Sends the last prompt again as a new message after a failed turn. Pi has
		 * no way to rerun a turn in place, so the prompt appears twice in the
		 * session. Pi's automatic retry handles transient provider errors without
		 * that copy. A rejected promise shows its message beside the control.
		 */
		onRetry?: (sessionId: string) => void | Promise<void>;
		/** Cancels an automatic retry that is waiting to run. */
		onCancelRetry?: (sessionId: string) => void | Promise<void>;
		/**
		 * Compacts an idle session's context. With this and the `compaction`
		 * capability, the session header offers a Compact control with an optional
		 * instructions field. A rejected promise shows its message in the notices.
		 */
		onCompact?: (sessionId: string, customInstructions?: string) => void | Promise<void>;
		/**
		 * Clears the session's queued messages and returns what the queue held.
		 * The view puts the returned text back in the composer. A rejected
		 * promise shows its message beside the queue.
		 */
		onClearQueue?: (sessionId: string) => Promise<MessageQueue>;
		/**
		 * Starts a session of an agent in a workspace. When set, the rail offers
		 * a start control for each workspace, which starts Pi, and the
		 * workspace menu and an opened workspace also offer Claude Code. A
		 * rejected promise shows its message as a failed start.
		 */
		onStartSession?: (workspaceId: string, agent: SessionAgent) => void | Promise<void>;
		/**
		 * Lists a workspace's saved sessions, newest first. With
		 * `onResumeSession`, the rail lists each workspace's newest saved
		 * sessions under its live ones and offers a picker for the rest.
		 */
		onLoadSavedSessions?: (workspaceId: string) => Promise<SavedSessionList>;
		/**
		 * Resumes a saved session. A rejected promise shows its message in the
		 * picker, under the rail for a recent saved session, or beside Resume
		 * for `restoredSession`.
		 */
		onResumeSession?: (workspaceId: string, savedSessionId: string) => void | Promise<void>;
		/**
		 * A stopped session that has no live session behind it, such as the
		 * session that was open when Pau last closed. The rail lists it under its
		 * workspace like other stopped sessions. It is open while no
		 * `activeSessionId` is passed, and the view then names it and offers
		 * Resume through `onResumeSession`. It never starts the agent on its
		 * own, because resuming starts a process.
		 */
		restoredSession?: SavedSession & { workspaceId: string };
		/** Opens `restoredSession` when the operator picks its rail row. */
		onOpenRestoredSession?: () => void;
		/**
		 * Starts a stopped or failed session again, from its saved conversation
		 * when the agent kept one. Without it, an ended session offers no way to
		 * start again. A rejected promise shows its message in the ended notice.
		 */
		onRestartSession?: (sessionId: string) => void | Promise<void>;
		/**
		 * Reads a session's entry tree. With `onBranchSession`, the inspector
		 * shows the tree of the active session.
		 */
		onLoadSessionTree?: (sessionId: string) => Promise<SessionTreeSnapshot>;
		/**
		 * Searches a session's transcript, newest matches first. With it, Cmd+F
		 * (Ctrl+F elsewhere) opens a find bar above the transcript. A rejected
		 * promise shows its message in the bar.
		 */
		onSearchSession?: (sessionId: string, query: string) => Promise<SessionSearchOutcome>;
		/**
		 * Branches a session from an earlier user message. The returned text
		 * replaces the composer draft. A rejection shows its message in the tree.
		 */
		onBranchSession?: (sessionId: string, entryId: string) => Promise<SessionBranchOutcome>;
		/**
		 * Branches a session from a user message in the transcript, named by its
		 * transcript entry ID. With it and the `branching` capability, the
		 * message's context menu offers Branch from here. The returned text
		 * replaces the composer draft. A rejection shows its message in the notices.
		 */
		onBranchFromMessage?: (sessionId: string, entryId: string) => Promise<SessionBranchOutcome>;
		/**
		 * Renames a session. With it and the `rename` capability, the session's
		 * context menu offers Rename. A rejection shows its message in the rail.
		 */
		onRenameSession?: (sessionId: string, name: string) => void | Promise<void>;
		/**
		 * Clones a session into a new saved session that the live session then
		 * continues. With it and the `cloneSession` capability, the session's
		 * context menu offers Clone. A rejection shows its message in the rail.
		 */
		onCloneSession?: (sessionId: string) => void | Promise<void>;
		/**
		 * Saves a session's whole conversation to a file the operator chooses.
		 * With it and the `exportTranscript` capability, the session header
		 * offers Export. Resolves to the saved file's path, or `undefined` when
		 * the operator cancels. A rejection shows its message in the notices.
		 */
		onExportTranscript?: (sessionId: string) => Promise<string | undefined>;
		/** Opens a terminal in a workspace. With it, the workspace's context menu offers Open terminal. */
		onOpenTerminal?: (workspaceId: string) => void;
		/**
		 * Why Pi cannot start a session, as launch found it. The empty views,
		 * where the operator starts sessions, show it with the fixing command.
		 */
		agentReadiness?: AgentReadinessProblem;
		/**
		 * Why Claude Code cannot start a session. The controls that start one
		 * are disabled with this reason, and an opened workspace shows it.
		 */
		claudeReadiness?: AgentReadinessProblem;
		/**
		 * Reads Claude Code's readiness again, bypassing any cached report.
		 * With it, the Claude Code notice offers Check again, since its
		 * disabled controls cannot fail a start that would read it again.
		 */
		onCheckClaude?: () => Promise<void>;
		/**
		 * Shows a path in the system file manager. The desktop app supplies it.
		 * With it, the workspace's context menu offers to reveal the folder.
		 */
		revealPath?: (path: string) => Promise<void>;
		/**
		 * Lists the models a session can use. With `onSelectModel`, the composer
		 * footer offers a model picker. A rejected promise shows its message.
		 */
		onLoadModels?: (sessionId: string) => Promise<ModelOption[]>;
		/** Switches a session's model. A rejected promise shows its message in the picker. */
		onSelectModel?: (sessionId: string, model: ModelOption) => void | Promise<void>;
		/**
		 * Sets a session's thinking level. With the model picker, the composer
		 * footer offers a level control. A rejected promise shows its message beside it.
		 */
		onSelectThinkingLevel?: (sessionId: string, level: ThinkingLevel) => void | Promise<void>;
		resourceSnapshot?: ProcessResourceSnapshot;
		onExtensionUiResponse?: (sessionId: string, response: ExtensionUiResponse) => void | Promise<void>;
		onExtensionUiTimeout?: (sessionId: string, requestId: string) => void;
		onOpenPiTerminal?: (sessionId: string) => void;
		/**
		 * Opens a folder as a workspace and resolves to its ID. Opening a folder
		 * that is already open resolves to the existing workspace. When set, the
		 * rail and the first-run screen offer an Open workspace control. A
		 * rejected promise shows its message beside the control.
		 */
		onOpenWorkspace?: (path: string) => Promise<string>;
		/**
		 * Asks the operator for a folder, resolving to its path or `undefined` on
		 * cancel. The desktop app supplies its native picker. Without it, the view
		 * asks for the folder path in a text field.
		 */
		pickFolder?: () => Promise<string | undefined>;
		/**
		 * Product rail destinations, supplied by the app that owns the routes. The
		 * view marks the Sessions item when a session needs attention.
		 */
		productItems?: ShellNavItem[];
		/** Saved widths for the resizable panes. */
		/** Color theme the shell applies. Defaults to the shell's own default. */
		theme?: ThemeName;
		/** UI font the shell applies. Defaults to the shell's own default. */
		uiFont?: UiFontName;
		paneWidths?: ShellPaneWidths;
		/** Called with the new widths after the operator resizes a pane. */
		onPaneResize?: (widths: ShellPaneWidths) => void;
		/**
		 * Whether the transcript is following its newest content. It follows while
		 * the operator is at the bottom and stops when they scroll up. Bind it to
		 * show a control that returns to the latest content.
		 */
		following?: boolean;
	};

	const defaultProductItems: ShellNavItem[] = [
		{ id: 'sessions', label: 'Sessions', icon: 'agents', active: true },
		{ id: 'files', label: 'Files', icon: 'files' },
		{ id: 'processes', label: 'Processes', icon: 'processes' },
		{ id: 'resources', label: 'Resources', icon: 'resources' },
		{ id: 'settings', label: 'Settings', icon: 'settings' }
	];

	let {
		workspaces,
		activeSessionId,
		dock,
		dockOpen,
		onDockToggle,
		dockHeight,
		onDockResize,
		disconnected = false,
		loading = false,
		onSelectSession = () => {},
		onClearAttention = () => {},
		onSend = () => {},
		onLoadHistory,
		onLoadCommands,
		onSearchFiles,
		onInterrupt = () => {},
		onRunShellCommand,
		onStopShellCommands,
		onStop = () => {},
		onRetry = () => {},
		onCompact,
		onClearQueue,
		onCancelRetry = () => {},
		onStartSession,
		onLoadSavedSessions,
		onResumeSession,
		restoredSession,
		onOpenRestoredSession,
		onRestartSession,
		onLoadSessionTree,
		onSearchSession,
		onBranchSession,
		onBranchFromMessage,
		onRenameSession,
		onCloneSession,
		onExportTranscript,
		onOpenTerminal,
		agentReadiness,
		claudeReadiness,
		onCheckClaude,
		revealPath,
		onLoadModels,
		onSelectModel,
		onSelectThinkingLevel,
		resourceSnapshot,
		onExtensionUiResponse = () => {},
		onExtensionUiTimeout = () => {},
		onOpenPiTerminal,
		onOpenWorkspace,
		pickFolder,
		productItems: appProductItems = defaultProductItems,
		theme,
		uiFont,
		paneWidths,
		onPaneResize,
		following = $bindable(true)
	}: Props = $props();

	/** Times the session-list loading state so a fast first load shows nothing. */
	const sessionsLoading = new BusyIndicator(() => loading);

	/**
	 * How many saved sessions the rail lists under each workspace's live
	 * sessions. The picker behind the history button lists the rest.
	 */
	const recentSessionLimit = 3;
	/** A workspace's saved sessions for the rail: loading, loaded, or failed. */
	type RecentSessions = { status: 'loading' } | { status: 'ready'; sessions: SavedSession[] } | { status: 'failed' };
	/** Each workspace's saved sessions for the rail, by workspace ID. Absent until the first load starts. */
	let recentSessions = $state<Record<string, RecentSessions>>({});
	/** Times the recent saved-session loads, which run together when the rail first shows. */
	const recentLoading = new BusyIndicator(() =>
		Object.values(recentSessions).some((recent) => recent.status === 'loading')
	);
	let transcriptElement = $state<HTMLElement>();

	/** Scrolls the transcript to its newest content and resumes following. */
	export function scrollToLatest() {
		if (transcriptElement) scrollTranscriptToLatest(transcriptElement);
	}

	/** Announces a copy through the status region so it is heard without moving focus. */
	function announceCopy(result: CopyResult): void {
		announcement = result.ok ? 'Copied' : result.error;
	}

	/**
	 * Copies a message to the clipboard: the Markdown source of an assistant
	 * message or the text of a user message. Returns undefined when the entry is
	 * not a message of the active session.
	 */
	export async function copyMessage(entryId: string): Promise<CopyResult | undefined> {
		const message = findMessage(activeSession?.transcript ?? [], entryId);
		if (!message) return undefined;
		const result = await copyText(message.body);
		announceCopy(result);
		return result;
	}

	/** Copies the newest assistant reply, for `/copy`. Returns undefined when there is none. */
	export async function copyLastReply(): Promise<CopyResult | undefined> {
		const reply = lastAssistantReply(activeSession?.transcript ?? []);
		return reply ? copyMessage(reply.id) : undefined;
	}

	/** Size of the transcript tail, which changes when entries arrive or the last entry streams more text. */
	function transcriptTail(): { length: number; size: number } {
		const entries = activeSession?.transcript ?? [];
		const last = entries.at(-1);
		return { length: entries.length, size: last ? JSON.stringify(last).length : 0 };
	}

	/** The transcript tail when following stopped. Cleared when following resumes. */
	let detachedTail = $state<{ length: number; size: number }>();

	$effect(() => {
		if (following || !activeSession) detachedTail = undefined;
		else if (!detachedTail) detachedTail = untrack(transcriptTail);
	});

	const tail = $derived(detachedTail ? transcriptTail() : { length: 0, size: 0 });
	const arrived = $derived(
		detachedTail !== undefined && (tail.length !== detachedTail.length || tail.size !== detachedTail.size)
	);
	const newEntries = $derived(arrived && detachedTail ? tail.length - detachedTail.length : 0);

	/** Delay that merges a burst of events into one announcement. */
	const announceDelayMs = 400;
	let announcement = $state('');
	let announced: AnnouncementSnapshot | undefined;
	let announcePending: string[] = [];
	let announceTimer: ReturnType<typeof setTimeout> | undefined;

	function queueAnnouncements(messages: string[]) {
		if (messages.length === 0) return;
		announcePending.push(...messages);
		clearTimeout(announceTimer);
		announceTimer = setTimeout(() => {
			announcement = [...new Set(announcePending)].join('. ');
			announcePending = [];
		}, announceDelayMs);
	}

	// Streamed text changes the snapshot but not the messages, so only events announce.
	$effect(() => {
		const next = activeSession ? announcementSnapshot(activeSession) : undefined;
		const messages = next
			? describeChanges(
					untrack(() => announced),
					next
				)
			: [];
		announced = next;
		queueAnnouncements(messages);
	});

	$effect(() => {
		if (arrived) untrack(() => queueAnnouncements(['New output below']));
	});

	onDestroy(() => clearTimeout(announceTimer));

	/** Whether the active session's current model reasons, as last reported by the model picker. */
	let currentModelReasoning = $state<boolean>();

	const emptyExtensionUi: ExtensionUiState = { notifications: [], statuses: [], widgets: [] };

	let draft = $state('');
	let queue = $state<PromptQueue>('steer');
	let histories = $state<Record<string, string[]>>({});
	let historyCursor = $state<HistoryCursor>(idleHistoryCursor);
	const historyRequested = new SvelteSet<string>();
	let commands = $state<Record<string, CommandOption[]>>({});
	const commandsRequested = new SvelteSet<string>();
	/** Tool and thinking blocks the operator opened or closed, keyed by entry ID. */
	const disclosures = new SvelteMap<string, boolean>();
	let commandSelected = $state(0);
	/** Whether the user typed the draft, so a recalled `/prompt` does not open completion. */
	let draftTyped = $state(false);
	/** The draft that Escape closed completion for. */
	let dismissedDraft = $state<string>();
	const commandListId = 'composer-commands';
	const mentionListId = 'composer-mentions';
	/** Wait after the last keystroke before searching the workspace. */
	const mentionDebounceMs = 150;
	/** The caret in the draft, which decides whether an `@` mention is open. */
	let caret = $state(0);
	let mentionResults = $state<FileMention[]>();
	/** Whether the last file search stopped early. */
	let mentionTruncated = $state(false);
	let mentionFailed = $state(false);
	let mentionSelected = $state(0);
	/** The draft that Escape closed file completion for. */
	let dismissedMention = $state<string>();
	let mentionRun = 0;
	let sending = $state(false);
	let error = $state<string>();
	/** Prompts drawn before their session shows them, in submission order. */
	let pendingPrompts = $state<PendingPrompt[]>([]);
	let pendingSequence = 0;
	let composer = $state<HTMLTextAreaElement>();
	let modelPicker = $state<ModelPicker>();
	let thinkingPicker = $state<ThinkingLevelPicker>();
	let sessionTree = $state<SessionTree>();
	const keymap = getKeymap();
	const keyPlatform = keymap?.platform ?? detectPlatform();
	/** Pi's composer keys, with the operator's bindings once the app loads them. */
	const composerKeys = $derived(resolveComposerKeys(keymap?.piBindings ?? [], keyPlatform));
	const submitShortcut = $derived(composerKeyShortcut('submit'));
	const interruptShortcut = $derived(composerKeyShortcut('interrupt'));
	let transcriptSearch = $state<TranscriptSearch>();
	let searchOpen = $state(false);
	/** Where the Cmd+F shortcut was pressed, so closing the find bar returns there. */
	const searchFocus = createFocusReturn();
	/** The entry the last search selection brought into view. */
	let foundEntryKey = $state<string>();
	let foundTimer: ReturnType<typeof setTimeout> | undefined;
	let imagePicker = $state<HTMLInputElement>();
	let images = $state<ComposerImage[]>([]);
	let imageError = $state<string>();
	/**
	 * The drop target over the composer: what the dragged files are, or
	 * `rejected` for a moment after a drop that attached nothing.
	 */
	let dropTarget = $state<ImageDragKind | 'rejected'>();
	/** Drag enters minus leaves, so crossing onto a child keeps the target. */
	let dragDepth = 0;
	let dropRejectionTimer: ReturnType<typeof setTimeout> | undefined;
	let startingWorkspaceId = $state<string>();
	let startFailure = $state<{ workspaceId: string; workspaceName: string; agent: SessionAgent; message: string }>();
	let controlError = $state<string>();
	/**
	 * Sessions whose transcript export is in flight, so Export cannot run twice
	 * for one session while another session's export finishes on its own.
	 */
	const exportingSessionIds = new SvelteSet<string>();
	/** Where the last transcript export saved its file, until another action replaces the notice. */
	let exportedTranscript = $state<{ sessionId: string; path: string }>();
	/** The ended session whose restart is in flight, so its button cannot start it twice. */
	let restartingSessionId = $state<string>();
	let restartError = $state<string>();
	/**
	 * The saved session whose resume is in flight, from the rail or the
	 * restored session's Resume, so no click can start a second one.
	 */
	let resumingSavedId = $state<string>();
	let resumeError = $state<string>();
	/** The open context menu, if any. */
	let contextMenu = $state<ContextMenuRequest>();
	/** Why the last rail action from a context menu failed. */
	let railError = $state<string>();
	/** The session whose name is being edited in the rail. */
	let renamingSessionId = $state<string>();
	let renameDraft = $state('');
	let pickerWorkspaceId = $state<string>();
	let retryingSessionId = $state<string>();
	let retryError = $state<string>();
	let queueError = $state<string>();
	let compactOpen = $state(false);
	let compactInstructions = $state('');
	let compactingSessionId = $state<string>();
	let compactError = $state<string>();
	let now = $state(Date.now());
	/** Whether the folder path form is showing. Only used without `pickFolder`. */
	let openFormVisible = $state(false);
	let openPath = $state('');
	let opening = $state(false);
	let openError = $state<string>();
	/** A workspace the operator just opened that has no session to show yet. */
	let openedWorkspaceId = $state<string>();

	const pickerWorkspace = $derived(workspaces.find((workspace) => workspace.id === pickerWorkspaceId));
	// Each workspace loads its recent saved sessions once, when the rail first lists it.
	$effect(() => {
		if (!onLoadSavedSessions || !onResumeSession || sessionsLoading.active) return;
		for (const workspace of workspaces) {
			if (!untrack(() => recentSessions[workspace.id])) void loadRecent(workspace.id);
		}
	});
	const openedWorkspace = $derived(workspaces.find((workspace) => workspace.id === openedWorkspaceId));
	const sessions = $derived(workspaces.flatMap((workspace) => workspace.sessions));
	const activeSession = $derived(sessions.find((session) => session.id === activeSessionId));
	$effect(() => {
		const settled = settlePendingPrompts(pendingPrompts, sessions);
		if (settled !== pendingPrompts) pendingPrompts = settled;
	});
	const activePending = $derived(pendingPrompts.filter((prompt) => prompt.sessionId === activeSession?.id));
	/** Prompts that join the transcript. Queued prompts wait in the queue list instead. */
	const pendingTranscript = $derived(activePending.filter((prompt) => !prompt.queue));
	const pendingQueue = $derived(activePending.filter((prompt) => prompt.queue));
	/** Whether the restored session is the one open, which happens while no live session is. */
	const restoredOpen = $derived(restoredSession !== undefined && activeSession === undefined);
	const activeWorkspace = $derived(
		workspaces.find((workspace) =>
			restoredOpen
				? workspace.id === restoredSession?.workspaceId
				: workspace.sessions.some((session) => session.id === activeSessionId)
		)
	);
	const canQueue = $derived(
		activeSession ? activeSession.capabilities.steer || activeSession.capabilities.followUp : false
	);
	const activeQueue = $derived<PromptQueue>(
		activeSession && !activeSession.capabilities.steer && activeSession.capabilities.followUp ? 'follow-up' : queue
	);
	const sessionCommands = $derived(
		activeSession?.capabilities.commandDiscovery ? commands[activeSession.id] : undefined
	);
	/** The session's commands followed by Pi's built-ins, which Pau runs itself. */
	const composerCommands = $derived(sessionCommands ? withBuiltins(sessionCommands) : undefined);
	const commandMatches = $derived.by(() => {
		const query = commandQuery(draft);
		return composerCommands && draftTyped && query !== undefined && dismissedDraft !== draft
			? filterCommands(composerCommands, query)
			: undefined;
	});
	/** The built-in the draft runs on submit instead of sending it. */
	const draftBuiltin = $derived(sessionCommands ? builtinInvocation(draft, sessionCommands) : undefined);
	/**
	 * The shell command the draft runs on submit, parsed as Pi's editor does:
	 * `!!` keeps the command out of the model context, and a `!` or `!!` with
	 * nothing after it is sent as a prompt.
	 */
	const draftShell = $derived.by(() => {
		const text = draft.trim();
		if (!text.startsWith('!')) return;
		const excludeFromContext = text.startsWith('!!');
		const command = text.slice(excludeFromContext ? 2 : 1).trim();
		return command ? { command, excludeFromContext } : undefined;
	});
	/** Whether a shell command the operator started is still running in the active session. */
	const shellRunning = $derived(
		activeSession?.transcript.some((entry) => entry.kind === 'tool' && entry.shell && entry.status === 'running') ??
			false
	);
	const mentionToken = $derived(onSearchFiles && draftTyped ? mentionAt(draft, caret) : undefined);
	const mentionQuery = $derived(mentionToken?.query);
	const mentionOpen = $derived(
		mentionToken !== undefined &&
			dismissedMention !== draft &&
			(mentionResults !== undefined || mentionFailed) &&
			!commandMatches
	);
	/** The option the composer announces as active, for whichever list is open. */
	const activeOption = $derived.by(() => {
		if (commandMatches?.length) {
			return { list: commandListId, index: Math.min(commandSelected, commandMatches.length - 1) };
		}
		return mentionOpen && mentionResults?.length
			? { list: mentionListId, index: Math.min(mentionSelected, mentionResults.length - 1) }
			: undefined;
	});
	const unknownCommand = $derived.by(() => {
		const name = commandName(draft);
		return composerCommands !== undefined &&
			name !== undefined &&
			commandQuery(draft) === undefined &&
			composerCommands.every((command) => command.name !== name)
			? name
			: undefined;
	});

	const canRetry = $derived(
		Boolean(activeSession?.capabilities.retry) && activeSession?.status === 'idle' && !disconnected
	);
	/** Only the failure that ended the transcript offers to send its prompt again. */
	const retryableEntryId = $derived.by(() => {
		const last = activeSession?.transcript.at(-1);
		return last?.kind === 'message' && last.failed ? last.id : undefined;
	});
	const queuedCount = $derived(
		onClearQueue && activeSession?.capabilities.messageQueue
			? (activeSession.messageQueue?.steering.length ?? 0) + (activeSession.messageQueue?.followUp.length ?? 0)
			: 0
	);
	const retrying = $derived(retryingSessionId !== undefined && retryingSessionId === activeSession?.id);
	const autoRetry = $derived(activeSession?.autoRetry);
	const autoRetrySeconds = $derived(autoRetry ? Math.max(0, Math.ceil((autoRetry.retryAt - now) / 1000)) : 0);
	const autoRetryLabel = $derived(
		autoRetry
			? `${autoRetrySeconds > 0 ? `Retrying in ${autoRetrySeconds}s` : 'Retrying now'}, attempt ${autoRetry.attempt} of ${autoRetry.maxAttempts}.`
			: ''
	);
	/** Statuses with a running agent process. Compact and Stop show only in these. */
	const liveStatuses = new Set<SessionStatus>(['idle', 'running', 'waiting']);
	/** Whether the session's agent process has ended, which replaces the composer with a notice. */
	const ended = $derived(activeSession?.status === 'stopped' || activeSession?.status === 'failed');
	const canCompact = $derived(Boolean(activeSession?.capabilities.compaction) && onCompact !== undefined);
	const compactionState = $derived(activeSession?.compaction);
	const compacting = $derived(
		compactionState?.status === 'running' ||
			(compactingSessionId !== undefined && compactingSessionId === activeSession?.id)
	);
	const composerUnavailable = $derived(composerUnavailableReason(activeSession, disconnected, compacting));
	const paletteEntries = $derived<PaletteEntry[]>([
		...workspaces.flatMap((workspace) =>
			workspace.sessions.map((session) => ({
				id: `session:${session.id}`,
				label: session.title,
				group: 'Sessions' as const,
				detail: workspace.name,
				run: () => selectSession(session.id)
			}))
		),
		...workspaces.map((workspace) => ({
			id: `workspace:${workspace.id}`,
			label: workspace.name,
			group: 'Workspaces' as const,
			run: () => showWorkspace(workspace.id)
		}))
	]);
	const productItems = $derived(
		appProductItems.map((item) =>
			item.id === 'sessions' ? { ...item, attention: sessions.some((session) => hasAttention(session)) } : item
		)
	);

	/** Runs one file search and keeps the result only while it is the latest. */
	async function searchMentions(
		search: NonNullable<typeof onSearchFiles>,
		workspaceId: string,
		query: string,
		signal: AbortSignal
	): Promise<void> {
		const run = mentionRun;
		try {
			const { files, truncated } = await search(workspaceId, query, signal);
			if (run !== mentionRun) return;
			mentionResults = files;
			mentionTruncated = truncated;
			mentionFailed = false;
			mentionSelected = 0;
		} catch {
			if (run !== mentionRun) return;
			mentionResults = [];
			mentionTruncated = false;
			mentionFailed = true;
		}
	}

	$effect(() => {
		const workspaceId = activeWorkspace?.id;
		const query = mentionQuery;
		const search = onSearchFiles;
		mentionRun += 1;
		if (query === undefined || !workspaceId || !search) {
			mentionResults = undefined;
			mentionFailed = false;
			return;
		}
		const controller = new AbortController();
		const timer = setTimeout(
			() => void searchMentions(search, workspaceId, query, controller.signal),
			mentionDebounceMs
		);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});

	$effect(() => {
		if (activeSession?.status === 'running' || activeSession?.id !== retryingSessionId) retryingSessionId = undefined;
	});

	$effect(() => {
		if (!autoRetry) return;
		now = Date.now();
		const timer = setInterval(() => (now = Date.now()), 250);
		return () => clearInterval(timer);
	});

	$effect(() => {
		void activeSession?.id;
		retryError = undefined;
		compactError = undefined;
		compactOpen = false;
		compactInstructions = '';
	});

	function hasAttention(session: SessionViewModel): boolean {
		return session.status === 'waiting' || Boolean(session.attention) || session.status === 'failed';
	}

	const markerLabel = {
		waiting: 'Waiting for your input',
		failed: 'Failed while out of view',
		unread: 'Finished while out of view'
	} as const;

	function markerKind(status: SessionViewModel['status']): keyof typeof markerLabel {
		return status === 'waiting' ? 'waiting' : status === 'failed' ? 'failed' : 'unread';
	}

	/** The header reports compaction as the state, so it never reads Ready while Compact is busy. */
	const headerCompacting = $derived(compacting && ['idle', 'running'].includes(activeSession?.status ?? ''));
	const headerStatus = $derived(headerCompacting ? 'running' : (activeSession?.status ?? 'idle'));
	const headerStatusLabel = $derived(headerCompacting ? 'Compacting…' : statusLabel(activeSession?.status ?? 'idle'));

	function statusLabel(status: SessionViewModel['status']): string {
		return {
			starting: 'Starting',
			idle: 'Ready',
			running: 'Running',
			waiting: 'Needs you',
			not_responding: 'Not responding',
			stopping: 'Stopping',
			stopped: 'Stopped',
			failed: 'Failed'
		}[status];
	}

	/** Explains why the composer is disabled, or returns `undefined` when it accepts text. */
	function composerUnavailableReason(
		session: SessionViewModel | undefined,
		offline: boolean,
		compactingNow: boolean
	): string | undefined {
		if (!session) return undefined;
		if (['starting', 'stopping', 'stopped', 'failed'].includes(session.status)) return '';
		if (session.status === 'not_responding') {
			return `${session.agent} stopped responding. Stop this session and start a new one.`;
		}
		if (offline) return 'Pau is reconnecting to the backend. You can send prompts again once it reconnects.';
		// During a run, steering and follow-ups still queue behind the compaction.
		if (compactingNow && session.status !== 'running') {
			return `${session.agent} is compacting the conversation. You can send a prompt when it finishes.`;
		}
		if (!session.capabilities.prompt) return `${session.agent} does not accept prompts in this session.`;
		if (session.status === 'running' && !session.capabilities.steer && !session.capabilities.followUp) {
			return `${session.agent} cannot take new direction during a run. Send your prompt when this run finishes.`;
		}
		return undefined;
	}

	/** Explains why branching must wait, or returns `undefined` when the session can branch now. */
	function branchUnavailableReason(session: SessionViewModel, offline: boolean): string | undefined {
		if (offline) return 'Pau is reconnecting to the backend. You can branch again once it reconnects.';
		if (session.status === 'idle') return undefined;
		if (['stopped', 'failed', 'stopping'].includes(session.status)) {
			return 'This session has ended, so it cannot branch.';
		}
		return `Wait for ${session.agent} to finish before branching.`;
	}

	/**
	 * Opens the find bar on Cmd+F or Ctrl+F. This local handler stands in for
	 * the shared keymap registry, which should take over the binding.
	 */
	function handleSearchShortcut(event: KeyboardEvent): void {
		const command = event.metaKey !== event.ctrlKey;
		const plainF = event.key.toLowerCase() === 'f' && !event.altKey && !event.shiftKey;
		if (!onSearchSession || !activeSession || !command || !plainF) return;
		event.preventDefault();
		if (searchOpen) transcriptSearch?.focus();
		else {
			searchFocus.capture();
			searchOpen = true;
		}
	}

	function closeSearch(): void {
		searchOpen = false;
		searchFocus.restore();
	}

	/**
	 * Scrolls the transcript to the entry that shows a match and marks it for
	 * a moment. Returns `false` when the loaded transcript does not hold it.
	 */
	function showSearchHit(hit: SessionSearchHit): boolean {
		const target = hit.entryKey
			? [...(transcriptElement?.querySelectorAll<HTMLElement>('[data-entry-id]') ?? [])].find(
					(element) => element.dataset.entryId === hit.entryKey
				)
			: undefined;
		if (!target) return false;
		// A match inside a collapsed group of tool calls has no box to scroll to
		// until the group opens. Its toggle event records the change as an operator choice.
		const group = target.closest('[data-group-id]');
		if (group instanceof HTMLDetailsElement) group.open = true;
		target.scrollIntoView({ block: 'center', behavior: isReducedMotion() ? 'auto' : 'smooth' });
		foundEntryKey = hit.entryKey;
		clearTimeout(foundTimer);
		foundTimer = setTimeout(() => (foundEntryKey = undefined), 1600);
		return true;
	}

	function branched(text: string): void {
		draft = text;
		error = undefined;
		composer?.focus();
	}

	/** Explains why the model picker is read-only, or returns `undefined` when it accepts a change. */
	function modelUnavailableReason(session: SessionViewModel, offline: boolean): string | undefined {
		if (offline) return 'Pau is reconnecting to the backend. You can switch models once it reconnects.';
		if (session.status === 'running') return 'Wait for this run to finish before switching models.';
		if (session.status !== 'idle') return 'This session cannot switch models right now.';
		return undefined;
	}

	/**
	 * Whether the session's model has thinking levels. Levels that Pi reported
	 * for the model win over the model list, which can lag a model change.
	 */
	function offersThinking(session: SessionViewModel): boolean {
		if (session.thinkingLevels) return session.thinkingLevels.some((level) => level !== 'off');
		return currentModelReasoning !== false;
	}

	/** Explains why the thinking level is read-only, or returns `undefined` when it accepts a change. */
	function thinkingUnavailableReason(session: SessionViewModel, offline: boolean): string | undefined {
		if (offline) return 'Pau is reconnecting to the backend. You can change the thinking level once it reconnects.';
		if (session.status === 'running') return 'Wait for this run to finish before changing the thinking level.';
		if (session.status !== 'idle') return 'This session cannot change its thinking level right now.';
		return undefined;
	}

	/** Explains why Compact is disabled, or returns `undefined` when it can run. */
	function compactUnavailableReason(session: SessionViewModel, offline: boolean, busy: boolean): string | undefined {
		if (offline) return 'Pau is reconnecting to the backend. You can compact once it reconnects.';
		if (busy) return 'The conversation is already being compacted.';
		if (session.status === 'running') return 'Wait for this run to finish before compacting.';
		if (session.status !== 'idle') return 'This session cannot be compacted right now.';
		return undefined;
	}

	function compactingLabel(reason: CompactionReason): string {
		return {
			manual: 'Compacting the conversation…',
			threshold: 'Pi is compacting the conversation because the context is nearly full.',
			overflow: "Pi is compacting the conversation because it outgrew the model's context window."
		}[reason];
	}

	const tokenFormat = new Intl.NumberFormat('en-US');

	function compactionSizes(entry: TranscriptCompaction): string | undefined {
		if (entry.tokensBefore === undefined) return undefined;
		const before = tokenFormat.format(entry.tokensBefore);
		return entry.tokensAfter === undefined
			? `${before} tokens before`
			: `${before} → about ${tokenFormat.format(entry.tokensAfter)} tokens`;
	}

	/** Names the prompt images not shown for one reason, such as `2 images not shown: too large`. */
	function hiddenImagesLabel(count: number, reason: string): string {
		return `${count === 1 ? 'Image' : `${count} images`} not shown: ${reason}`;
	}

	async function compact(): Promise<void> {
		if (!onCompact || !activeSession || compacting) return;
		const sessionId = activeSession.id;
		const instructions = compactInstructions.trim();
		compactError = undefined;
		compactingSessionId = sessionId;
		compactOpen = false;
		try {
			await onCompact(sessionId, instructions || undefined);
			if (activeSessionId === sessionId) compactInstructions = '';
		} catch (cause) {
			compactError = cause instanceof Error ? cause.message : 'The conversation could not be compacted. Try again.';
		} finally {
			if (compactingSessionId === sessionId) compactingSessionId = undefined;
		}
	}

	/** Starts opening a workspace with the native picker, or shows the path form. */
	async function chooseWorkspace(): Promise<void> {
		openError = undefined;
		if (!pickFolder) {
			openFormVisible = true;
			return;
		}
		let path: string | undefined;
		try {
			path = await pickFolder();
		} catch (cause) {
			openError = cause instanceof Error ? cause.message : 'Pau could not show the folder picker.';
			return;
		}
		if (path) await openFolder(path);
	}

	async function openFolder(path: string): Promise<void> {
		if (!onOpenWorkspace || opening) return;
		opening = true;
		openError = undefined;
		try {
			const workspaceId = await onOpenWorkspace(path);
			openFormVisible = false;
			openPath = '';
			pickerWorkspaceId = undefined;
			startFailure = undefined;
			showWorkspace(workspaceId);
		} catch (cause) {
			openError = cause instanceof Error ? cause.message : 'Pau could not open that folder.';
		} finally {
			opening = false;
		}
	}

	/** Selects a workspace's first session, or shows the workspace's start prompt when it has none. */
	function showWorkspace(workspaceId: string): void {
		const first = workspaces.find((workspace) => workspace.id === workspaceId)?.sessions[0];
		if (first) selectSession(first.id);
		else {
			pickerWorkspaceId = undefined;
			startFailure = undefined;
			closeOpenForm();
			openedWorkspaceId = workspaceId;
		}
	}

	function closeOpenForm(): void {
		openFormVisible = false;
		openError = undefined;
	}

	async function startSession(workspace: SessionWorkspace, agent: SessionAgent = 'pi'): Promise<void> {
		if (!onStartSession || startingWorkspaceId) return;
		startingWorkspaceId = workspace.id;
		startFailure = undefined;
		openedWorkspaceId = undefined;
		closeOpenForm();
		try {
			await onStartSession(workspace.id, agent);
		} catch (cause) {
			startFailure = {
				workspaceId: workspace.id,
				workspaceName: workspace.name,
				agent,
				message: cause instanceof Error ? cause.message : 'Try again, or open Diagnostics for details.'
			};
		} finally {
			startingWorkspaceId = undefined;
		}
	}

	async function loadHistory(sessionId: string, load: (sessionId: string) => Promise<string[]>): Promise<void> {
		try {
			const loaded = await load(sessionId);
			// Prompts sent while the request was in flight are already recorded.
			histories[sessionId] = [...(histories[sessionId] ?? []), ...loaded].slice(0, historyLimit);
		} catch {
			historyRequested.delete(sessionId);
		}
	}

	async function loadCommands(sessionId: string, load: (sessionId: string) => Promise<CommandOption[]>): Promise<void> {
		try {
			commands[sessionId] = await load(sessionId);
		} catch {
			commandsRequested.delete(sessionId);
		}
	}

	$effect(() => {
		const sessionId = activeSessionId;
		if (!sessionId || !onLoadHistory || historyRequested.has(sessionId)) return;
		historyRequested.add(sessionId);
		void loadHistory(sessionId, onLoadHistory);
	});

	$effect(() => {
		const session = activeSession;
		if (!session || !onLoadCommands || !session.capabilities.commandDiscovery) return;
		const sessionId = session.id;
		if (['starting', 'stopping', 'stopped', 'failed'].includes(session.status)) {
			// The next ready state reloads, since a restart can change the commands.
			commandsRequested.delete(sessionId);
			delete commands[sessionId];
			return;
		}
		if (commandsRequested.has(sessionId)) return;
		commandsRequested.add(sessionId);
		void loadCommands(sessionId, onLoadCommands);
	});

	async function stop(): Promise<void> {
		if (!activeSession) return;
		controlError = undefined;
		try {
			await onStop(activeSession.id);
		} catch (cause) {
			controlError = cause instanceof Error ? cause.message : 'The session could not be stopped. Try again.';
		}
	}

	/** Asks the app where to save the active session's transcript and reports the outcome. */
	async function exportTranscript(session: SessionViewModel): Promise<void> {
		if (!onExportTranscript) return;
		controlError = undefined;
		exportedTranscript = undefined;
		exportingSessionIds.add(session.id);
		try {
			const path = await onExportTranscript(session.id);
			if (path) exportedTranscript = { sessionId: session.id, path };
		} catch (cause) {
			controlError = cause instanceof Error ? cause.message : 'Pau could not export the transcript. Try again.';
		} finally {
			exportingSessionIds.delete(session.id);
		}
	}

	/**
	 * Resumes a saved session and returns why it failed, if it did. Only the
	 * operator's click calls this, because resuming starts the agent.
	 */
	async function resumeSaved(workspaceId: string, savedSessionId: string): Promise<string | undefined> {
		if (!onResumeSession || resumingSavedId) return;
		resumingSavedId = savedSessionId;
		try {
			await onResumeSession(workspaceId, savedSessionId);
		} catch (cause) {
			return cause instanceof Error ? cause.message : 'The session could not resume. Try again.';
		} finally {
			resumingSavedId = undefined;
		}
	}

	/** Resumes the restored session from its Resume button. */
	async function resumeRestored(restored: SavedSession & { workspaceId: string }): Promise<void> {
		resumeError = undefined;
		resumeError = await resumeSaved(restored.workspaceId, restored.id);
	}

	/** Resumes a recent saved session from its rail row, as the picker does. */
	async function resumeRecent(workspaceId: string, savedSessionId: string): Promise<void> {
		pickerWorkspaceId = undefined;
		openedWorkspaceId = undefined;
		closeOpenForm();
		startFailure = undefined;
		railError = undefined;
		railError = await resumeSaved(workspaceId, savedSessionId);
	}

	/** Loads a workspace's saved sessions for the rail. A failure offers Try again. */
	async function loadRecent(workspaceId: string): Promise<void> {
		if (!onLoadSavedSessions) return;
		recentSessions[workspaceId] = { status: 'loading' };
		try {
			const list = await onLoadSavedSessions(workspaceId);
			recentSessions[workspaceId] = { status: 'ready', sessions: list.sessions };
		} catch {
			recentSessions[workspaceId] = { status: 'failed' };
		}
	}

	/**
	 * The workspace's newest saved sessions that the rail does not already
	 * list as a live, stopped, or restored session.
	 */
	function recentRows(workspace: SessionWorkspace): SavedSession[] {
		const recent = recentSessions[workspace.id];
		if (recent?.status !== 'ready') return [];
		const listed = workspace.sessions.map((session) => session.savedSessionId);
		if (restoredSession?.workspaceId === workspace.id) listed.push(restoredSession.id);
		return recent.sessions.filter((saved) => !saved.live && !listed.includes(saved.id)).slice(0, recentSessionLimit);
	}

	/** Starts the ended session again. The draft stays in the composer for the new run. */
	async function restart(sessionId: string): Promise<void> {
		if (!onRestartSession || restartingSessionId) return;
		restartingSessionId = sessionId;
		restartError = undefined;
		try {
			await onRestartSession(sessionId);
		} catch (cause) {
			restartError = cause instanceof Error ? cause.message : 'The session could not start again. Try again.';
		} finally {
			restartingSessionId = undefined;
		}
	}

	function selectSession(sessionId: string): void {
		pickerWorkspaceId = undefined;
		openedWorkspaceId = undefined;
		closeOpenForm();
		startFailure = undefined;
		controlError = undefined;
		exportedTranscript = undefined;
		restartError = undefined;
		queueError = undefined;
		error = undefined;
		draft = '';
		draftTyped = false;
		historyCursor = idleHistoryCursor;
		onSelectSession(sessionId);
	}

	/** Opens the restored session from its rail row. */
	function openRestored(): void {
		pickerWorkspaceId = undefined;
		openedWorkspaceId = undefined;
		closeOpenForm();
		startFailure = undefined;
		onOpenRestoredSession?.();
	}

	function moveSession(sessionId: string, offset: number): void {
		const index = sessions.findIndex((session) => session.id === sessionId);
		if (index === -1) return;
		const next = sessions[(index + offset + sessions.length) % sessions.length];
		if (next) selectSession(next.id);
	}

	/** Reports the failure of a context menu action in the rail. */
	async function railAction(action: () => unknown, fallback: string): Promise<void> {
		railError = undefined;
		try {
			await action();
		} catch (cause) {
			railError = cause instanceof Error ? cause.message : fallback;
		}
	}

	function sessionMenuItems(session: SessionViewModel): ContextMenuItem[] {
		const live = ['starting', 'idle', 'running', 'waiting'].includes(session.status);
		const offline = 'Pau is reconnecting to the backend.';
		const ended = 'This session has ended.';
		const items: ContextMenuItem[] = [{ id: 'open', label: 'Open' }];
		if (onRenameSession && session.capabilities.rename) {
			const reason = disconnected ? offline : live ? undefined : ended;
			items.push({ id: 'rename', label: 'Rename…', disabled: reason !== undefined, reason });
		}
		if (onCloneSession && session.capabilities.cloneSession) {
			const reason = disconnected
				? offline
				: !live
					? ended
					: session.status === 'idle'
						? undefined
						: `Wait for ${session.agent} to finish before cloning.`;
			items.push({ id: 'clone', label: 'Clone', disabled: reason !== undefined, reason });
		}
		items.push({ id: 'copy-id', label: 'Copy session ID', separatorBefore: true });
		if (session.capabilities.stop) {
			const stoppable = live || session.status === 'not_responding';
			const reason = disconnected ? offline : stoppable ? undefined : ended;
			items.push({ id: 'stop', label: 'Stop', separatorBefore: true, disabled: reason !== undefined, reason });
		}
		items.push({
			id: 'archive',
			label: 'Archive',
			separatorBefore: !session.capabilities.stop,
			disabled: true,
			reason: 'Coming soon'
		});
		return items;
	}

	function runSessionAction(session: SessionViewModel, id: string): void {
		switch (id) {
			case 'open': {
				selectSession(session.id);
				break;
			}
			case 'rename': {
				railError = undefined;
				renameDraft = session.title;
				renamingSessionId = session.id;
				break;
			}
			case 'clone': {
				void railAction(() => onCloneSession?.(session.id), 'Pau could not clone the session. Try again.');
				break;
			}
			case 'copy-id': {
				void railAction(() => navigator.clipboard.writeText(session.id), 'Pau could not copy the session ID.');
				break;
			}
			case 'stop': {
				void railAction(() => onStop(session.id), 'The session could not be stopped. Try again.');
				break;
			}
		}
	}

	function openSessionMenu(event: MouseEvent | KeyboardEvent, session: SessionViewModel): void {
		contextMenu = contextMenuRequest(event, `${session.title} actions`, sessionMenuItems(session), (id) =>
			runSessionAction(session, id)
		);
	}

	/** Saves the edited session name, or drops the edit when the name is blank or unchanged. */
	async function commitRename(session: SessionViewModel): Promise<void> {
		if (renamingSessionId !== session.id) return;
		renamingSessionId = undefined;
		const name = renameDraft.trim();
		await tick();
		document.getElementById(`session-row-${session.id}`)?.focus();
		if (!onRenameSession || !name || name === session.title) return;
		await railAction(() => onRenameSession(session.id, name), 'Pau could not rename the session. Try again.');
	}

	function cancelRename(session: SessionViewModel): void {
		renamingSessionId = undefined;
		void tick().then(() => document.getElementById(`session-row-${session.id}`)?.focus());
	}

	function workspaceMenuItems(workspace: SessionWorkspace): ContextMenuItem[] {
		const items: ContextMenuItem[] = [];
		if (onStartSession) {
			const reason = disconnected
				? 'Pau is reconnecting to the backend.'
				: startingWorkspaceId === undefined
					? undefined
					: 'A session is already starting.';
			items.push({ id: 'new-session', label: 'New session', disabled: reason !== undefined, reason });
			const claudeReason = reason ?? (claudeReadiness ? withoutCodeMarks(claudeReadiness.reason) : undefined);
			items.push({
				id: 'new-claude-session',
				label: 'New Claude Code session',
				disabled: claudeReason !== undefined,
				reason: claudeReason
			});
		}
		if (onOpenTerminal) items.push({ id: 'terminal', label: 'Open terminal' });
		if (workspace.path) {
			if (revealPath) items.push({ id: 'reveal', label: revealLabel(), separatorBefore: true });
			items.push({ id: 'copy-path', label: 'Copy path', separatorBefore: !revealPath });
		}
		items.push({
			id: 'remove',
			label: 'Remove workspace',
			separatorBefore: true,
			disabled: true,
			reason: 'Coming soon'
		});
		return items;
	}

	function runWorkspaceAction(workspace: SessionWorkspace, id: string): void {
		const path = workspace.path ?? '';
		switch (id) {
			case 'new-session': {
				void startSession(workspace);
				break;
			}
			case 'new-claude-session': {
				void startSession(workspace, 'claude');
				break;
			}
			case 'terminal': {
				onOpenTerminal?.(workspace.id);
				break;
			}
			case 'reveal': {
				void railAction(() => revealPath?.(path), 'Pau could not show the folder.');
				break;
			}
			case 'copy-path': {
				void railAction(() => navigator.clipboard.writeText(path), 'Pau could not copy the path.');
				break;
			}
		}
	}

	function openWorkspaceMenu(event: MouseEvent | KeyboardEvent, workspace: SessionWorkspace): void {
		contextMenu = contextMenuRequest(event, `${workspace.name} actions`, workspaceMenuItems(workspace), (id) =>
			runWorkspaceAction(workspace, id)
		);
	}

	/** The message text as the operator reads it, without its heading or controls. */
	function renderedMessageText(article: HTMLElement): string {
		return (
			[...article.children]
				.filter((child) => child.tagName !== 'H2' && child.tagName !== 'BUTTON')
				// innerText keeps the line breaks between rendered blocks, which textContent drops.
				// eslint-disable-next-line unicorn/prefer-dom-node-text-content
				.map((child) => (child as HTMLElement).innerText.trim())
				.join('\n\n')
		);
	}

	function openMessageMenu(
		event: MouseEvent | KeyboardEvent,
		session: SessionViewModel,
		entry: Extract<TranscriptEntry, { kind: 'message' }>
	): void {
		const article = event.currentTarget as HTMLElement;
		// Leave a text selection to the system menu, which can copy just the selection.
		const selection = getSelection();
		if (selection && event.type === 'contextmenu' && !selection.isCollapsed && article.contains(selection.anchorNode)) {
			return;
		}
		const items: ContextMenuItem[] = [{ id: 'copy', label: 'Copy message' }];
		if (entry.role === 'assistant') items.push({ id: 'copy-markdown', label: 'Copy as Markdown' });
		if (onBranchFromMessage && entry.role === 'user' && session.capabilities.branching) {
			const reason = branchUnavailableReason(session, disconnected);
			items.push({
				id: 'branch',
				label: 'Branch from here',
				separatorBefore: true,
				disabled: reason !== undefined,
				reason
			});
		}
		contextMenu = contextMenuRequest(event, 'Message actions', items, (id) => {
			if (id === 'branch') {
				void branchFromMessage(session.id, entry.id);
				return;
			}
			const text = id === 'copy' ? renderedMessageText(article) : entry.body;
			void navigator.clipboard.writeText(text).catch(() => {
				controlError = 'Pau could not copy the message.';
			});
		});
	}

	async function branchFromMessage(sessionId: string, entryId: string): Promise<void> {
		if (!onBranchFromMessage) return;
		controlError = undefined;
		try {
			const outcome = await onBranchFromMessage(sessionId, entryId);
			if (outcome.cancelled) controlError = 'An extension cancelled the branch. The session is unchanged.';
			else branched(outcome.text ?? '');
		} catch (cause) {
			controlError = cause instanceof Error ? cause.message : 'Pau could not branch the session. Try again.';
		}
	}

	useKeyActions({
		'session.new': () => {
			const workspace = activeWorkspace ?? openedWorkspace ?? workspaces[0];
			if (workspace) void startSession(workspace);
		},
		'workspace.open': () => {
			if (onOpenWorkspace) void chooseWorkspace();
		},
		'session.next': () => (activeSessionId ? moveSession(activeSessionId, 1) : undefined),
		'session.previous': () => (activeSessionId ? moveSession(activeSessionId, -1) : undefined),
		'session.goto': (index) => {
			const session = sessions[index];
			if (session) selectSession(session.id);
		},
		'session.clearAttention': () => onClearAttention(),
		'composer.focus': () => composer?.focus(),
		'prompt.previous': () => (transcriptElement ? scrollToPrompt(transcriptElement, -1) : undefined),
		'prompt.next': () => (transcriptElement ? scrollToPrompt(transcriptElement, 1) : undefined)
	});

	/** Attaches the supported files and reports each rejected one by name. */
	function attachImages(files: Iterable<File>): void {
		const rejected: string[] = [];
		let bytes = images.reduce((total, image) => total + image.size, 0);
		for (const file of files) {
			const reason = imageRejection(file, bytes);
			if (reason) {
				rejected.push(reason);
				continue;
			}
			bytes += file.size;
			images.push({
				id: crypto.randomUUID(),
				name: file.name,
				size: file.size,
				previewUrl: URL.createObjectURL(file),
				file
			});
		}
		imageError = rejected.length > 0 ? rejected.join(' ') : undefined;
	}

	function removeImage(id: string): void {
		const image = images.find((candidate) => candidate.id === id);
		if (!image) return;
		URL.revokeObjectURL(image.previewUrl);
		images = images.filter((candidate) => candidate.id !== id);
		imageError = undefined;
		composer?.focus();
	}

	onDestroy(() => {
		for (const image of images) URL.revokeObjectURL(image.previewUrl);
	});

	/** How long the reason stays over the composer after a drop that attached nothing. */
	const dropRejectionMs = 2500;

	type DropCopy = { accepts: boolean; title: string; detail: string };

	/** Copy for each drop target, and whether a drop there would attach anything. */
	const dropCopies: Record<ImageDragKind | 'rejected', DropCopy> = {
		images: { accepts: true, title: 'Drop to attach', detail: 'PNG, JPEG, GIF, or WebP, up to 5 MiB each' },
		unknown: { accepts: true, title: 'Drop to attach images', detail: imageTypeRule },
		mixed: { accepts: true, title: 'Drop to attach the images', detail: `Other files are skipped. ${imageTypeRule}` },
		unsupported: { accepts: false, title: 'These files cannot be attached', detail: imageTypeRule },
		rejected: { accepts: false, title: 'Nothing was attached', detail: imageTypeRule }
	};

	const dropCopy = $derived.by((): DropCopy | undefined => {
		if (dropTarget === undefined) return;
		if (composerUnavailable !== undefined) {
			return { accepts: false, title: 'Images cannot be attached now', detail: composerUnavailable };
		}
		return dropCopies[dropTarget];
	});

	onDestroy(() => clearTimeout(dropRejectionTimer));

	function hasFiles(event: DragEvent): boolean {
		return event.dataTransfer?.types.includes('Files') ?? false;
	}

	function handleImageDragEnter(event: DragEvent): void {
		if (!hasFiles(event)) return;
		event.preventDefault();
		clearTimeout(dropRejectionTimer);
		dragDepth += 1;
		dropTarget = imageDragKind(event.dataTransfer);
	}

	function handleImageDragOver(event: DragEvent): void {
		if (!hasFiles(event)) return;
		// Without this the browser opens a dropped file in place of the app.
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = composerUnavailable === undefined ? 'copy' : 'none';
	}

	function handleImageDragLeave(event: DragEvent): void {
		if (!hasFiles(event)) return;
		dragDepth = Math.max(0, dragDepth - 1);
		if (dragDepth === 0) dropTarget = undefined;
	}

	/**
	 * Attaches dropped images like Attach image. A drop with no supported
	 * image keeps the reason over the composer briefly instead of adding an
	 * error row, because the target already showed it before the drop.
	 */
	function handleImageDrop(event: DragEvent): void {
		if (!hasFiles(event)) return;
		event.preventDefault();
		dragDepth = 0;
		dropTarget = undefined;
		if (composerUnavailable !== undefined) return;
		const files = [...(event.dataTransfer?.files ?? [])];
		if (files.length > 0 && files.every((file) => !isImageType(file.type))) {
			dropTarget = 'rejected';
			dropRejectionTimer = setTimeout(() => (dropTarget = undefined), dropRejectionMs);
			return;
		}
		attachImages(files);
	}

	function handleComposerPaste(event: ClipboardEvent): void {
		const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'));
		if (files.length === 0) return;
		event.preventDefault();
		attachImages(files);
	}

	/**
	 * Sends the draft, during a run as `queueOverride` or the queue the
	 * composer shows. The composer clears and the prompt shows as pending
	 * before the backend answers. A refused prompt stays in view marked as not
	 * sent, and its text and images return to the composer when the operator
	 * has not moved to another session.
	 */
	async function submitPrompt(queueOverride?: PromptQueue): Promise<void> {
		if (sending || !activeSession || !draft.trim()) return;
		const session = activeSession;
		if (draftShell) {
			await runShellCommand(session, draftShell.command, draftShell.excludeFromContext);
			return;
		}
		if (draftBuiltin) {
			await runBuiltin(session, draftBuiltin);
			return;
		}
		const text = draft.trim();
		const queueTarget = session.status === 'running' ? (queueOverride ?? activeQueue) : undefined;
		const attached = images;
		sending = true;
		error = undefined;
		try {
			const encoded = await Promise.all(attached.map((image) => encodeImage(image.file)));
			const pending: PendingPrompt = {
				id: `pending-${(pendingSequence += 1)}`,
				sessionId: session.id,
				text,
				queue: queueTarget,
				seen: userMessageIds(session),
				state: 'sending'
			};
			pendingPrompts = [
				...pendingPrompts.filter((prompt) => prompt.sessionId !== session.id || prompt.state !== 'failed'),
				pending
			];
			draft = '';
			draftTyped = false;
			images = [];
			imageError = undefined;
			historyCursor = idleHistoryCursor;
			try {
				if (encoded.length > 0) await onSend(session.id, text, queueTarget, encoded);
				else await onSend(session.id, text, queueTarget);
			} catch (cause) {
				markPending(pending.id, 'failed');
				if (activeSession?.id === session.id) {
					draft = draft.trim() ? `${text}\n\n${draft}` : text;
					images = [...attached, ...images];
				} else {
					for (const image of attached) URL.revokeObjectURL(image.previewUrl);
				}
				throw cause;
			}
			markPending(pending.id, 'sent');
			for (const image of attached) URL.revokeObjectURL(image.previewUrl);
			histories[session.id] = recordPrompt(histories[session.id] ?? [], text);
		} catch (cause) {
			if (activeSession?.id === session.id) {
				error = cause instanceof Error ? cause.message : 'The prompt could not be sent. Try again.';
			}
		} finally {
			sending = false;
			composer?.focus();
		}
	}

	/**
	 * Runs a Pi built-in with its Pau action. The draft clears once the action
	 * starts. A command Pau cannot run keeps the draft and explains why.
	 */
	async function runBuiltin(session: SessionViewModel, { command, argument }: BuiltinInvocation): Promise<void> {
		error = undefined;
		try {
			if (command.unavailable || !command.action) throw new Error(command.unavailable);
			const text = draft.trim();
			const action = builtinAction(session, command.action, argument);
			draft = '';
			draftTyped = false;
			historyCursor = idleHistoryCursor;
			histories[session.id] = recordPrompt(histories[session.id] ?? [], text);
			await action();
		} catch (cause) {
			if (activeSession?.id === session.id) {
				error = cause instanceof Error ? cause.message : `Pau could not run /${command.name}. Try again.`;
			}
		}
	}

	/**
	 * Runs the draft as a shell command, as Pi's `!` and `!!` do, including
	 * during a run. The draft clears once the command starts. Like Pi, Pau runs
	 * one command at a time, so the draft stays while another command runs or
	 * when the session cannot run commands, and the reason shows instead.
	 */
	async function runShellCommand(
		session: SessionViewModel,
		command: string,
		excludeFromContext: boolean
	): Promise<void> {
		error = undefined;
		if (!onRunShellCommand || !session.capabilities.shellCommands) {
			error = `${session.agent} cannot run shell commands in this session. Remove the ! to send the text as a prompt.`;
			return;
		}
		if (shellRunning) {
			error = `A shell command is still running. Stop it${interruptShortcut ? ` with ${interruptShortcut}` : ''} before you run another.`;
			return;
		}
		histories[session.id] = recordPrompt(histories[session.id] ?? [], draft.trim());
		draft = '';
		draftTyped = false;
		historyCursor = idleHistoryCursor;
		try {
			await onRunShellCommand(session.id, command, excludeFromContext);
		} catch (cause) {
			if (activeSession?.id === session.id) {
				error = cause instanceof Error ? cause.message : 'The command could not run. Try again.';
			}
		}
	}

	async function stopShellCommands(): Promise<void> {
		if (disconnected || !activeSession || !onStopShellCommands) return;
		error = undefined;
		try {
			await onStopShellCommands(activeSession.id);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The command could not be stopped. Try again.';
		}
	}

	/** Stops a built-in before it runs. A function declaration, so callers narrow on it. */
	function refuse(reason: string | undefined): never {
		throw new Error(reason ?? 'This session cannot run that command right now.');
	}

	/** Shows the inspector when it is hidden, for `/session`, `/tree`, and `/fork`. */
	async function showInspector(): Promise<void> {
		if (!document.getElementById('shell-inspector') && !keymap?.run('panel.inspector')) {
			throw new Error('Pau cannot show the inspector here.');
		}
		await tick();
	}

	/**
	 * Checks that the session can run a built-in now and returns the action.
	 * Throws the reason when it cannot, before the draft clears.
	 */
	function builtinAction(session: SessionViewModel, action: BuiltinAction, argument: string): () => Promise<unknown> {
		const menuAction = (id: string, unsupported: string): (() => Promise<void>) => {
			const item = sessionMenuItems(session).find((candidate) => candidate.id === id);
			if (!item) refuse(unsupported);
			if (item.disabled) refuse(item.reason);
			return async () => runSessionAction(session, id);
		};
		const workspace = activeWorkspace;
		switch (action) {
			case 'model': {
				if (!onLoadModels || !onSelectModel || !session.capabilities.modelSelection) {
					refuse('This agent does not support switching models in a session.');
				}
				const reason = modelUnavailableReason(session, disconnected);
				if (reason) refuse(reason);
				if (!argument) return async () => modelPicker?.show();
				return async () => {
					const models = (await onLoadModels?.(session.id)) ?? [];
					const model =
						models.find((candidate) => `${candidate.provider}/${candidate.id}` === argument) ??
						models.find((candidate) => candidate.id === argument);
					if (!model) throw new Error(`No model matches ${argument}. Run /model to choose from the list.`);
					await onSelectModel?.(session.id, model);
					await modelPicker?.refresh();
				};
			}
			case 'thinking': {
				if (!onSelectThinkingLevel || !session.capabilities.thinkingLevel) {
					refuse('This agent does not support changing the thinking level in a session.');
				}
				if (!offersThinking(session)) refuse('This model does not offer thinking levels.');
				const reason = thinkingUnavailableReason(session, disconnected);
				if (reason) refuse(reason);
				if (!argument) return async () => thinkingPicker?.show();
				const levels = session.thinkingLevels ?? thinkingLevels;
				const level = levels.find((candidate) => candidate === argument);
				if (!level) refuse(`Choose a thinking level: ${levels.join(', ')}.`);
				return async () => onSelectThinkingLevel?.(session.id, level);
			}
			case 'new': {
				if (!onStartSession || !workspace) refuse('Pau cannot start a session here.');
				return () => startSession(workspace);
			}
			case 'resume': {
				if (!onLoadSavedSessions || !onResumeSession || !workspace) refuse('Pau cannot list saved sessions here.');
				return async () => (pickerWorkspaceId = workspace.id);
			}
			case 'name': {
				const rename = menuAction('rename', 'This agent cannot rename sessions.');
				if (!argument) return rename;
				return async () => onRenameSession?.(session.id, argument);
			}
			case 'clone': {
				return menuAction('clone', 'This agent cannot clone sessions.');
			}
			case 'stop': {
				return menuAction('stop', 'This agent cannot stop sessions.');
			}
			case 'compact': {
				if (!canCompact) refuse('This agent cannot compact its context on request.');
				const reason = compactUnavailableReason(session, disconnected, compacting);
				if (reason) refuse(reason);
				// A failed compaction reports itself in the compaction notice.
				return async () => {
					compactInstructions = argument;
					await compact();
				};
			}
			case 'copy': {
				return async () => {
					const result = await copyLastReply();
					if (!result) throw new Error('There is no reply to copy yet.');
					if (!result.ok) throw new Error(result.error);
				};
			}
			case 'shortcuts': {
				return async () => {
					if (!keymap?.run('app.shortcuts')) throw new Error('Pau cannot show the keyboard shortcuts here.');
				};
			}
			case 'inspector': {
				return showInspector;
			}
			case 'tree':
			case 'branch': {
				if (!onLoadSessionTree || !onBranchSession) refuse('Pau cannot show the session tree here.');
				return async () => {
					await showInspector();
					await sessionTree?.show(action === 'branch');
				};
			}
		}
	}

	function markPending(id: string, state: PendingPrompt['state']): void {
		pendingPrompts = pendingPrompts.map((prompt) => (prompt.id === id ? { ...prompt, state } : prompt));
	}

	async function interrupt(): Promise<void> {
		if (disconnected || !activeSession || !activeSession.capabilities.interrupt) return;
		const sessionId = activeSession.id;
		error = undefined;
		try {
			const cleared = await onInterrupt(sessionId);
			if (cleared && activeSessionId === sessionId) restoreQueue(cleared);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The session could not be interrupted. Try again.';
		}
	}

	function acceptCommand(command: CommandOption): void {
		if (command.unavailable) return;
		historyCursor = idleHistoryCursor;
		draft = `/${command.name} `;
		draftTyped = false;
		composer?.focus();
	}

	/** Replaces the open mention with the chosen path and puts the caret after it. */
	async function acceptMention(file: FileMention): Promise<void> {
		const field = composer;
		if (!mentionToken || !field) return;
		const next = insertMention(draft, mentionToken, caret, file);
		historyCursor = idleHistoryCursor;
		draft = next.draft;
		caret = next.caret;
		mentionResults = undefined;
		await tick();
		field.focus();
		field.setSelectionRange(next.caret, next.caret);
	}

	function handleMentionKeydown(event: KeyboardEvent, files: FileMention[]): boolean {
		const modified = event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
		if (event.key === 'Escape') {
			dismissedMention = draft;
		} else if (mentionFailed || modified || files.length === 0) {
			return false;
		} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			const step = event.key === 'ArrowUp' ? -1 : 1;
			mentionSelected = (mentionSelected + step + files.length) % files.length;
		} else if (event.key === 'Enter' || event.key === 'Tab') {
			const file = files[Math.min(mentionSelected, files.length - 1)];
			if (!file) return false;
			void acceptMention(file);
		} else {
			return false;
		}
		event.preventDefault();
		return true;
	}

	function handleCommandKeydown(event: KeyboardEvent, matches: CommandOption[]): boolean {
		const modified = event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
		if (event.key === 'Escape') {
			dismissedDraft = draft;
		} else if (modified || matches.length === 0) {
			return false;
		} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			const step = event.key === 'ArrowUp' ? -1 : 1;
			commandSelected = (commandSelected + step + matches.length) % matches.length;
		} else if (event.key === 'Enter' || event.key === 'Tab') {
			const command = matches[Math.min(commandSelected, matches.length - 1)];
			if (!command) return false;
			acceptCommand(command);
		} else {
			return false;
		}
		event.preventDefault();
		return true;
	}

	async function retry(): Promise<void> {
		if (!canRetry || !activeSession || retrying) return;
		retryError = undefined;
		retryingSessionId = activeSession.id;
		try {
			await onRetry(activeSession.id);
		} catch (cause) {
			retryingSessionId = undefined;
			retryError = cause instanceof Error ? cause.message : 'Your message could not be sent again. Try again.';
		}
	}

	async function cancelRetry(): Promise<void> {
		if (disconnected || !activeSession) return;
		retryError = undefined;
		try {
			await onCancelRetry(activeSession.id);
		} catch (cause) {
			retryError = cause instanceof Error ? cause.message : 'The automatic retry could not be cancelled. Try again.';
		}
	}

	/** Empties the queue and restores its text to the composer for editing. */
	async function clearQueue(): Promise<void> {
		if (!activeSession || !onClearQueue || disconnected) return;
		const sessionId = activeSession.id;
		queueError = undefined;
		try {
			const cleared = await onClearQueue(sessionId);
			if (activeSessionId === sessionId) restoreQueue(cleared);
		} catch (cause) {
			queueError = cause instanceof Error ? cause.message : 'The queue could not be cleared. Try again.';
		}
	}

	/**
	 * Puts cleared queue text back in the composer. Matches Pi's terminal UI:
	 * steering before follow-ups, the order Pi would have run them, then any
	 * existing draft, since it had not been sent yet. An empty queue leaves the
	 * composer untouched.
	 */
	function restoreQueue(cleared: MessageQueue): void {
		const queued = [...cleared.steering, ...cleared.followUp];
		if (queued.length === 0) return;
		historyCursor = idleHistoryCursor;
		draft = [queued.join('\n\n'), draft].filter((text) => text.trim()).join('\n\n');
		composer?.focus();
	}

	/** The first chord of a composer action, formatted for its button, or `undefined` when it has none. */
	function composerKeyShortcut(action: 'submit' | 'interrupt'): string | undefined {
		const chord = composerKeys.byAction[action][0];
		return chord === undefined ? undefined : formatChord(chord, keyPlatform);
	}

	/** Inserts a line break at the caret, for new-line chords the text field ignores. */
	async function insertNewLine(field: HTMLTextAreaElement): Promise<void> {
		const start = field.selectionStart;
		draft = `${draft.slice(0, start)}\n${draft.slice(field.selectionEnd)}`;
		draftTyped = true;
		await tick();
		field.setSelectionRange(start + 1, start + 1);
		caret = start + 1;
	}

	/**
	 * Moves to the model's next thinking level, as Pi's Shift+Tab does. A
	 * current level that the model does not offer moves to its first level.
	 */
	async function cycleThinkingLevel(session: SessionViewModel): Promise<void> {
		if (!onSelectThinkingLevel) return;
		const levels = session.thinkingLevels ?? thinkingLevels;
		const index = session.thinkingLevel ? levels.indexOf(session.thinkingLevel) : -1;
		const next = levels[(index + 1) % levels.length] ?? 'off';
		error = undefined;
		try {
			await onSelectThinkingLevel(session.id, next);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The thinking level could not be changed. Try again.';
		}
	}

	/**
	 * Runs one of Pi's composer actions. Returns `false` when the session
	 * cannot perform it at all, so the key keeps its usual meaning, such as
	 * Shift+Tab moving focus. An action that is only unavailable for now, such
	 * as a model change during a run, explains why instead.
	 */
	function runComposerKey(action: ComposerKeyAction, field: HTMLTextAreaElement, chord: string): boolean {
		const session = activeSession;
		if (!session) return false;
		switch (action) {
			case 'interrupt': {
				// As in Pi, the key interrupts a running turn first and stops shell
				// commands only when no turn runs.
				if (session.status === 'running') {
					void interrupt();
					return true;
				}
				if (!shellRunning || !onStopShellCommands) return false;
				void stopShellCommands();
				return true;
			}
			case 'submit': {
				void submitPrompt();
				return true;
			}
			case 'followUp': {
				void submitPrompt(session.capabilities.followUp ? 'follow-up' : undefined);
				return true;
			}
			case 'dequeue': {
				if (queuedCount === 0) return false;
				void clearQueue();
				return true;
			}
			case 'newLine': {
				// The text field already breaks the line for these.
				if (chord === 'enter' || chord === 'shift+enter') return false;
				void insertNewLine(field);
				return true;
			}
			case 'cycleThinking': {
				if (!onSelectThinkingLevel || !session.capabilities.thinkingLevel) return false;
				// Pi's own Shift+Tab reports that the model has no levels instead of moving focus.
				const reason = offersThinking(session)
					? thinkingUnavailableReason(session, disconnected)
					: 'This model does not offer thinking levels.';
				if (reason) error = reason;
				else void cycleThinkingLevel(session);
				return true;
			}
			case 'selectModel': {
				if (!modelPicker || !session.capabilities.modelSelection) return false;
				const reason = modelUnavailableReason(session, disconnected);
				if (reason) error = reason;
				else void modelPicker.show();
				return true;
			}
		}
	}

	/**
	 * Composer keys follow Pi's bindings. An open completion list takes
	 * Escape, Enter, Tab, and the arrows first, so Escape closes it before it
	 * can interrupt a run. Up and Down browse prompt history at the edges of
	 * the draft.
	 */
	function handleComposerKeydown(event: KeyboardEvent): void {
		if (commandMatches && handleCommandKeydown(event, commandMatches)) return;
		if (mentionOpen && handleMentionKeydown(event, mentionResults ?? [])) return;
		const field = event.currentTarget as HTMLTextAreaElement;
		const action = composerKeyAction(composerKeys, event);
		if (action && runComposerKey(action, field, eventChord(event) ?? '')) {
			event.preventDefault();
			return;
		}
		if (!activeSession || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
		const modified = event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
		const step =
			modified || field.selectionStart !== field.selectionEnd
				? undefined
				: navigateHistory(
						histories[activeSession.id] ?? [],
						historyCursor,
						draft,
						field.selectionStart,
						event.key === 'ArrowUp' ? 'previous' : 'next'
					);
		if (!step) return;
		event.preventDefault();
		historyCursor = step.cursor;
		draft = step.draft;
		draftTyped = false;
	}

	let defaultOpen = $derived(openByDefault(activeSession?.transcript ?? [], activeSession?.status));
	let transcriptRows = $derived(groupToolCalls(activeSession?.transcript ?? []));

	/**
	 * Whether a tool or thinking block shows its body. An operator choice, from
	 * a click or Ctrl+O, wins over {@link openByDefault}.
	 */
	function entryOpen(entry: TranscriptEntry): boolean {
		return disclosures.get(entry.id) ?? defaultOpen.has(entry.id);
	}

	/**
	 * Whether a group of finished calls shows them. It follows its calls'
	 * default, so a group formed during a running turn stays open until the
	 * turn ends, and an operator choice wins as it does for single rows.
	 */
	function groupOpen(group: TranscriptToolGroup): boolean {
		return disclosures.get(group.id) ?? group.tools.some((tool) => defaultOpen.has(tool.id));
	}

	/** Records a disclosure change only when it differs from what the host shows, so host changes are not kept. */
	function recordDisclosure(entry: TranscriptEntry, open: boolean): void {
		if (open !== entryOpen(entry)) disclosures.set(entry.id, open);
	}

	/**
	 * Window shortcuts. Ctrl+O toggles tool output. Ctrl+End jumps to the latest
	 * output while the Jump to latest control is shown, except in text fields
	 * where it moves the caret. This is a local handler until the keymap registry
	 * lands, then both belong there.
	 */
	function handleWindowKeydown(event: KeyboardEvent): void {
		if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key === 'End') {
			const target = event.target;
			const editable =
				target instanceof HTMLElement &&
				(target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName));
			if (arrived && !editable) {
				event.preventDefault();
				scrollToLatest();
			}
			return;
		}
		if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'o') return;
		const tools = activeSession?.transcript.filter((entry) => entry.kind === 'tool') ?? [];
		if (tools.length === 0) return;
		event.preventDefault();
		const groups = transcriptRows.filter((row) => row.kind === 'tool-group');
		const next = tools.some((tool) => !entryOpen(tool)) || groups.some((group) => !groupOpen(group));
		for (const row of [...tools, ...groups]) disclosures.set(row.id, next);
	}

	function denialTitle(denial: SandboxDenial): string {
		if (denial.target === 'network') return 'Sandbox blocked network access';
		if (denial.target === 'unexplained') return 'Sandbox may have blocked this call';
		return `Sandbox blocked a file ${denial.operation}`;
	}

	function denialExplanation(denial: SandboxDenial): string {
		if (denial.target === 'network') {
			return 'The active sandbox does not allow connections to this destination.';
		}
		if (denial.target === 'unexplained') {
			return 'Pau could not identify the blocked file or destination. Open the failed tool call for its error.';
		}
		return {
			unreadable: 'The active sandbox does not allow this path to be read.',
			protected: 'The active sandbox keeps this path read-only.',
			'outside-writable': 'This path is outside the folders the active sandbox can write.'
		}[denial.reason];
	}
</script>

<!-- A saved session without a live session behind it reads as stopped in the rail. -->
{#snippet savedRowContent(title: string, state: string)}
	<SessionStatusMark status="stopped" label="Stopped" />
	<span class="session-rail__name">{title}</span>
	<span class="session-rail__state"><small aria-hidden="true">{state}</small></span>
{/snippet}

{#snippet readinessNotice(workspaceId?: string, agent: SessionAgent = 'pi')}
	{@const problem = agent === 'claude' ? claudeReadiness : agentReadiness}
	{#if problem}
		<AgentReadinessNotice
			{problem}
			onOpenTerminal={onOpenTerminal && workspaceId ? () => onOpenTerminal(workspaceId) : undefined}
			onCheckAgain={agent === 'claude' ? onCheckClaude : undefined}
			reasonId={agent === 'claude' ? 'claude-readiness-reason' : undefined} />
	{/if}
{/snippet}

<svelte:window
	onkeydown={(event) => {
		handleSearchShortcut(event);
		handleWindowKeydown(event);
	}} />

<ApplicationShell
	workspaceName={activeWorkspace?.name ?? 'Workspaces'}
	contextLabel="Workspaces and sessions"
	{productItems}
	contextItems={[]}
	{disconnected}
	inspectorOpen={Boolean(resourceSnapshot)}
	{theme}
	{uiFont}
	{paneWidths}
	{paletteEntries}
	{dock}
	{dockOpen}
	{onDockToggle}
	{dockHeight}
	{onDockResize}
	onResize={onPaneResize}>
	{#snippet context()}
		<nav class="session-rail" aria-label="Workspaces and sessions">
			{#if onOpenWorkspace}
				<button
					type="button"
					class="session-rail__open"
					disabled={disconnected || opening}
					onclick={() => void chooseWorkspace()}>
					<Icon name="folderPlus" size={16} />
					<span>{opening ? 'Opening…' : 'Open workspace…'}</span>
				</button>
			{/if}
			{#if sessionsLoading.active}
				{#if sessionsLoading.visible}<p class="session-rail__empty">Loading…</p>{/if}
			{:else if workspaces.length === 0}
				<p class="session-rail__empty">No workspaces yet</p>
			{:else}
				{#each workspaces as workspace (workspace.id)}
					{@const restored = restoredSession?.workspaceId === workspace.id ? restoredSession : undefined}
					{@const recentStatus = recentSessions[workspace.id]?.status}
					{@const recent = recentRows(workspace)}
					<section aria-labelledby={`workspace-${workspace.id}`}>
						<!-- The heading row hosts the workspace menu for the heading and its controls. -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="session-rail__heading"
							oncontextmenu={(event) => openWorkspaceMenu(event, workspace)}
							onkeydown={(event) => {
								if (isContextMenuKey(event)) openWorkspaceMenu(event, workspace);
							}}>
							<!-- The heading takes focus so the keyboard can open the workspace menu. -->
							<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
							<h2
								id={`workspace-${workspace.id}`}
								tabindex="0"
								title={workspace.path ? `${workspace.name}\n${workspace.path}` : workspace.name}>
								{workspace.name}
							</h2>
							{#if onStartSession}
								<button
									type="button"
									class="session-rail__icon-button pau-utility-button"
									aria-label={`New session in ${workspace.name}`}
									title={`New session in ${workspace.name}`}
									disabled={disconnected || startingWorkspaceId !== undefined}
									onclick={() => void startSession(workspace)}>
									<Icon name="plus" size={14} />
								</button>
							{/if}
							{#if onLoadSavedSessions && onResumeSession}
								<button
									type="button"
									class="session-rail__icon-button pau-utility-button"
									aria-label={`Saved sessions in ${workspace.name}`}
									aria-pressed={pickerWorkspaceId === workspace.id}
									title={`Saved sessions in ${workspace.name}`}
									disabled={disconnected}
									onclick={() => (pickerWorkspaceId = workspace.id)}>
									<Icon name="history" size={14} />
								</button>
							{/if}
						</div>
						{#if workspace.sessions.length === 0 && startingWorkspaceId === workspace.id}
							<p class="session-rail__empty">Starting a session…</p>
						{:else if workspace.sessions.length === 0 && !restored && recent.length === 0 && (!recentStatus || recentStatus === 'ready')}
							<p class="session-rail__empty">No sessions yet</p>
						{/if}
						<ul>
							{#if restored}
								<li>
									<button
										type="button"
										id="session-row-restored"
										class:active={restoredOpen}
										title={restored.title}
										aria-current={restoredOpen ? 'page' : undefined}
										onclick={openRestored}>
										{@render savedRowContent(restored.title, 'Stopped')}
									</button>
								</li>
							{/if}
							{#each workspace.sessions as session (session.id)}
								<li>
									{#if renamingSessionId === session.id}
										<!-- svelte-ignore a11y_autofocus -->
										<input
											class="session-rail__rename"
											aria-label="Session name"
											autofocus
											bind:value={renameDraft}
											onblur={() => void commitRename(session)}
											onkeydown={(event) => {
												if (event.key === 'Enter') {
													event.preventDefault();
													void commitRename(session);
												} else if (event.key === 'Escape') {
													event.preventDefault();
													event.stopPropagation();
													cancelRename(session);
												}
											}} />
									{:else}
										<button
											type="button"
											id={`session-row-${session.id}`}
											class="pau-row"
											class:active={session.id === activeSessionId}
											title={session.title}
											aria-current={session.id === activeSessionId ? 'page' : undefined}
											onclick={() => selectSession(session.id)}
											oncontextmenu={(event) => openSessionMenu(event, session)}
											onkeydown={(event) => {
												if (isContextMenuKey(event)) {
													openSessionMenu(event, session);
													return;
												}
												if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
												event.preventDefault();
												moveSession(session.id, event.key === 'ArrowDown' ? 1 : -1);
											}}>
											<SessionStatusMark status={session.status} label={statusLabel(session.status)} />
											<span class="session-rail__name">{session.title}</span>
											<span class="session-rail__state">
												<small aria-hidden="true">{statusLabel(session.status)}</small>
												{#if session.unseen && session.id !== activeSessionId}
													{@const kind = markerKind(session.status)}
													<span class={`session-rail__marker session-rail__marker--${kind}`} data-marker={kind}></span>
													<span class="pau-visually-hidden">{markerLabel[kind]}</span>
												{:else if hasAttention(session)}
													<span class="pau-visually-hidden">Attention required</span>
												{/if}
											</span>
										</button>
									{/if}
								</li>
							{/each}
							{#each recent as saved (saved.id)}
								<li>
									<button
										type="button"
										class="session-rail__saved"
										title={saved.title}
										disabled={disconnected || resumingSavedId !== undefined}
										onclick={() => void resumeRecent(workspace.id, saved.id)}>
										{@render savedRowContent(saved.title, resumingSavedId === saved.id ? 'Resuming…' : 'Stopped')}
									</button>
								</li>
							{/each}
						</ul>
						{#if recentStatus === 'loading' && recentLoading.visible}
							<p class="session-rail__empty" role="status">Loading saved sessions…</p>
						{:else if recentStatus === 'failed'}
							<div class="session-rail__recent-failure">
								<p>Saved sessions did not load.</p>
								<button
									type="button"
									class="pau-button pau-button--secondary"
									disabled={disconnected}
									onclick={() => void loadRecent(workspace.id)}>Try again</button>
							</div>
						{/if}
					</section>
				{/each}
			{/if}
			{#if railError}<p class="session-rail__error" role="alert">{railError}</p>{/if}
		</nav>
	{/snippet}

	{#snippet inspector()}
		<SessionResourceSummary
			snapshot={resourceSnapshot}
			actions={{
				interrupt: activeSession?.capabilities.interrupt ?? false,
				stop: activeSession?.capabilities.stop ?? false
			}}
			onInterrupt={(sessionId) => onInterrupt(sessionId)}
			onStop={(sessionId) => onStop(sessionId)} />
		{#if activeSession && onLoadSessionTree && onBranchSession}
			{@const session = activeSession}
			{#key session.id}
				<SessionTree
					bind:this={sessionTree}
					agent={session.agent}
					supported={session.capabilities.branching === true}
					load={() => onLoadSessionTree(session.id)}
					onBranch={(entryId) => onBranchSession(session.id, entryId)}
					onBranched={branched}
					branchUnavailable={branchUnavailableReason(session, disconnected)}
					revision={session.status === 'idle' ? session.transcript.length : null} />
			{/key}
		{/if}
	{/snippet}

	<!-- The menu renders in the main surface, which stays visible when the rails collapse. -->
	{#if contextMenu}
		{#key contextMenu}
			<ContextMenu request={contextMenu} onClose={() => (contextMenu = undefined)} />
		{/key}
	{/if}

	{#if pickerWorkspace && onLoadSavedSessions && onResumeSession}
		{#key pickerWorkspace.id}
			<div class="session-view session-view--empty">
				<SessionPicker
					workspaceName={pickerWorkspace.name}
					disabled={disconnected}
					load={() => onLoadSavedSessions(pickerWorkspace.id)}
					onNew={async () => {
						if (!onStartSession) return;
						await onStartSession(pickerWorkspace.id, 'pi');
						pickerWorkspaceId = undefined;
					}}
					onResume={async (savedSessionId) => {
						await onResumeSession(pickerWorkspace.id, savedSessionId);
						pickerWorkspaceId = undefined;
					}}
					onClose={() => (pickerWorkspaceId = undefined)} />
			</div>
		{/key}
	{:else if startFailure}
		<section class="session-view session-view--empty" aria-labelledby="start-failed-title">
			<EmptyState
				level={1}
				role="alert"
				titleId="start-failed-title"
				title={`Could not start a session in ${startFailure.workspaceName}`}>
				<p class="session-view__failure">
					{#each codeSpans(startFailure.message) as span, index (index)}{#if span.code}<code>{span.text}</code
							>{:else}{span.text}{/if}{/each}
				</p>
				{#if onStartSession}
					<button
						type="button"
						class="pau-button pau-button--primary session-view__retry"
						disabled={disconnected || startingWorkspaceId !== undefined}
						onclick={() => {
							const workspace = workspaces.find((candidate) => candidate.id === startFailure?.workspaceId);
							if (workspace) void startSession(workspace, startFailure?.agent);
						}}>Try again</button>
				{/if}
				{@render readinessNotice(startFailure.workspaceId, startFailure.agent)}
			</EmptyState>
		</section>
	{:else if onOpenWorkspace && (openFormVisible || openError || (!sessionsLoading.active && workspaces.length === 0))}
		{@const firstRun = !sessionsLoading.active && workspaces.length === 0}
		<section class="session-view session-view--empty" aria-labelledby="open-workspace-title">
			<EmptyState
				level={1}
				titleId="open-workspace-title"
				title={firstRun ? 'Open a folder to start working' : 'Open a workspace'}>
				<p>Pau runs each session inside a workspace folder. Open a project folder to add it to the rail.</p>
				{#if pickFolder}
					<button
						type="button"
						class="pau-button pau-button--primary session-view__retry"
						disabled={disconnected || opening}
						onclick={() => void chooseWorkspace()}>{opening ? 'Opening…' : 'Open workspace…'}</button>
				{:else}
					<form
						class="session-open"
						aria-label="Open workspace"
						onsubmit={(event) => {
							event.preventDefault();
							void openFolder(openPath.trim());
						}}>
						<label>
							<span>Folder path</span>
							<input
								type="text"
								bind:value={openPath}
								placeholder="/Users/you/projects/app"
								autocomplete="off"
								spellcheck="false" />
						</label>
						<div class="session-open__actions">
							<button
								type="submit"
								class="pau-button pau-button--primary"
								disabled={disconnected || opening || openPath.trim() === ''}>{opening ? 'Opening…' : 'Open'}</button>
							{#if !firstRun}
								<button type="button" class="pau-button pau-button--secondary" onclick={closeOpenForm}>Cancel</button>
							{/if}
						</div>
					</form>
				{/if}
				{#if openError}<p class="session-open__error" role="alert">{openError}</p>{/if}
				{#if firstRun}{@render readinessNotice()}{/if}
			</EmptyState>
		</section>
	{:else if openedWorkspace && openedWorkspace.sessions.length === 0}
		<section class="session-view session-view--empty" aria-labelledby="opened-workspace-title">
			<EmptyState level={1} role="status" titleId="opened-workspace-title" title={`${openedWorkspace.name} is open`}>
				<p>It has no sessions yet.</p>
				{#if onStartSession}
					<div class="session-view__start-actions">
						<button
							type="button"
							class="pau-button pau-button--primary"
							disabled={disconnected || startingWorkspaceId !== undefined}
							onclick={() => void startSession(openedWorkspace)}>Start session</button>
						<button
							type="button"
							class="pau-button pau-button--secondary"
							disabled={disconnected || startingWorkspaceId !== undefined || claudeReadiness !== undefined}
							aria-describedby={claudeReadiness ? 'claude-readiness-reason' : undefined}
							onclick={() => void startSession(openedWorkspace, 'claude')}>Start Claude Code session</button>
					</div>
				{/if}
				{@render readinessNotice(openedWorkspace.id)}
				{@render readinessNotice(openedWorkspace.id, 'claude')}
			</EmptyState>
		</section>
	{:else if sessionsLoading.active && !activeSession}
		{#if sessionsLoading.visible}
			<section class="session-view session-view--empty" aria-labelledby="loading-title">
				<EmptyState level={1} role="status" titleId="loading-title" title="Loading sessions…" />
			</section>
		{/if}
	{:else if restoredSession && restoredOpen}
		<section class="session-view" aria-labelledby="restored-session-title">
			<header class="session-view__header">
				<div>
					<p>Pi</p>
					<h1 class="pau-view-title" id="restored-session-title">{restoredSession.title}</h1>
				</div>
				<div class="session-view__header-actions">
					<div class="session-view__status session-view__status--stopped">
						<SessionStatusMark status="stopped" label="Stopped" />
						<span aria-hidden="true">Stopped</span>
					</div>
				</div>
			</header>
			<div class="session-view__notices">
				{#if disconnected}
					<p class="session-view__notice session-view__notice--attention" role="status">
						<strong>Disconnected.</strong>
						Pau lost its connection to the backend and is reconnecting.
					</p>
				{/if}
				<section class="session-ended" aria-label="Session stopped">
					<div class="session-ended__text">
						<p class="session-ended__state" role="status">
							<strong>Session stopped.</strong> Resume it to load the conversation and continue.
						</p>
						{#if resumeError}<p class="session-ended__error" role="alert">{resumeError}</p>{/if}
					</div>
					{#if onResumeSession}
						<button
							type="button"
							class="pau-button pau-button--primary"
							disabled={disconnected || resumingSavedId !== undefined}
							onclick={() => void resumeRestored(restoredSession)}>
							{resumingSavedId === restoredSession.id ? 'Resuming…' : 'Resume'}
						</button>
					{/if}
				</section>
			</div>
		</section>
	{:else if activeSession}
		<section class="session-view" aria-labelledby="session-title">
			<header class="session-view__header">
				<div>
					<p>
						<MetaText
							text={activeSession.model && !(onLoadModels && onSelectModel)
								? `${activeSession.agent} · ${activeSession.model}`
								: activeSession.agent} />
					</p>
					<h1 class="pau-view-title" id="session-title">{activeSession.title}</h1>
				</div>
				<div class="session-view__header-actions">
					<div class={`session-view__status session-view__status--${activeSession.status}`}>
						<SessionStatusMark status={headerStatus} label={headerStatusLabel} />
						<span aria-hidden="true">{headerStatusLabel}</span>
					</div>
					{#if canCompact && liveStatuses.has(activeSession.status)}
						{@const compactReason = compactUnavailableReason(activeSession, disconnected, compacting)}
						<div class="session-compact">
							<button
								type="button"
								class="pau-button pau-button--quiet"
								aria-expanded={compactOpen}
								aria-busy={compacting}
								aria-controls="compact-panel"
								disabled={compactReason !== undefined}
								title={compactReason}
								onclick={() => (compactOpen = !compactOpen)}>
								Compact
							</button>
							{#if compactOpen && compactReason === undefined}
								<form
									id="compact-panel"
									class="session-compact__panel"
									aria-label="Compact conversation"
									onsubmit={(event) => {
										event.preventDefault();
										void compact();
									}}>
									<p>Replace older messages with a summary to free up context.</p>
									<label>
										<span>Instructions (optional)</span>
										<textarea bind:value={compactInstructions} rows="3" placeholder="What the summary should keep"
										></textarea>
									</label>
									<div>
										<button
											type="button"
											class="pau-button pau-button--secondary"
											onclick={() => (compactOpen = false)}>
											Cancel
										</button>
										<button type="submit" class="pau-button pau-button--secondary">Compact now</button>
									</div>
								</form>
							{/if}
						</div>
					{/if}
					{#if onExportTranscript && activeSession.capabilities.exportTranscript && liveStatuses.has(activeSession.status)}
						{@const exporting = exportingSessionIds.has(activeSession.id)}
						<button
							type="button"
							class="pau-button pau-button--quiet"
							aria-busy={exporting}
							disabled={disconnected || exporting}
							title={disconnected ? 'Pau is reconnecting to the backend.' : 'Save the conversation as a web page'}
							onclick={() => void exportTranscript(activeSession)}>
							Export
						</button>
					{/if}
					{#if activeSession.capabilities.stop && (liveStatuses.has(activeSession.status) || activeSession.status === 'not_responding')}
						<button
							type="button"
							class="pau-button pau-button--quiet"
							disabled={disconnected}
							onclick={() => void stop()}>
							Stop
						</button>
					{/if}
				</div>
			</header>

			<div class="session-view__notices">
				{#if searchOpen && onSearchSession}
					{#key activeSession.id}
						<TranscriptSearch
							bind:this={transcriptSearch}
							agent={activeSession.agent}
							search={(query) => onSearchSession(activeSession.id, query)}
							onSelect={showSearchHit}
							onClose={closeSearch} />
					{/key}
				{/if}
				{#if disconnected}
					<p class="session-view__notice session-view__notice--attention" role="status">
						<strong>Disconnected.</strong>
						Pau lost its connection to the backend and is reconnecting. The agent keeps running.
					</p>
				{/if}
				{#if controlError}<p class="session-view__notice session-view__notice--failed" role="alert">
						{controlError}
					</p>{/if}
				{#if exportedTranscript?.sessionId === activeSession.id}
					<p class="session-view__notice" role="status">Transcript saved to {exportedTranscript.path}</p>
				{/if}

				{#if activeSession.status === 'starting'}
					<p class="session-view__notice" role="status">Starting the agent process…</p>
				{:else if activeSession.status === 'waiting'}
					<p class="session-view__notice session-view__notice--attention" role="alert">
						<strong>Attention required.</strong>
						{activeSession.attention ?? 'The agent is waiting for your response.'}
					</p>
				{/if}
				{#if autoRetry}
					<div class="session-view__notice session-view__notice--attention session-view__auto-retry" role="status">
						<p>
							<strong>{autoRetryLabel}</strong>
							{#if autoRetry.errorMessage}{autoRetry.errorMessage}{/if}
						</p>
						{#if activeSession.capabilities.retry}
							<button
								type="button"
								class="pau-button pau-button--secondary"
								disabled={disconnected}
								onclick={() => void cancelRetry()}>
								Cancel retry
							</button>
						{/if}
					</div>
				{/if}
				{#if compactionState?.status === 'running'}
					<p class="session-view__notice" role="status">{compactingLabel(compactionState.reason)}</p>
				{:else if compactionState?.status === 'failed'}
					<p class="session-view__notice session-view__notice--failed" role="alert">
						<strong>Compaction failed.</strong>
						{compactionState.message ?? 'Pi did not say why.'} The conversation is unchanged.
					</p>
				{:else if compactionState?.status === 'aborted'}
					<p class="session-view__notice" role="status">
						<strong>Compaction cancelled.</strong> The conversation is unchanged.
					</p>
				{:else if compactingSessionId === activeSession.id}
					<p class="session-view__notice" role="status">{compactingLabel('manual')}</p>
				{/if}
				{#if compactError && compactionState?.status !== 'failed'}
					<p class="session-view__notice session-view__notice--failed" role="alert">{compactError}</p>
				{/if}
				{#if retryError}<p class="session-view__notice session-view__notice--failed" role="alert">{retryError}</p>{/if}
			</div>

			<!-- A scrollable region needs keyboard access. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="session-view__transcript"
				role="region"
				tabindex="0"
				aria-label="Transcript"
				data-following={following}
				bind:this={transcriptElement}
				use:followTranscript={{ key: activeSessionId, onChange: (next) => (following = next) }}>
				<div class="session-view__transcript-content">
					{#if activeSession.transcript.length === 0 && pendingTranscript.length === 0}
						<EmptyState title="Start with a prompt">
							<p>Describe the task, relevant files, and any limits the agent should follow.</p>
						</EmptyState>
					{:else}
						{#snippet toolCall(tool: TranscriptTool)}
							<ToolCallView
								{tool}
								open={entryOpen(tool)}
								found={tool.id === foundEntryKey}
								onToggle={(open) => disclosures.set(tool.id, open)} />
						{/snippet}
						{#each transcriptRows as entry (entry.id)}
							{#if entry.kind === 'message'}
								<!-- Messages take focus so the keyboard can open their context menu. -->
								<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
								<article
									class={`session-message session-message--${entry.role}`}
									aria-label={`${entry.role} message`}
									tabindex="0"
									data-entry-id={entry.id}
									data-found={entry.id === foundEntryKey || undefined}
									oncontextmenu={(event) => openMessageMenu(event, activeSession, entry)}
									onkeydown={(event) => {
										if (event.target === event.currentTarget && isContextMenuKey(event)) {
											openMessageMenu(event, activeSession, entry);
										}
									}}>
									<h2><MetaText text={entry.label ?? (entry.role === 'user' ? 'You' : activeSession.agent)} /></h2>
									{#if entry.body}
										<CopyButton
											class="session-message__copy"
											text={entry.body}
											label={entry.role === 'user' ? 'Copy your message' : 'Copy reply'}
											onResult={announceCopy} />
									{/if}
									{#if entry.role === 'assistant'}
										<Markdown text={entry.body} />
									{:else if entry.body}
										<p>{entry.body}</p>
									{/if}
									{#if entry.images?.length || entry.hiddenImages?.older}
										<ul class="session-images session-message__images" aria-label="Attached images">
											{#each entry.images ?? [] as image, index (index)}
												<li>
													<img
														src={`data:${image.mimeType};base64,${image.data}`}
														alt={`Image ${index + 1} of ${entry.images?.length}`}
														decoding="async"
														loading="lazy" />
												</li>
											{/each}
											{#each { length: entry.hiddenImages?.older ?? 0 }, index (index)}
												<li class="session-images__older">Older image not shown</li>
											{/each}
										</ul>
									{/if}
									{#if entry.hiddenImages?.tooLarge}
										<p class="session-message__hidden-images">
											{hiddenImagesLabel(entry.hiddenImages.tooLarge, 'too large')}
										</p>
									{/if}
									{#if entry.hiddenImages?.unreadable}
										<p class="session-message__hidden-images">
											{hiddenImagesLabel(entry.hiddenImages.unreadable, 'damaged or unsupported')}
										</p>
									{/if}
									{#if canRetry && entry.id === retryableEntryId}
										<button
											type="button"
											class="pau-button pau-button--secondary session-message__retry"
											disabled={retrying}
											onclick={() => void retry()}>
											{retrying ? 'Sending…' : 'Send message again'}
										</button>
									{/if}
								</article>
							{:else if entry.kind === 'thinking'}
								<details
									class="pau-disclosure session-thinking"
									open={entryOpen(entry)}
									ontoggle={(event) => recordDisclosure(entry, event.currentTarget.open)}
									data-entry-id={entry.id}
									data-found={entry.id === foundEntryKey || undefined}>
									<summary>
										<Icon name="chevronRight" class="pau-disclosure__chevron" size={14} />
										{entry.complete ? 'Thinking' : 'Thinking…'}
									</summary>
									<p>{entry.body}</p>
								</details>
							{:else if entry.kind === 'tool'}
								{@render toolCall(entry)}
							{:else if entry.kind === 'tool-group'}
								<ToolCallGroup
									id={entry.id}
									count={entry.tools.length}
									open={groupOpen(entry)}
									onToggle={(open) => disclosures.set(entry.id, open)}>
									{#each entry.tools as tool (tool.id)}
										{@render toolCall(tool)}
									{/each}
								</ToolCallGroup>
							{:else if entry.kind === 'compaction'}
								<details
									class="pau-disclosure session-compaction"
									aria-label="Compacted context"
									data-entry-id={entry.id}
									data-found={entry.id === foundEntryKey || undefined}>
									<summary>
										<Icon name="chevronRight" class="pau-disclosure__chevron" size={14} />
										<span>Context compacted{entry.reason && entry.reason !== 'manual' ? ' automatically' : ''}</span>
										{#if compactionSizes(entry)}<small>{compactionSizes(entry)}</small>{/if}
									</summary>
									<p>{entry.summary}</p>
									{#if entry.willRetry}<p>Pi resends your last message next.</p>{/if}
								</details>
							{:else}
								<article class="session-denial" aria-label="Sandbox denial">
									<div>
										<p class="session-denial__label pau-section-label">Sandbox denial</p>
										<h2>{denialTitle(entry)}</h2>
									</div>
									{#if entry.target === 'file'}
										<code>{entry.path}</code>
									{:else if entry.target === 'network'}
										<code>{entry.destination}</code>
									{/if}
									<p>{denialExplanation(entry)}</p>
								</article>
							{/if}
						{/each}
						{#each pendingTranscript as prompt (prompt.id)}
							<article
								class="session-message session-message--user session-message--pending"
								aria-label="user message"
								data-delivery={prompt.state === 'failed' ? 'failed' : 'pending'}>
								<h2>You <span>{prompt.state === 'failed' ? 'Not sent' : 'Sending…'}</span></h2>
								<CopyButton
									class="session-message__copy"
									text={prompt.text}
									label="Copy your message"
									onResult={announceCopy} />
								<p>{prompt.text}</p>
							</article>
						{/each}
					{/if}
				</div>
			</div>

			<p class="pau-visually-hidden session-view__announcer" role="status">{announcement}</p>
			{#if arrived}
				<!-- Mouse down must not move focus out of the composer. -->
				<button
					type="button"
					class="session-view__jump pau-button pau-button--secondary"
					title="Jump to latest (Ctrl+End)"
					onmousedown={(event) => event.preventDefault()}
					onclick={scrollToLatest}
					transition:fade={{ duration: isReducedMotion() ? 0 : motion.duration.quick }}>
					<Icon name="chevronDown" size={14} /><span>Jump to latest</span>{#if newEntries > 0}<small
							>{newEntries} new</small
						>{/if}
				</button>
			{/if}

			<div class="session-view__composer-stack">
				{#if queuedCount > 0 || pendingQueue.length > 0}
					<section class="session-queue" aria-label="Queued messages">
						<header>
							<h2 class="pau-section-label">Queued <span>{queuedCount + pendingQueue.length}</span></h2>
							{#if queuedCount > 0}
								<button
									type="button"
									class="pau-button pau-button--secondary"
									disabled={disconnected}
									onclick={() => void clearQueue()}>
									Clear queue
								</button>
							{/if}
						</header>
						<ul>
							{#if queuedCount > 0 && activeSession.messageQueue}
								{#each activeSession.messageQueue.steering as message, index (`steer-${index}`)}
									<li><strong>Steer</strong><span>{message}</span></li>
								{/each}
								{#each activeSession.messageQueue.followUp as message, index (`follow-up-${index}`)}
									<li><strong>Follow up</strong><span>{message}</span></li>
								{/each}
							{/if}
							{#each pendingQueue as prompt (prompt.id)}
								<li data-delivery={prompt.state === 'failed' ? 'failed' : 'pending'}>
									<strong>{prompt.queue === 'steer' ? 'Steer' : 'Follow up'}</strong>
									<span>{prompt.text}</span>
									<small>{prompt.state === 'failed' ? 'Not sent' : 'Sending…'}</small>
								</li>
							{/each}
						</ul>
						{#if queueError}<p class="session-composer__error" role="alert">{queueError}</p>{/if}
					</section>
				{/if}
				<ExtensionUi
					state={activeSession.extensionUi ?? emptyExtensionUi}
					onRespond={(response) => onExtensionUiResponse(activeSession.id, response)}
					onTimeout={(requestId) => onExtensionUiTimeout(activeSession.id, requestId)}
					onOpenTerminal={onOpenPiTerminal ? () => onOpenPiTerminal(activeSession.id) : undefined}>
					{#if ended}
						<section class="session-ended" aria-label="Session ended">
							<div class="session-ended__text">
								{#if activeSession.status === 'failed'}
									<p class="session-ended__state session-ended__state--failed" role="alert">
										<strong>Session failed.</strong>
										{activeSession.error ?? 'Open the diagnostics to see what went wrong.'}
									</p>
								{:else}
									<p class="session-ended__state" role="status">
										<strong>Session stopped.</strong> Its transcript remains available.
									</p>
								{/if}
								{#if draft.trim()}
									<p>Your unsent draft returns to the composer when the session starts again.</p>
								{/if}
								{#if restartError}<p class="session-ended__error" role="alert">{restartError}</p>{/if}
							</div>
							{#if onRestartSession}
								<button
									type="button"
									class="pau-button pau-button--primary"
									disabled={disconnected || restartingSessionId !== undefined}
									onclick={() => void restart(activeSession.id)}>
									{restartingSessionId === activeSession.id ? 'Starting…' : 'Start again'}
								</button>
							{/if}
						</section>
					{:else}
						<form
							class="session-composer"
							data-drop={dropCopy ? (dropCopy.accepts ? 'accept' : 'reject') : undefined}
							aria-label="Prompt composer"
							ondragenter={handleImageDragEnter}
							ondragover={handleImageDragOver}
							ondragleave={handleImageDragLeave}
							ondrop={handleImageDrop}
							onsubmit={(event) => {
								event.preventDefault();
								void submitPrompt();
							}}>
							{#if images.length > 0}
								<ul class="session-images session-composer__images" aria-label="Attached images">
									{#each images as image (image.id)}
										<li>
											<img src={image.previewUrl} alt={image.name} />
											<button
												type="button"
												class="pau-button pau-button--quiet"
												aria-label={`Remove ${image.name}`}
												onclick={() => removeImage(image.id)}>
												Remove
											</button>
										</li>
									{/each}
								</ul>
							{/if}
							{#if commandMatches}
								<div class="session-composer__completion">
									<CommandCompletion
										id={commandListId}
										commands={commandMatches}
										selected={commandSelected}
										onAccept={acceptCommand} />
								</div>
							{/if}
							{#if mentionOpen}
								<div class="session-composer__completion">
									<MentionCompletion
										id={mentionListId}
										files={mentionResults ?? []}
										selected={mentionSelected}
										failed={mentionFailed}
										truncated={mentionTruncated}
										onAccept={acceptMention} />
								</div>
							{/if}
							<label class="session-composer__field">
								<span class="pau-visually-hidden">Prompt</span>
								<Icon name="chevronRight" class="session-composer__prompt" />
								<textarea
									bind:this={composer}
									{...{ [COMPOSER_ATTRIBUTE]: '' }}
									bind:value={draft}
									onkeydown={handleComposerKeydown}
									onpaste={handleComposerPaste}
									oninput={() => {
										draftTyped = true;
										commandSelected = 0;
										mentionSelected = 0;
										caret = composer?.selectionStart ?? draft.length;
									}}
									onkeyup={() => (caret = composer?.selectionStart ?? draft.length)}
									onclick={() => (caret = composer?.selectionStart ?? draft.length)}
									onblur={() => {
										// A press outside the composer closes its completion lists, as Escape does.
										dismissedDraft = draft;
										dismissedMention = draft;
									}}
									aria-autocomplete={commandMatches || mentionOpen ? 'list' : undefined}
									aria-controls={activeOption?.list}
									aria-activedescendant={activeOption ? `${activeOption.list}-option-${activeOption.index}` : undefined}
									placeholder={activeSession.status === 'running'
										? 'Add direction or queue a follow-up'
										: 'Message the agent'}
									aria-describedby={composerUnavailable ? 'composer-unavailable' : undefined}
									disabled={composerUnavailable !== undefined}></textarea>
							</label>
							<div class="session-composer__footer" data-overlay-anchor>
								<div class="session-composer__options">
									{#if activeSession.status === 'running' && canQueue}
										<Select
											label="Send as"
											variant="quiet"
											options={[
												...(activeSession.capabilities.steer ? [{ value: 'steer' as const, label: 'Steer now' }] : []),
												...(activeSession.capabilities.followUp
													? [{ value: 'follow-up' as const, label: 'Follow up' }]
													: [])
											]}
											value={activeQueue}
											onChange={(next) => {
												queue = next;
											}} />
									{/if}
									{#if onLoadModels && onSelectModel}
										{#key activeSession.id}
											<!-- Each control shows only when the agent can change it in a session. -->
											{#if activeSession.capabilities.modelSelection}
												<ModelPicker
													bind:this={modelPicker}
													load={() => onLoadModels(activeSession.id)}
													onSelect={(model) => onSelectModel(activeSession.id, model)}
													unavailableReason={modelUnavailableReason(activeSession, disconnected)}
													fallbackLabel={activeSession.model}
													onLoaded={(models) =>
														(currentModelReasoning = models.find((model) => model.current)?.reasoning)} />
											{/if}
											{#if onSelectThinkingLevel && activeSession.capabilities.thinkingLevel}
												<ThinkingLevelPicker
													bind:this={thinkingPicker}
													level={activeSession.thinkingLevel}
													onSelect={(level) => onSelectThinkingLevel(activeSession.id, level)}
													reasoning={offersThinking(activeSession)}
													levels={activeSession.thinkingLevels}
													unavailableReason={thinkingUnavailableReason(activeSession, disconnected)} />
											{/if}
										{/key}
									{/if}
									<ContextMeter usage={activeSession.usage} supported={activeSession.capabilities.usage ?? false} />
								</div>
								<div class="session-composer__actions">
									<input
										bind:this={imagePicker}
										class="pau-visually-hidden"
										type="file"
										accept={imageAccept}
										multiple
										tabindex="-1"
										aria-label="Image files"
										onchange={(event) => {
											attachImages(event.currentTarget.files ?? []);
											event.currentTarget.value = '';
										}} />
									<button
										type="button"
										class="pau-button pau-button--secondary"
										disabled={composerUnavailable !== undefined}
										onclick={() => imagePicker?.click()}>
										Attach image
									</button>
									{#if activeSession.status === 'running' && activeSession.capabilities.interrupt}
										<button
											type="button"
											class="pau-button pau-button--secondary"
											disabled={disconnected}
											onclick={() => void interrupt()}>
											<span>Interrupt</span>{#if interruptShortcut}<kbd>{interruptShortcut}</kbd>{/if}
										</button>
									{/if}
									{#if shellRunning && onStopShellCommands}
										<button
											type="button"
											class="pau-button pau-button--secondary"
											disabled={disconnected}
											onclick={() => void stopShellCommands()}>
											<span>Stop command</span>{#if interruptShortcut && activeSession.status !== 'running'}<kbd
													>{interruptShortcut}</kbd
												>{/if}
										</button>
									{/if}
									<button
										type="submit"
										class="pau-button pau-button--primary"
										disabled={!draft.trim() || sending || composerUnavailable !== undefined}>
										<span
											>{sending
												? 'Sending…'
												: onRunShellCommand && draftShell && activeSession.capabilities.shellCommands
													? 'Run command'
													: activeQueue === 'follow-up' && activeSession.status === 'running'
														? 'Queue prompt'
														: 'Send prompt'}</span
										>{#if submitShortcut}<kbd>{submitShortcut}</kbd>{/if}
									</button>
								</div>
							</div>
							{#if unknownCommand !== undefined}
								<p class="session-composer__hint">Not a known command. It will be sent as written.</p>
							{:else if draftBuiltin?.command.unavailable && !commandMatches}
								<p class="session-composer__hint">
									/{draftBuiltin.command.name}: {draftBuiltin.command.unavailable}
									{#if onOpenPiTerminal}
										<button
											type="button"
											class="pau-button pau-button--secondary"
											onclick={() => onOpenPiTerminal(activeSession.id)}>Open Pi in terminal</button>
									{:else if onOpenTerminal && activeWorkspace}
										<button
											type="button"
											class="pau-button pau-button--secondary"
											onclick={() => onOpenTerminal(activeWorkspace.id)}>Open terminal</button>
									{/if}
								</p>
							{/if}
							{#if composerUnavailable}
								<p id="composer-unavailable" class="session-composer__hint">{composerUnavailable}</p>
							{/if}
							{#if imageError || error}
								<p class="session-composer__error" role="alert">{[imageError, error].filter(Boolean).join(' ')}</p>
							{/if}
							{#if dropCopy}
								<div class="session-composer__drop" role="status">
									<strong>{dropCopy.title}</strong>
									<span>{dropCopy.detail}</span>
								</div>
							{/if}
						</form>
					{/if}
				</ExtensionUi>
				<SessionStatusLine
					path={activeWorkspace?.path}
					branch={activeWorkspace?.branch}
					usage={activeSession.usage}
					usageSupported={activeSession.capabilities.usage ?? false}
					statuses={activeSession.extensionUi?.statuses} />
			</div>
		</section>
	{:else}
		<section class="session-view session-view--empty" aria-labelledby="empty-title">
			<EmptyState level={1} titleId="empty-title" title="No session selected">
				<p>
					{onStartSession
						? 'Select a session from the rail, or start one with the + button next to a workspace.'
						: 'Select a session from the rail, or start one in this workspace.'}
				</p>
				{@render readinessNotice(workspaces[0]?.id)}
			</EmptyState>
		</section>
	{/if}
</ApplicationShell>

<style>
	/* Rows run edge to edge so the selected surface spans the rail. */
	.session-rail {
		padding: 0 0 var(--pau-space-4);
	}

	/* The workspace name gives way to its controls, which never shrink or clip. */
	.session-rail__heading {
		display: flex;
		align-items: center;
		gap: var(--pau-space-1);
		min-width: 0;
		padding-inline: var(--pau-space-2);
	}

	/* The quiet button rests with a border; the pseudo-element widens its hit area to 44px. */
	.session-rail .session-rail__icon-button {
		position: relative;
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: var(--pau-size-row-md);
		min-height: 0;
		height: var(--pau-size-row-md);
		padding: 0;
		color: var(--pau-text);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
	}

	.session-rail .session-rail__icon-button::after {
		content: '';
		position: absolute;
		inset: calc((var(--pau-size-row-md) - var(--pau-size-target-touch)) / 2 - 1px);
	}

	.session-rail .session-rail__icon-button[aria-pressed='true'] {
		color: var(--pau-accent);
		background-color: var(--pau-surface-raised);
	}

	.session-rail .session-rail__icon-button:disabled {
		cursor: not-allowed;
	}

	.session-rail section + section {
		margin-top: var(--pau-space-4);
	}

	.session-rail h2 {
		flex: 1;
		min-width: 0;
		margin: 0;
		padding: var(--pau-space-2);
		overflow: hidden;
		color: var(--pau-text-muted);
		font-size: var(--pau-type-sm);
		font-weight: var(--pau-weight-medium);
		text-overflow: ellipsis;
		text-transform: none;
		white-space: nowrap;
	}

	.session-rail ul {
		display: grid;
		gap: 0;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/*
	 * The status mark gets a column as wide as the mark and sits one spacing step
	 * from the name, as it does beside the status in the session header. The
	 * mark lines up with the workspace name above it, and the session name
	 * starts where the shell's context rail starts its labels. A shared
	 * `pau-button` in the rail, such as Try again, keeps the shared style.
	 * `:where` keeps this rule's weight, so rail classes still override it.
	 */
	.session-rail button:where(:not(.pau-button)) {
		display: grid;
		grid-template-columns: 0.5rem minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--pau-space-2);
		width: 100%;
		min-height: var(--pau-size-row-md);
		padding: 0 var(--pau-space-3) 0 var(--pau-space-4);
		background-color: transparent;
		border: 0;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.session-rail button.active {
		color: var(--pau-text);
		background-color: var(--pau-surface-selected);
		box-shadow: inset 2px 0 0 var(--pau-accent);
	}

	.session-rail__name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.session-rail__state {
		display: inline-flex;
		align-items: center;
		gap: var(--pau-space-2);
	}

	.session-rail__marker {
		flex: none;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--pau-info);
	}

	.session-rail__marker--waiting {
		background: var(--pau-warning);
	}

	.session-rail__marker--failed {
		background: var(--pau-danger);
	}

	.session-rail small {
		color: inherit;
		font-size: var(--pau-type-xs);
	}

	.session-rail .session-rail__open {
		grid-template-columns: auto minmax(0, 1fr);
		min-height: var(--pau-size-row-md);
		width: calc(100% - 2 * var(--pau-space-2));
		margin: 0 var(--pau-space-2) var(--pau-space-3);
		padding-block: 0;
		font-size: var(--pau-type-sm);
		color: var(--pau-text);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
	}

	.session-rail .session-rail__open span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.session-rail .session-rail__open:disabled {
		color: var(--pau-text-muted);
		cursor: not-allowed;
	}

	.session-open {
		display: grid;
		gap: var(--pau-space-3);
		margin-top: var(--pau-space-4);
	}

	.session-open label {
		display: grid;
		gap: var(--pau-space-1);
		color: var(--pau-text-muted);
		font-size: var(--pau-type-sm);
	}

	.session-open input {
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-3);
		color: var(--pau-text);
		background: var(--pau-surface);
		border: 1px solid var(--pau-border-control);
		border-radius: var(--pau-radius-control);
		font: inherit;
		font-family: var(--pau-font-code);
		font-variant-ligatures: none;
	}

	.session-open__actions {
		display: flex;
		gap: var(--pau-space-2);
	}

	.session-view--empty .session-open__error {
		margin-top: var(--pau-space-3);
		color: var(--pau-danger);
	}

	/* The inset matches the workspace name: heading inset plus the name's own padding. */
	.session-rail__empty {
		margin: 0;
		padding: var(--pau-space-2) var(--pau-space-3) var(--pau-space-2) var(--pau-space-4);
		color: var(--pau-text-muted);
	}

	.session-rail .session-rail__saved:disabled {
		cursor: not-allowed;
	}

	.session-rail .session-rail__saved:disabled:hover {
		color: var(--pau-text-muted);
		background: transparent;
	}

	/* The message and its retry start at the workspace name's inset, like the empty note. */
	.session-rail__recent-failure {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--pau-space-2);
		padding: var(--pau-space-2) var(--pau-space-3) var(--pau-space-2) var(--pau-space-4);
	}

	.session-rail__recent-failure p {
		margin: 0;
		color: var(--pau-danger);
	}

	.session-rail__rename {
		width: 100%;
		min-height: var(--pau-size-row-md);
		padding: 0 var(--pau-space-3) 0 var(--pau-space-4);
		color: var(--pau-text);
		font: inherit;
		background: var(--pau-canvas);
		border: 1px solid var(--pau-focus);
		border-radius: 0;
	}

	.session-rail__error {
		margin: var(--pau-space-2) 0 0;
		padding: var(--pau-space-2) var(--pau-space-4);
		color: var(--pau-danger);
		font-size: var(--pau-type-sm);
	}

	.session-rail h2:focus-visible,
	.session-message:focus-visible {
		outline: 2px solid var(--pau-focus);
		outline-offset: 2px;
	}

	.session-view {
		display: grid;
		grid-template-areas:
			'header'
			'notice'
			'transcript'
			'composer';
		grid-template-rows: auto auto minmax(0, 1fr) auto;
		height: 100%;
		min-height: 0;
		/*
		 * The header, transcript, composer, and status line share one column,
		 * so all four start and end on the same edges. Only transcript prose
		 * keeps a narrower reading measure inside it.
		 */
		max-width: 58rem;
		margin-inline: auto;
	}

	/*
	 * Empty states and the saved-session picker read as a top-aligned panel.
	 * Centering them vertically left a lone heading floating in a tall pane,
	 * far from the rail and the actions it describes.
	 */
	.session-view--empty {
		align-items: start;
	}

	/* Stand-alone empty states share the transcript column, so their text starts at its left edge. */
	.session-view--empty > :global(.empty-state) {
		grid-area: transcript;
	}

	.session-view__header {
		grid-area: header;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--pau-space-4);
		padding-bottom: var(--pau-space-4);
		border-bottom: 1px solid var(--pau-border);
	}

	.session-view__header p,
	.session-view__header h1,
	.session-message h2,
	.session-message p,
	.session-view__notice {
		margin: 0;
	}

	.session-view__header p,
	.session-message h2 {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
		font-weight: var(--pau-weight-medium);
	}

	.session-view__header h1 {
		margin-top: var(--pau-space-1);
		text-wrap: balance;
	}

	.session-view__header-actions {
		display: flex;
		align-items: center;
		gap: var(--pau-space-3);
		flex: none;
	}

	.session-view__retry {
		margin-top: var(--pau-space-4);
	}

	.session-view__start-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--pau-space-2);
		margin-top: var(--pau-space-4);
	}

	.session-view__failure code {
		font-family: var(--pau-font-code);
		font-variant-ligatures: none;
		font-size: var(--pau-type-sm);
	}

	.session-message__retry {
		margin-top: var(--pau-space-3);
	}

	.session-view__auto-retry {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--pau-space-3);
	}

	.session-view__auto-retry p {
		margin: 0;
	}

	.session-view__auto-retry button {
		flex: none;
	}

	.session-view__status {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--pau-space-2);
		flex: none;
		/*
		 * Fits the longest label so the actions beside it never move. The label
		 * sits at the trailing edge, beside the actions, instead of leaving the
		 * spare width as a gap before them.
		 */
		width: 7.5rem;
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
		white-space: nowrap;
	}

	.session-view__notices {
		grid-area: notice;
		display: grid;
		gap: var(--pau-space-2);
	}

	.session-view__notices > :first-child {
		margin-top: var(--pau-space-4);
	}

	.session-view__notice {
		padding: var(--pau-space-3) var(--pau-space-3);
		color: var(--pau-text-muted);
		background: var(--pau-canvas);
		border-left: 2px solid var(--pau-info);
	}

	.session-view__notice--attention {
		color: var(--pau-text);
		border-color: var(--pau-warning);
	}

	.session-view__notice--failed {
		color: var(--pau-text);
		border-color: var(--pau-danger);
	}

	/* A secondary button that floats over the transcript, so it needs a fill. */
	.session-view__jump {
		grid-area: transcript;
		z-index: 1;
		align-self: end;
		justify-self: center;
		margin-bottom: var(--pau-space-3);
		background-color: var(--pau-surface);
		box-shadow: 0 0.25rem 1rem rgb(0 0 0 / 24%);
	}

	.session-view__jump small {
		color: var(--pau-text-muted);
	}

	/*
	 * The scroll box reaches `space/4` past the column's right edge, so an
	 * overlay scrollbar draws beside the text instead of over it.
	 */
	.session-view__transcript {
		grid-area: transcript;
		margin-right: calc(var(--pau-space-4) * -1);
		padding-right: var(--pau-space-4);
		overflow: auto;
	}

	.session-view__transcript-content {
		display: grid;
		align-content: start;
		gap: var(--pau-space-5);
		padding-block: var(--pau-space-5) var(--pau-space-6);
	}

	.session-message {
		position: relative;
	}

	/*
	 * Paragraph and list text keeps a 75ch reading measure from the column's
	 * left edge. The cap goes on the list, not its items, so items at every
	 * level end where paragraphs end instead of one indent further right.
	 * Code, tool output, diffs, and tables use the full column.
	 */
	.session-view__transcript :global(p),
	.session-view__transcript :global(:is(ul, ol)) {
		max-width: 75ch;
	}

	.session-message :global(.session-message__copy) {
		position: absolute;
		top: 0;
		right: 0;
		opacity: 0;
	}

	.session-message:hover :global(.session-message__copy),
	.session-message:focus-within :global(.session-message__copy) {
		opacity: 1;
	}

	@media (hover: none) {
		.session-message :global(.session-message__copy) {
			opacity: 1;
		}
	}

	/* Marks the entry a search selection scrolled to, then fades. */
	.session-view__transcript :global([data-found]) {
		animation: session-found 1600ms var(--pau-ease-out);
	}

	@keyframes session-found {
		from,
		60% {
			background: color-mix(in srgb, var(--pau-accent) 18%, transparent);
		}
	}

	/*
	 * Message text inside the rule starts on the transcript's inset edge, the
	 * same `space/5` from the entry's left edge as disclosure summaries and
	 * tool bodies (see `disclosure.css`).
	 */
	.session-message--user {
		padding-left: calc(var(--pau-space-5) - 2px);
		border-left: 2px solid var(--pau-accent);
	}

	/* A pending prompt reads as a draft of the message it becomes. */
	.session-message--pending {
		border-left-color: var(--pau-border);
	}

	.session-message--pending[data-delivery='pending'] p {
		opacity: 0.7;
	}

	.session-message--pending[data-delivery='failed'] {
		border-left-color: var(--pau-danger);
	}

	.session-message--pending h2 span {
		margin-left: var(--pau-space-2);
	}

	.session-queue li small {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}

	.session-message--pending[data-delivery='failed'] h2 span,
	.session-queue li[data-delivery='failed'] small {
		color: var(--pau-danger);
	}

	.session-message p,
	.session-thinking p {
		margin: var(--pau-space-2) 0 0;
		font-size: var(--pau-type-md);
		line-height: 1.65;
		white-space: pre-wrap;
	}

	.session-thinking {
		color: var(--pau-text-muted);
	}

	.session-thinking summary {
		display: flex;
		align-items: center;
		min-height: var(--pau-size-row-md);
	}

	.session-thinking p {
		padding-left: var(--pau-space-5);
		font-size: var(--pau-type-sm);
	}

	.session-compaction {
		padding-block: var(--pau-space-1);
		color: var(--pau-text-muted);
		border-block: 1px dashed var(--pau-border);
	}

	.session-compaction summary {
		display: flex;
		align-items: center;
		gap: var(--pau-space-3);
		min-height: var(--pau-size-row-md);
	}

	.session-compaction small {
		font-size: var(--pau-type-xs);
		font-variant-numeric: tabular-nums;
	}

	.session-compaction p {
		margin: var(--pau-space-2) 0 0;
		padding-left: var(--pau-space-5);
		font-size: var(--pau-type-sm);
		line-height: 1.65;
		white-space: pre-wrap;
	}

	.session-compact {
		position: relative;
	}

	.session-compact__panel {
		position: absolute;
		top: calc(100% + var(--pau-space-2));
		right: 0;
		z-index: 5;
		display: grid;
		gap: var(--pau-space-3);
		width: min(22rem, 90vw);
		padding: var(--pau-space-3);
		background: var(--pau-canvas);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		font-size: var(--pau-type-md);
	}

	.session-compact__panel p {
		margin: 0;
		color: var(--pau-text-muted);
	}

	.session-compact__panel label {
		display: grid;
		gap: var(--pau-space-1);
	}

	.session-compact__panel textarea {
		padding: var(--pau-space-2);
		color: var(--pau-text);
		background: transparent;
		border: 1px solid var(--pau-border-control);
		border-radius: var(--pau-radius-control);
		font: inherit;
		resize: vertical;
	}

	.session-compact__panel div {
		display: flex;
		justify-content: flex-end;
		gap: var(--pau-space-2);
	}

	.session-denial {
		display: grid;
		gap: var(--pau-space-2);
		padding: var(--pau-space-3) var(--pau-space-4);
		background: var(--pau-canvas);
		border-left: 2px solid var(--pau-danger);
	}

	.session-denial h2,
	.session-denial p {
		margin: 0;
	}

	.session-denial h2 {
		font-size: var(--pau-type-md);
		font-weight: var(--pau-weight-semibold);
	}

	.session-denial .session-denial__label {
		margin-bottom: var(--pau-space-1);
		color: var(--pau-danger);
	}

	.session-denial code {
		max-width: 100%;
		overflow-wrap: anywhere;
		color: var(--pau-text);
		font-family: var(--pau-font-code);
		font-variant-ligatures: none;
		font-size: var(--pau-type-xs);
	}

	.session-denial > p {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-md);
		line-height: 1.5;
	}

	.session-view__composer-stack {
		position: sticky;
		grid-area: composer;
		bottom: 0;
		display: grid;
		gap: var(--pau-space-2);
	}

	.session-queue {
		display: grid;
		gap: var(--pau-space-2);
		padding: var(--pau-space-2) var(--pau-space-3);
		background: var(--pau-surface);
		border: 1px solid var(--pau-border);
	}

	.session-queue header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--pau-space-3);
	}

	.session-queue h2 {
		margin: 0;
	}

	.session-queue h2 span {
		color: var(--pau-text);
		font-variant-numeric: tabular-nums;
	}

	.session-queue ul {
		display: grid;
		gap: var(--pau-space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.session-queue li {
		display: grid;
		grid-template-columns: 5rem minmax(0, 1fr) auto;
		gap: var(--pau-space-2);
		font-size: var(--pau-type-md);
	}

	.session-queue li strong {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
		font-weight: var(--pau-weight-semibold);
	}

	.session-queue li span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/*
	 * The field always spans the composer. Delivery mode and the actions share
	 * one footer row below it, so a narrow main column never squeezes the field.
	 */
	.session-composer {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		background: var(--pau-surface);
		border: 1px solid var(--pau-border);
	}

	/* The transcript scrolls, so rings sit inside the control to stay uncut. */
	.session-view :global(button:focus-visible),
	.session-view :global(summary:focus-visible) {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset-inset);
	}

	/* Only the border color and style change, so the composer keeps its size. */
	.session-composer[data-drop] {
		border-style: dashed;
	}

	.session-composer[data-drop='accept'] {
		border-color: var(--pau-focus);
	}

	.session-composer[data-drop='reject'] {
		border-color: var(--pau-danger);
	}

	/*
	 * The target covers the composer's own box and ignores the pointer, so
	 * drag events keep reaching the fields underneath and the layout around
	 * the composer stays put.
	 */
	.session-composer__drop {
		position: absolute;
		inset: 0;
		z-index: 1;
		display: grid;
		place-content: center;
		gap: var(--pau-space-1);
		padding: var(--pau-space-3);
		text-align: center;
		pointer-events: none;
		background: var(--pau-surface-raised);
	}

	.session-composer__drop strong {
		color: var(--pau-text);
		font-weight: var(--pau-weight-semibold);
	}

	.session-composer__drop span {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-sm);
	}

	.session-composer[data-drop='reject'] .session-composer__drop strong {
		color: var(--pau-danger);
	}

	/* Image thumbnails, shared by the composer and the prompts in the transcript. */
	.session-images {
		display: flex;
		flex-wrap: wrap;
		gap: var(--pau-space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.session-composer__images {
		padding: var(--pau-space-2) var(--pau-space-3);
		border-bottom: 1px solid var(--pau-border);
	}

	.session-message__images {
		margin-top: var(--pau-space-2);
	}

	.session-message p.session-message__hidden-images {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-sm);
	}

	.session-images li {
		display: grid;
		gap: var(--pau-space-1);
		justify-items: start;
	}

	/* Takes the composer's place once the agent process has ended, with the same frame. */
	.session-ended {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--pau-space-3);
		padding: var(--pau-space-3);
		background: var(--pau-surface);
		border: 1px solid var(--pau-border);
	}

	.session-ended__text {
		display: grid;
		flex: 1 1 16rem;
		gap: var(--pau-space-1);
		min-width: 0;
	}

	.session-ended__text p {
		margin: 0;
		color: var(--pau-text-muted);
		font-size: var(--pau-type-sm);
	}

	.session-ended__text .session-ended__state {
		color: var(--pau-text);
		font-size: var(--pau-type-md);
	}

	.session-ended__state--failed strong,
	.session-ended__text .session-ended__error {
		color: var(--pau-danger);
	}

	.session-images img {
		width: 4rem;
		height: 4rem;
		object-fit: cover;
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
	}

	/* Holds an older image's place at thumbnail size, so dropping it does not move the transcript. */
	.session-images li.session-images__older {
		width: 4rem;
		height: 4rem;
		place-content: center;
		justify-items: center;
		border: 1px dashed var(--pau-border);
		border-radius: var(--pau-radius-control);
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
		line-height: 1.2;
		text-align: center;
	}

	/*
	 * Completion lists float above the composer on the popover surface, so
	 * opening one never changes the composer's height or moves the transcript.
	 */
	.session-composer__completion {
		position: absolute;
		/* Offsets start inside the composer's 1px border, so -1px lines the edges up. */
		right: -1px;
		bottom: calc(100% + var(--pau-space-1));
		left: -1px;
		z-index: 10;
		overflow: hidden;
		background: var(--pau-surface-raised);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-overlay);
		box-shadow: var(--pau-shadow-overlay);
	}

	.session-composer__completion > :global(*) {
		background: transparent;
		border: 0;
	}

	.session-composer__field {
		display: flex;
		align-items: start;
		min-width: 0;
	}

	/* The ring marks the field, not the footer controls that share the composer. */
	.session-composer__field:focus-within {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset-inset);
	}

	/*
	 * Centers the 1em mark on the field's first 1.5em line. The chevron's stroke
	 * sits in the middle of its box, so the smaller inline margin lines the
	 * stroke up with the footer labels below.
	 */
	.session-composer__field :global(.session-composer__prompt) {
		flex: none;
		margin: calc(var(--pau-space-3) + 0.25em) 0 0 var(--pau-space-2);
		color: var(--pau-accent);
		font-size: var(--pau-type-md);
	}

	.session-composer textarea {
		width: 100%;
		min-height: 3.5rem;
		max-height: 10rem;
		padding: var(--pau-space-3);
		resize: vertical;
		color: var(--pau-text);
		background: transparent;
		border: 0;
		outline: 0;
		font: inherit;
		line-height: 1.5;
	}

	.session-composer textarea::placeholder {
		color: var(--pau-text-muted);
	}

	.session-composer textarea:disabled {
		cursor: not-allowed;
	}

	/*
	 * Controls wrap onto more lines when the row runs out, never the field.
	 * Delivery mode, model, thinking, and context read as quiet options beside
	 * the full-size actions. The delivery select names its mode, so it needs no
	 * visible label.
	 *
	 * The options and the actions are two groups. When they no longer share a
	 * row, wrap-reverse keeps the actions on the first row next to the field
	 * and moves the options below them, so sending never drops to the bottom.
	 * The footer is a size container, so the context meter shortens its label
	 * when the options alone would need a second row. It is also the overlay
	 * anchor, so a picker list or error that opens upward clears the actions.
	 */
	.session-composer__footer {
		container-type: inline-size;
		display: flex;
		flex-wrap: wrap-reverse;
		align-items: center;
		gap: var(--pau-space-2);
		padding: var(--pau-space-2);
		border-top: 1px solid var(--pau-border);
		font-size: var(--pau-type-xs);
	}

	.session-composer__options {
		display: flex;
		flex: 1 1 auto;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--pau-space-2);
		min-width: 0;
	}

	/*
	 * The footer pickers keep the footer's meta size and a 4px inset, so the
	 * options still share one row with the actions in today's composer
	 * column. They keep the shared 32px height.
	 */
	.session-composer__options :global(.pau-field--quiet) {
		padding-inline: var(--pau-space-1);
		font-size: inherit;
	}

	/* Svelte leaves whitespace and anchors behind, so :empty never matches. */
	.session-composer__options:not(:has(*)) {
		display: none;
	}

	.session-composer__actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: end;
		gap: var(--pau-space-2);
		margin-left: auto;
		font-size: var(--pau-type-md);
	}

	.session-composer kbd {
		color: inherit;
		font: inherit;
		font-size: var(--pau-type-xs);
		opacity: 0.75;
	}

	.session-composer__hint {
		margin: 0;
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--pau-text-muted);
		border-top: 1px solid var(--pau-border);
		font-size: var(--pau-type-sm);
	}

	.session-composer__error {
		margin: 0;
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--pau-danger);
		border-top: 1px solid var(--pau-border);
	}

	@media (max-width: 40rem) {
		.session-view__header {
			align-items: start;
		}
	}

	@media (pointer: coarse) {
		.session-thinking summary {
			min-height: var(--pau-size-target-touch);
		}
	}
</style>
