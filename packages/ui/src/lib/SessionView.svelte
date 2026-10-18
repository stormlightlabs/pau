<script lang="ts">
	import '../styles/tokens.css';
	import { onDestroy, tick, untrack } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { fade } from 'svelte/transition';
	import ApplicationShell, { type ShellNavItem, type ShellPaneWidths } from './ApplicationShell.svelte';
	import {
		historyLimit,
		idleHistoryCursor,
		navigateHistory,
		recordPrompt,
		type HistoryCursor
	} from './composer-history';
	import { encodeImage, imageAccept, imageRejection, type ComposerImage, type PromptImage } from './composer-images';
	import { announcementSnapshot, describeChanges, type AnnouncementSnapshot } from './transcript-announcements';
	import { copyText, findMessage, lastAssistantReply, type CopyResult } from './clipboard';
	import CopyButton from './CopyButton.svelte';
	import SessionStatusMark from './SessionStatusMark.svelte';
	import CommandCompletion from './CommandCompletion.svelte';
	import { commandName, commandQuery, filterCommands } from './command-completion';
	import ExtensionUi from './ExtensionUi.svelte';
	import { insertMention, mentionAt } from './file-mention';
	import MentionCompletion from './MentionCompletion.svelte';
	import { settlePendingPrompts, userMessageIds, type PendingPrompt } from './pending-prompts';
	import Icon from './Icon.svelte';
	import { useKeyActions } from './keymap.svelte';
	import Markdown from './Markdown.svelte';
	import { isReducedMotion, motion } from '../motion';
	import ModelPicker from './ModelPicker.svelte';
	import ContextMeter from './ContextMeter.svelte';
	import ThinkingLevelPicker from './ThinkingLevelPicker.svelte';
	import SessionPicker from './SessionPicker.svelte';
	import SessionResourceSummary from './SessionResourceSummary.svelte';
	import SessionTree from './SessionTree.svelte';
	import { followTranscript, scrollToLatest as scrollTranscriptToLatest } from './transcript-follow';
	import ToolCallView from './ToolCallView.svelte';
	import TranscriptSearch from './TranscriptSearch.svelte';
	import type { ProcessResourceSnapshot } from './types/resource-monitoring';
	import type {
		CommandOption,
		CompactionReason,
		FileMention,
		ExtensionUiResponse,
		ExtensionUiState,
		ModelOption,
		MessageQueue,
		ThinkingLevel,
		PromptQueue,
		SandboxDenial,
		SavedSessionList,
		SessionBranchOutcome,
		SessionSearchHit,
		SessionSearchOutcome,
		SessionTreeSnapshot,
		SessionViewModel,
		SessionWorkspace,
		TranscriptCompaction,
		TranscriptTool
	} from './types/session';

	type Props = {
		workspaces: SessionWorkspace[];
		activeSessionId?: string;
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
		 * search failed. Without it, `@` does not open completion.
		 */
		onSearchFiles?: (workspaceId: string, query: string) => Promise<FileMention[]>;
		onInterrupt?: (sessionId: string) => void | Promise<void>;
		onStop?: (sessionId: string) => void | Promise<void>;
		/** Re-sends the last prompt after a failed turn. A rejected promise shows its message beside the control. */
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
		 * Starts a session in a workspace. When set, the rail offers a start
		 * control for each workspace. A rejected promise shows its message as a
		 * failed start.
		 */
		onStartSession?: (workspaceId: string) => void | Promise<void>;
		/**
		 * Lists a workspace's saved sessions. With `onResumeSession`, the rail
		 * offers a session picker for each workspace.
		 */
		onLoadSavedSessions?: (workspaceId: string) => Promise<SavedSessionList>;
		/** Resumes a saved session. A rejected promise shows its message in the picker. */
		onResumeSession?: (workspaceId: string, savedSessionId: string) => void | Promise<void>;
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
		 * Lists the models a session can use. With `onSelectModel`, the session
		 * header offers a model picker. A rejected promise shows its message.
		 */
		onLoadModels?: (sessionId: string) => Promise<ModelOption[]>;
		/** Switches a session's model. A rejected promise shows its message in the picker. */
		onSelectModel?: (sessionId: string, model: ModelOption) => void | Promise<void>;
		/**
		 * Sets a session's thinking level. With the model picker, the session header
		 * offers a level control. A rejected promise shows its message beside it.
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
		disconnected = false,
		loading = false,
		onSelectSession = () => {},
		onClearAttention = () => {},
		onSend = () => {},
		onLoadHistory,
		onLoadCommands,
		onSearchFiles,
		onInterrupt = () => {},
		onStop = () => {},
		onRetry = () => {},
		onCompact,
		onClearQueue,
		onCancelRetry = () => {},
		onStartSession,
		onLoadSavedSessions,
		onResumeSession,
		onLoadSessionTree,
		onSearchSession,
		onBranchSession,
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
		paneWidths,
		onPaneResize,
		following = $bindable(true)
	}: Props = $props();

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
	/** Tool rows the operator opened or closed, keyed by tool call ID. */
	const toolDisclosures = new SvelteMap<string, boolean>();
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
	let transcriptSearch = $state<TranscriptSearch>();
	let searchOpen = $state(false);
	/** The entry the last search selection brought into view. */
	let foundEntryKey = $state<string>();
	let foundTimer: ReturnType<typeof setTimeout> | undefined;
	let imagePicker = $state<HTMLInputElement>();
	let images = $state<ComposerImage[]>([]);
	let imageError = $state<string>();
	let draggingImages = $state(false);
	let startingWorkspaceId = $state<string>();
	let startFailure = $state<{ workspaceId: string; workspaceName: string; message: string }>();
	let controlError = $state<string>();
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
	const activeWorkspace = $derived(
		workspaces.find((workspace) => workspace.sessions.some((session) => session.id === activeSessionId))
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
	const commandMatches = $derived.by(() => {
		const query = commandQuery(draft);
		return sessionCommands && draftTyped && query !== undefined && dismissedDraft !== draft
			? filterCommands(sessionCommands, query)
			: undefined;
	});
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
		return sessionCommands !== undefined &&
			name !== undefined &&
			commandQuery(draft) === undefined &&
			sessionCommands.every((command) => command.name !== name)
			? name
			: undefined;
	});

	const canRetry = $derived(
		Boolean(activeSession?.capabilities.retry) && activeSession?.status === 'idle' && !disconnected
	);
	/** Only the failure that ended the transcript can be retried. */
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
	const canCompact = $derived(Boolean(activeSession?.capabilities.compaction) && onCompact !== undefined);
	const compactionState = $derived(activeSession?.compaction);
	const compacting = $derived(
		compactionState?.status === 'running' ||
			(compactingSessionId !== undefined && compactingSessionId === activeSession?.id)
	);
	const composerUnavailable = $derived(composerUnavailableReason(activeSession, disconnected, compacting));
	const productItems = $derived(
		appProductItems.map((item) =>
			item.id === 'sessions' ? { ...item, attention: sessions.some((session) => hasAttention(session)) } : item
		)
	);

	/** Runs one file search and keeps the result only while it is the latest. */
	async function searchMentions(
		search: NonNullable<typeof onSearchFiles>,
		workspaceId: string,
		query: string
	): Promise<void> {
		const run = mentionRun;
		try {
			const files = await search(workspaceId, query);
			if (run !== mentionRun) return;
			mentionResults = files;
			mentionFailed = false;
			mentionSelected = 0;
		} catch {
			if (run !== mentionRun) return;
			mentionResults = [];
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
		const timer = setTimeout(() => void searchMentions(search, workspaceId, query), mentionDebounceMs);
		return () => clearTimeout(timer);
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

	function statusLabel(status: SessionViewModel['status']): string {
		return {
			starting: 'Starting',
			idle: 'Ready',
			running: 'Running',
			waiting: 'Needs you',
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
		else searchOpen = true;
	}

	function closeSearch(): void {
		searchOpen = false;
		composer?.focus();
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
			const first = workspaces.find((workspace) => workspace.id === workspaceId)?.sessions[0];
			if (first) selectSession(first.id);
			else openedWorkspaceId = workspaceId;
		} catch (cause) {
			openError = cause instanceof Error ? cause.message : 'Pau could not open that folder.';
		} finally {
			opening = false;
		}
	}

	function closeOpenForm(): void {
		openFormVisible = false;
		openError = undefined;
	}

	async function startSession(workspace: SessionWorkspace): Promise<void> {
		if (!onStartSession || startingWorkspaceId) return;
		startingWorkspaceId = workspace.id;
		startFailure = undefined;
		openedWorkspaceId = undefined;
		closeOpenForm();
		try {
			await onStartSession(workspace.id);
		} catch (cause) {
			startFailure = {
				workspaceId: workspace.id,
				workspaceName: workspace.name,
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

	function selectSession(sessionId: string): void {
		pickerWorkspaceId = undefined;
		openedWorkspaceId = undefined;
		closeOpenForm();
		startFailure = undefined;
		controlError = undefined;
		queueError = undefined;
		error = undefined;
		draft = '';
		draftTyped = false;
		historyCursor = idleHistoryCursor;
		onSelectSession(sessionId);
	}

	function moveSession(sessionId: string, offset: number): void {
		const index = sessions.findIndex((session) => session.id === sessionId);
		if (index === -1) return;
		const next = sessions[(index + offset + sessions.length) % sessions.length];
		if (next) selectSession(next.id);
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
		'composer.focus': () => composer?.focus()
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

	function hasFiles(event: DragEvent): boolean {
		return event.dataTransfer?.types.includes('Files') ?? false;
	}

	function handleImageDrop(event: DragEvent): void {
		if (!hasFiles(event)) return;
		event.preventDefault();
		draggingImages = false;
		if (composerUnavailable === undefined) attachImages(event.dataTransfer?.files ?? []);
	}

	function handleComposerPaste(event: ClipboardEvent): void {
		const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'));
		if (files.length === 0) return;
		event.preventDefault();
		attachImages(files);
	}

	/**
	 * Sends the draft. The composer clears and the prompt shows as pending
	 * before the backend answers. A refused prompt stays in view marked as not
	 * sent, and its text and images return to the composer when the operator
	 * has not moved to another session.
	 */
	async function submitPrompt(): Promise<void> {
		if (sending || !activeSession || !draft.trim()) return;
		const session = activeSession;
		const text = draft.trim();
		const queueTarget = session.status === 'running' ? activeQueue : undefined;
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

	function markPending(id: string, state: PendingPrompt['state']): void {
		pendingPrompts = pendingPrompts.map((prompt) => (prompt.id === id ? { ...prompt, state } : prompt));
	}

	async function interrupt(): Promise<void> {
		if (disconnected || !activeSession || !activeSession.capabilities.interrupt) return;
		error = undefined;
		try {
			await onInterrupt(activeSession.id);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The session could not be interrupted. Try again.';
		}
	}

	function acceptCommand(command: CommandOption): void {
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
			retryError = cause instanceof Error ? cause.message : 'The turn could not be retried. Try again.';
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
			if (activeSessionId !== sessionId) return;
			draft = [draft.trim() ? draft : '', ...cleared.steering, ...cleared.followUp].filter(Boolean).join('\n\n');
			composer?.focus();
		} catch (cause) {
			queueError = cause instanceof Error ? cause.message : 'The queue could not be cleared. Try again.';
		}
	}

	function handleComposerKeydown(event: KeyboardEvent): void {
		if (commandMatches && handleCommandKeydown(event, commandMatches)) return;
		if (mentionOpen && handleMentionKeydown(event, mentionResults ?? [])) return;
		if (event.key === 'Escape' && !event.shiftKey && activeSession?.status === 'running') {
			event.preventDefault();
			void interrupt();
			return;
		}
		if (activeSession && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
			const field = event.currentTarget as HTMLTextAreaElement;
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
			if (step) {
				event.preventDefault();
				historyCursor = step.cursor;
				draft = step.draft;
				draftTyped = false;
			}
			return;
		}
		if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
		event.preventDefault();
		void submitPrompt();
	}

	/**
	 * Whether a tool row shows its body. An operator choice, from a click or
	 * Ctrl+O, wins. Otherwise a row stays open while it runs, while its turn
	 * runs, and after it fails, so finished output does not collapse under
	 * the reader before the turn ends.
	 */
	function toolOpen(tool: TranscriptTool): boolean {
		return toolDisclosures.get(tool.id) ?? (tool.status !== 'complete' || activeSession?.status === 'running');
	}

	/** Ctrl+O opens every tool row in the session, or closes them all when all are open. */
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
		const next = tools.some((tool) => !toolOpen(tool));
		for (const tool of tools) toolDisclosures.set(tool.id, next);
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
	{paneWidths}
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
			{#if loading}
				<p class="session-rail__empty">Loading…</p>
			{:else if workspaces.length === 0}
				<p class="session-rail__empty">No workspaces yet</p>
			{:else}
				{#each workspaces as workspace (workspace.id)}
					<section aria-labelledby={`workspace-${workspace.id}`}>
						<div class="session-rail__heading">
							<h2 id={`workspace-${workspace.id}`}>{workspace.name}</h2>
							{#if onStartSession}
								<button
									type="button"
									class="session-rail__start"
									aria-label={`Start session in ${workspace.name}`}
									title="Start session"
									disabled={disconnected || startingWorkspaceId !== undefined}
									onclick={() => void startSession(workspace)}>
									<span aria-hidden="true">+</span>
								</button>
							{/if}
							{#if onLoadSavedSessions && onResumeSession}
								<button
									type="button"
									class="session-rail__saved"
									aria-label={`Browse saved sessions in ${workspace.name}`}
									aria-pressed={pickerWorkspaceId === workspace.id}
									title="Saved sessions"
									disabled={disconnected}
									onclick={() => (pickerWorkspaceId = workspace.id)}>Saved</button>
							{/if}
						</div>
						{#if workspace.sessions.length === 0}
							<p class="session-rail__empty">
								{startingWorkspaceId === workspace.id ? 'Starting a session…' : 'No sessions yet'}
							</p>
						{/if}
						<ul>
							{#each workspace.sessions as session (session.id)}
								<li>
									<button
										type="button"
										class:active={session.id === activeSessionId}
										aria-current={session.id === activeSessionId ? 'page' : undefined}
										onclick={() => selectSession(session.id)}
										onkeydown={(event) => {
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
												<span class="session-view__sr-only">{markerLabel[kind]}</span>
											{:else if hasAttention(session)}
												<span class="session-view__sr-only">Attention required</span>
											{/if}
										</span>
									</button>
								</li>
							{/each}
						</ul>
					</section>
				{/each}
			{/if}
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

	{#if pickerWorkspace && onLoadSavedSessions && onResumeSession}
		{#key pickerWorkspace.id}
			<div class="session-view session-view--empty">
				<SessionPicker
					workspaceName={pickerWorkspace.name}
					disabled={disconnected}
					load={() => onLoadSavedSessions(pickerWorkspace.id)}
					onNew={async () => {
						if (!onStartSession) return;
						await onStartSession(pickerWorkspace.id);
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
			<div class="session-view__empty" role="alert">
				<h1 id="start-failed-title">Could not start a session in {startFailure.workspaceName}</h1>
				<p>{startFailure.message}</p>
				{#if onStartSession}
					<button
						type="button"
						class="session-view__retry"
						disabled={disconnected || startingWorkspaceId !== undefined}
						onclick={() => {
							const workspace = workspaces.find((candidate) => candidate.id === startFailure?.workspaceId);
							if (workspace) void startSession(workspace);
						}}>Try again</button>
				{/if}
			</div>
		</section>
	{:else if onOpenWorkspace && (openFormVisible || openError || (!loading && workspaces.length === 0))}
		{@const firstRun = !loading && workspaces.length === 0}
		<section class="session-view session-view--empty" aria-labelledby="open-workspace-title">
			<div class="session-view__empty">
				<h1 id="open-workspace-title">{firstRun ? 'Open a folder to start working' : 'Open a workspace'}</h1>
				<p>Pau runs each session inside a workspace folder. Open a project folder to add it to the rail.</p>
				{#if pickFolder}
					<button
						type="button"
						class="session-view__retry"
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
								class="session-view__retry"
								disabled={disconnected || opening || openPath.trim() === ''}>{opening ? 'Opening…' : 'Open'}</button>
							{#if !firstRun}
								<button type="button" class="session-view__retry" onclick={closeOpenForm}>Cancel</button>
							{/if}
						</div>
					</form>
				{/if}
				{#if openError}<p class="session-open__error" role="alert">{openError}</p>{/if}
			</div>
		</section>
	{:else if openedWorkspace && openedWorkspace.sessions.length === 0}
		<section class="session-view session-view--empty" aria-labelledby="opened-workspace-title">
			<div class="session-view__empty" role="status">
				<h1 id="opened-workspace-title">{openedWorkspace.name} is open</h1>
				<p>It has no sessions yet.</p>
				{#if onStartSession}
					<button
						type="button"
						class="session-view__retry"
						disabled={disconnected || startingWorkspaceId !== undefined}
						onclick={() => void startSession(openedWorkspace)}>Start session</button>
				{/if}
			</div>
		</section>
	{:else if loading && !activeSession}
		<section class="session-view session-view--empty" aria-labelledby="loading-title">
			<div class="session-view__empty" role="status">
				<h1 id="loading-title">Loading sessions…</h1>
			</div>
		</section>
	{:else if activeSession}
		<section class="session-view" aria-labelledby="session-title">
			<header class="session-view__header">
				<div>
					<p>
						{activeSession.agent}{activeSession.model && !(onLoadModels && onSelectModel)
							? ` · ${activeSession.model}`
							: ''}
					</p>
					<h1 id="session-title">{activeSession.title}</h1>
				</div>
				<div class="session-view__header-actions">
					{#if onLoadModels && onSelectModel}
						{#key activeSession.id}
							<ModelPicker
								load={() => onLoadModels(activeSession.id)}
								onSelect={(model) => onSelectModel(activeSession.id, model)}
								supported={activeSession.capabilities.modelSelection ?? false}
								unavailableReason={modelUnavailableReason(activeSession, disconnected)}
								fallbackLabel={activeSession.model}
								onLoaded={(models) => (currentModelReasoning = models.find((model) => model.current)?.reasoning)} />
							{#if onSelectThinkingLevel}
								<ThinkingLevelPicker
									level={activeSession.thinkingLevel}
									onSelect={(level) => onSelectThinkingLevel(activeSession.id, level)}
									supported={activeSession.capabilities.thinkingLevel ?? false}
									reasoning={currentModelReasoning}
									unavailableReason={thinkingUnavailableReason(activeSession, disconnected)} />
							{/if}
						{/key}
					{/if}
					<ContextMeter usage={activeSession.usage} supported={activeSession.capabilities.usage ?? false} />
					{#if canCompact}
						{@const compactReason = compactUnavailableReason(activeSession, disconnected, compacting)}
						<div class="session-compact">
							<button
								type="button"
								class="session-view__stop"
								aria-expanded={compactOpen}
								aria-controls="compact-panel"
								disabled={compactReason !== undefined}
								title={compactReason}
								onclick={() => (compactOpen = !compactOpen)}>
								{compacting ? 'Compacting…' : 'Compact'}
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
										<button type="button" class="session-view__stop" onclick={() => (compactOpen = false)}>
											Cancel
										</button>
										<button type="submit" class="session-view__stop">Compact now</button>
									</div>
								</form>
							{/if}
						</div>
					{/if}
					<div class={`session-view__status session-view__status--${activeSession.status}`}>
						<SessionStatusMark status={activeSession.status} label={statusLabel(activeSession.status)} />
						<span aria-hidden="true">{statusLabel(activeSession.status)}</span>
					</div>
					{#if activeSession.capabilities.stop && ['idle', 'running', 'waiting'].includes(activeSession.status)}
						<button type="button" class="session-view__stop" disabled={disconnected} onclick={() => void stop()}>
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

				{#if activeSession.status === 'starting'}
					<p class="session-view__notice" role="status">Starting the agent process…</p>
				{:else if activeSession.status === 'waiting'}
					<p class="session-view__notice session-view__notice--attention" role="alert">
						<strong>Attention required.</strong>
						{activeSession.attention ?? 'The agent is waiting for your response.'}
					</p>
				{:else if activeSession.status === 'failed'}
					<p class="session-view__notice session-view__notice--failed" role="alert">
						<strong>Session failed.</strong>
						{activeSession.error ?? 'Open the diagnostics and start a new session.'}
					</p>
				{:else if activeSession.status === 'stopped'}
					<p class="session-view__notice" role="status">This session has stopped. Its transcript remains available.</p>
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
								class="session-view__retry"
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
						<div class="session-view__empty">
							<h2>Start with a prompt</h2>
							<p>Describe the task, relevant files, and any limits the agent should follow.</p>
						</div>
					{:else}
						{#each activeSession.transcript as entry (entry.id)}
							{#if entry.kind === 'message'}
								<article
									class={`session-message session-message--${entry.role}`}
									aria-label={`${entry.role} message`}
									data-entry-id={entry.id}
									data-found={entry.id === foundEntryKey || undefined}>
									<h2>{entry.label ?? (entry.role === 'user' ? 'You' : activeSession.agent)}</h2>
									<CopyButton
										class="session-message__copy"
										text={entry.body}
										label={entry.role === 'user' ? 'Copy your message' : 'Copy reply'}
										onResult={announceCopy} />
									{#if entry.role === 'assistant'}
										<Markdown text={entry.body} />
									{:else}
										<p>{entry.body}</p>
									{/if}
									{#if canRetry && entry.id === retryableEntryId}
										<button
											type="button"
											class="session-view__retry session-message__retry"
											disabled={retrying}
											onclick={() => void retry()}>
											{retrying ? 'Retrying…' : 'Retry'}
										</button>
									{/if}
								</article>
							{:else if entry.kind === 'thinking'}
								<details
									class="session-thinking"
									open={!entry.complete}
									data-entry-id={entry.id}
									data-found={entry.id === foundEntryKey || undefined}>
									<summary>{entry.complete ? 'Thinking' : 'Thinking…'}</summary>
									<p>{entry.body}</p>
								</details>
							{:else if entry.kind === 'tool'}
								<ToolCallView
									tool={entry}
									open={toolOpen(entry)}
									found={entry.id === foundEntryKey}
									onToggle={(open) => toolDisclosures.set(entry.id, open)} />
							{:else if entry.kind === 'compaction'}
								<details
									class="session-compaction"
									aria-label="Compacted context"
									data-entry-id={entry.id}
									data-found={entry.id === foundEntryKey || undefined}>
									<summary>
										<span>Context compacted{entry.reason === 'manual' ? '' : ' automatically'}</span>
										{#if compactionSizes(entry)}<small>{compactionSizes(entry)}</small>{/if}
									</summary>
									<p>{entry.summary}</p>
									{#if entry.willRetry}<p>Pi resends your last message next.</p>{/if}
								</details>
							{:else}
								<article class="session-denial" aria-label="Sandbox denial">
									<div>
										<p class="session-denial__label">Sandbox denial</p>
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

			<p class="session-view__sr-only session-view__announcer" role="status">{announcement}</p>
			{#if arrived}
				<!-- Mouse down must not move focus out of the composer. -->
				<button
					type="button"
					class="session-view__jump"
					title="Jump to latest (Ctrl+End)"
					onmousedown={(event) => event.preventDefault()}
					onclick={scrollToLatest}
					transition:fade={{ duration: isReducedMotion() ? 0 : motion.duration.small }}>
					<Icon name="chevronDown" size={14} />
					<span>Jump to latest</span>
					{#if newEntries > 0}<small>{newEntries} new</small>{/if}
				</button>
			{/if}

			<div class="session-view__composer-stack">
				{#if queuedCount > 0 || pendingQueue.length > 0}
					<section class="session-queue" aria-label="Queued messages">
						<header>
							<h2>Queued <span>{queuedCount + pendingQueue.length}</span></h2>
							{#if queuedCount > 0}
								<button
									type="button"
									class="session-queue__clear"
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
					<form
						class="session-composer"
						class:session-composer--dragging={draggingImages}
						aria-label="Prompt composer"
						ondragover={(event) => {
							if (!hasFiles(event)) return;
							event.preventDefault();
							draggingImages = true;
						}}
						ondragleave={() => (draggingImages = false)}
						ondrop={handleImageDrop}
						onsubmit={(event) => {
							event.preventDefault();
							void submitPrompt();
						}}>
						{#if activeSession.status === 'running' && canQueue}
							<label class="session-composer__queue">
								<span>Send as</span>
								<select value={activeQueue} onchange={(event) => (queue = event.currentTarget.value as PromptQueue)}>
									{#if activeSession.capabilities.steer}<option value="steer">Steer now</option>{/if}
									{#if activeSession.capabilities.followUp}<option value="follow-up">Follow up</option>{/if}
								</select>
							</label>
						{/if}
						{#if images.length > 0}
							<ul class="session-composer__images" aria-label="Attached images">
								{#each images as image (image.id)}
									<li>
										<img src={image.previewUrl} alt={image.name} />
										<button type="button" aria-label={`Remove ${image.name}`} onclick={() => removeImage(image.id)}>
											Remove
										</button>
									</li>
								{/each}
							</ul>
						{/if}
						{#if commandMatches}
							<div class="session-composer__commands">
								<CommandCompletion
									id={commandListId}
									commands={commandMatches}
									selected={commandSelected}
									onAccept={acceptCommand} />
							</div>
						{/if}
						{#if mentionOpen}
							<div class="session-composer__commands">
								<MentionCompletion
									id={mentionListId}
									files={mentionResults ?? []}
									selected={mentionSelected}
									failed={mentionFailed}
									onAccept={acceptMention} />
							</div>
						{/if}
						<label class="session-composer__field">
							<span class="session-view__sr-only">Prompt</span>
							<Icon name="chevronRight" class="session-composer__prompt" />
							<textarea
								bind:this={composer}
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
								aria-autocomplete={commandMatches || mentionOpen ? 'list' : undefined}
								aria-controls={activeOption?.list}
								aria-activedescendant={activeOption ? `${activeOption.list}-option-${activeOption.index}` : undefined}
								placeholder={activeSession.status === 'running'
									? 'Add direction or queue a follow-up'
									: 'Message the agent'}
								aria-describedby={composerUnavailable ? 'composer-unavailable' : undefined}
								disabled={composerUnavailable !== undefined}></textarea>
						</label>
						<div class="session-composer__actions">
							<input
								bind:this={imagePicker}
								class="session-view__sr-only"
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
								class="session-composer__attach"
								disabled={composerUnavailable !== undefined}
								onclick={() => imagePicker?.click()}>
								Attach image
							</button>
							{#if activeSession.status === 'running' && activeSession.capabilities.interrupt}
								<button
									type="button"
									class="session-composer__interrupt"
									disabled={disconnected}
									onclick={() => void interrupt()}>
									Interrupt <kbd>Esc</kbd>
								</button>
							{/if}
							<button type="submit" disabled={!draft.trim() || sending || composerUnavailable !== undefined}>
								{sending
									? 'Sending…'
									: activeQueue === 'follow-up' && activeSession.status === 'running'
										? 'Queue prompt'
										: 'Send prompt'}
								<kbd>⌘↵</kbd>
							</button>
						</div>
						{#if unknownCommand !== undefined}
							<p class="session-composer__hint">Not a known command. It will be sent as written.</p>
						{/if}
						{#if composerUnavailable}
							<p id="composer-unavailable" class="session-composer__hint">{composerUnavailable}</p>
						{/if}
						{#if imageError || error}
							<p class="session-composer__error" role="alert">{[imageError, error].filter(Boolean).join(' ')}</p>
						{/if}
					</form>
				</ExtensionUi>
			</div>
		</section>
	{:else}
		<section class="session-view session-view--empty" aria-labelledby="empty-title">
			<div class="session-view__empty">
				<h1 id="empty-title">No session selected</h1>
				<p>
					{onStartSession
						? 'Select a session from the rail, or start one with the + button next to a workspace.'
						: 'Select a session from the rail, or start one in this workspace.'}
				</p>
			</div>
		</section>
	{/if}
</ApplicationShell>

<style>
	.session-rail {
		padding: 0 var(--pau-space-2) var(--pau-space-4);
	}

	.session-rail__heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.session-rail .session-rail__start {
		display: grid;
		place-items: center;
		width: 2rem;
		min-height: var(--pau-size-row-md);
		grid-template-columns: 1fr;
		padding: 0;
		color: var(--pau-text-muted);
		font-size: var(--pau-type-lg);
		text-align: center;
	}

	.session-rail .session-rail__saved {
		width: auto;
		min-height: var(--pau-size-row-md);
		padding: 0 var(--pau-space-2);
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}

	.session-rail .session-rail__start:disabled,
	.session-rail .session-rail__saved:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.session-rail section + section {
		margin-top: var(--pau-space-4);
	}

	.session-rail h2 {
		margin: 0;
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.session-rail ul {
		display: grid;
		gap: var(--pau-space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.session-rail button {
		display: grid;
		grid-template-columns: 0.5rem minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--pau-space-2);
		width: 100%;
		min-height: var(--pau-size-target-touch);
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--pau-text-muted);
		background: transparent;
		border: 0;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.session-rail button:hover,
	.session-rail button.active {
		color: var(--pau-text);
		background: var(--pau-surface-raised);
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
		/* One pulse draws the eye when the marker appears, then it holds still. */
		animation: session-rail-marker-pulse var(--pau-duration-large) var(--pau-ease-standard) 1;
	}

	.session-rail__marker--waiting {
		background: var(--pau-warning);
	}

	.session-rail__marker--failed {
		background: var(--pau-danger);
	}

	@keyframes session-rail-marker-pulse {
		50% {
			transform: scale(1.8);
		}
	}

	:global(:root[data-motion='reduce']) .session-rail__marker {
		animation: none;
	}

	@media (prefers-reduced-motion: reduce) {
		:global(:root:not([data-motion])) .session-rail__marker {
			animation: none;
		}
	}

	.session-rail small {
		color: inherit;
		font-size: var(--pau-type-xs);
	}

	.session-rail .session-rail__open {
		grid-template-columns: auto minmax(0, 1fr);
		margin-bottom: var(--pau-space-2);
		color: var(--pau-text);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
	}

	.session-rail .session-rail__open:disabled {
		color: var(--pau-text-muted);
		cursor: not-allowed;
	}

	.session-open {
		display: grid;
		gap: var(--pau-space-3);
		margin-top: var(--pau-space-4);
		text-align: left;
	}

	.session-open label {
		display: grid;
		gap: var(--pau-space-1);
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
	}

	.session-open input {
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-3);
		color: var(--pau-text);
		background: var(--pau-surface);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		font: inherit;
		font-family: var(--pau-font-code);
	}

	.session-open__actions {
		display: flex;
		gap: var(--pau-space-2);
	}

	.session-open__actions .session-view__retry {
		margin-top: 0;
	}

	.session-view__empty .session-open__error {
		margin-top: var(--pau-space-3);
		color: var(--pau-danger);
	}

	.session-rail__empty {
		margin: 0;
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--pau-text-muted);
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
		max-width: 58rem;
		margin-inline: auto;
	}

	.session-view--empty {
		place-items: center;
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
	.session-view__notice,
	.session-view__empty h1,
	.session-view__empty h2,
	.session-view__empty p {
		margin: 0;
	}

	.session-view__header p,
	.session-message h2 {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
		font-weight: 500;
	}

	.session-view__header h1 {
		margin-top: var(--pau-space-1);
		font-size: var(--pau-type-lg);
		font-weight: 600;
		text-wrap: balance;
	}

	.session-view__header-actions {
		display: flex;
		align-items: center;
		gap: var(--pau-space-3);
		flex: none;
	}

	.session-view__stop,
	.session-view__retry {
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-3);
		color: var(--pau-text);
		background: transparent;
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		font: inherit;
		cursor: pointer;
	}

	.session-view__stop:disabled,
	.session-view__retry:disabled {
		color: var(--pau-text-muted);
		cursor: not-allowed;
	}

	.session-view__retry {
		margin-top: var(--pau-space-4);
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

	.session-view__auto-retry .session-view__retry {
		margin-top: 0;
		flex: none;
	}

	.session-view__status {
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		flex: none;
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
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

	.session-view__sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.session-view__jump {
		grid-area: transcript;
		z-index: 1;
		align-self: end;
		justify-self: center;
		display: inline-flex;
		align-items: center;
		gap: var(--pau-space-2);
		min-height: var(--pau-size-row-md);
		margin-bottom: var(--pau-space-3);
		padding-inline: var(--pau-space-3);
		color: var(--pau-text);
		background: var(--pau-surface);
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
		box-shadow: 0 0.25rem 1rem rgb(0 0 0 / 24%);
		font: inherit;
		cursor: pointer;
	}

	.session-view__jump small {
		color: var(--pau-text-muted);
	}

	.session-view__transcript {
		grid-area: transcript;
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
		animation: session-found 1600ms var(--pau-ease-standard);
	}

	@keyframes session-found {
		from,
		60% {
			background: color-mix(in srgb, var(--pau-accent) 18%, transparent);
		}
	}

	.session-message--user {
		padding-left: var(--pau-space-4);
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
		max-width: 75ch;
		color: var(--pau-text-muted);
	}

	.session-thinking summary {
		min-height: var(--pau-size-row-md);
		cursor: pointer;
	}

	.session-thinking p {
		padding-left: var(--pau-space-4);
		font-size: var(--pau-type-sm);
	}

	.session-compaction {
		max-width: 75ch;
		padding-block: var(--pau-space-1);
		color: var(--pau-text-muted);
		border-block: 1px dashed var(--pau-border);
	}

	.session-compaction summary {
		display: flex;
		align-items: center;
		gap: var(--pau-space-3);
		min-height: var(--pau-size-row-md);
		cursor: pointer;
	}

	.session-compaction small {
		font-size: var(--pau-type-xs);
		font-variant-numeric: tabular-nums;
	}

	.session-compaction p {
		margin: var(--pau-space-2) 0 0;
		padding-left: var(--pau-space-4);
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
		font-size: var(--pau-type-sm);
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
		border: 1px solid var(--pau-border);
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
		max-width: 75ch;
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
		font-weight: 600;
	}

	.session-denial .session-denial__label {
		margin-bottom: var(--pau-space-1);
		color: var(--pau-danger);
		font-size: var(--pau-type-xs);
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.session-denial code {
		max-width: 100%;
		overflow-wrap: anywhere;
		color: var(--pau-text);
		font-family: var(--pau-font-code);
		font-size: var(--pau-type-xs);
	}

	.session-denial > p {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-sm);
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
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
		letter-spacing: 0.06em;
		text-transform: uppercase;
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
		font-size: var(--pau-type-sm);
	}

	.session-queue li strong {
		color: var(--pau-text-muted);
		font-size: var(--pau-type-xs);
		font-weight: 600;
	}

	.session-queue li span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.session-queue__clear {
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-3);
		border-radius: var(--pau-radius-control);
		color: var(--pau-text);
		background: transparent;
		border: 1px solid var(--pau-border);
		font: inherit;
		cursor: pointer;
	}

	.session-queue__clear:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.session-composer {
		display: grid;
		grid-template-areas:
			'queue queue'
			'images images'
			'commands commands'
			'field actions'
			'error error';
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-rows: auto auto;
		background: var(--pau-surface);
		border: 1px solid var(--pau-border);
	}

	.session-composer:focus-within {
		border-color: var(--pau-focus);
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset-inset);
	}

	/* The transcript scrolls, so rings sit inside the control to stay uncut. */
	.session-view :global(button:focus-visible),
	.session-view :global(summary:focus-visible) {
		outline: var(--pau-focus-width) solid var(--pau-focus);
		outline-offset: var(--pau-focus-offset-inset);
	}

	.session-composer--dragging {
		border-color: var(--pau-focus);
		border-style: dashed;
	}

	.session-composer__images {
		grid-area: images;
		display: flex;
		flex-wrap: wrap;
		gap: var(--pau-space-2);
		margin: 0;
		padding: var(--pau-space-2) var(--pau-space-3);
		list-style: none;
		border-bottom: 1px solid var(--pau-border);
	}

	.session-composer__images li {
		display: grid;
		gap: var(--pau-space-1);
		justify-items: start;
	}

	.session-composer__images img {
		width: 4rem;
		height: 4rem;
		object-fit: cover;
		border: 1px solid var(--pau-border);
		border-radius: var(--pau-radius-control);
	}

	.session-composer__images button {
		padding: 0;
		color: var(--pau-text-muted);
		background: none;
		border: 0;
		font: inherit;
		font-size: var(--pau-type-xs);
		text-decoration: underline;
		cursor: pointer;
	}

	.session-composer__queue {
		grid-area: queue;
		display: flex;
		align-items: center;
		gap: var(--pau-space-2);
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--pau-text-muted);
		background: var(--pau-canvas);
		border-bottom: 1px solid var(--pau-border);
		font-size: var(--pau-type-xs);
	}

	.session-composer__queue select {
		color: var(--pau-text);
		background: transparent;
		border: 0;
		font: inherit;
	}

	.session-composer__commands {
		grid-area: commands;
		border-bottom: 1px solid var(--pau-border);
	}

	.session-composer__commands :global(.command-completion) {
		border: 0;
	}

	.session-composer__field {
		grid-area: field;
		display: flex;
		align-items: start;
		min-width: 0;
	}

	.session-composer__field :global(.session-composer__prompt) {
		flex: none;
		margin: var(--pau-space-3) 0 0 var(--pau-space-3);
		color: var(--pau-accent);
		font-size: var(--pau-type-lg);
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

	.session-composer__actions {
		grid-area: actions;
		display: flex;
		align-items: end;
		gap: var(--pau-space-2);
		padding: var(--pau-space-2);
	}

	.session-composer__actions button {
		min-height: var(--pau-size-row-md);
		padding-inline: var(--pau-space-3);
		color: var(--pau-canvas);
		background: var(--pau-accent);
		border: 0;
		border-radius: var(--pau-radius-control);
		font: inherit;
		font-weight: 650;
		cursor: pointer;
	}

	.session-composer__actions button:disabled {
		color: var(--pau-text-muted);
		background: var(--pau-surface-raised);
		cursor: not-allowed;
	}

	.session-composer__actions .session-composer__attach {
		color: var(--pau-text);
		background: var(--pau-surface-raised);
		border: 1px solid var(--pau-border);
	}

	.session-composer__actions .session-composer__interrupt {
		color: var(--pau-text);
		background: transparent;
		border: 1px solid var(--pau-border);
		font-weight: 500;
	}

	.session-composer kbd {
		margin-left: var(--pau-space-1);
		color: inherit;
		font: inherit;
		font-size: var(--pau-type-xs);
		opacity: 0.75;
	}

	.session-composer__hint {
		grid-column: 1 / -1;
		margin: 0;
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--pau-text-muted);
		border-top: 1px solid var(--pau-border);
		font-size: var(--pau-type-sm);
	}

	.session-composer__error {
		grid-area: error;
		margin: 0;
		padding: var(--pau-space-2) var(--pau-space-3);
		color: var(--pau-danger);
		border-top: 1px solid var(--pau-border);
	}

	.session-view__empty {
		grid-area: transcript;
		align-self: center;
		max-width: 30rem;
		margin: auto;
		padding: 3rem var(--pau-space-4);
		text-align: center;
	}

	.session-view__empty h1,
	.session-view__empty h2 {
		font-size: var(--pau-type-lg);
	}

	.session-view__empty p {
		margin-top: var(--pau-space-2);
		color: var(--pau-text-muted);
		line-height: 1.55;
	}

	.session-view__sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	@media (max-width: 40rem) {
		.session-view__header {
			align-items: start;
		}

		.session-composer {
			grid-template-areas:
				'queue'
				'field'
				'actions'
				'error';
			grid-template-columns: 1fr;
		}

		.session-composer__actions {
			grid-template-columns: 1fr;
		}

		.session-composer__actions {
			align-items: stretch;
		}
	}

	@media (pointer: coarse) {
		.session-thinking summary,
		.session-view__stop,
		.session-view__retry,
		.session-composer__actions button {
			min-height: var(--pau-size-target-touch);
		}
	}
</style>
