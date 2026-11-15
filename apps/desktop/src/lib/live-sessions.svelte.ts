import type { AgentSession, ServerEvent, Workspace } from '@stormlightlabs/pau-protocol';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type {
	ExtensionUiResponse,
	CommandOption,
	MessageQueue,
	ModelOption,
	PromptImage,
	PromptQueue,
	SavedSessionList,
	SessionAgent,
	SessionBranchOutcome,
	SessionSearchOutcome,
	SessionTreeSnapshot,
	SessionUsage,
	SessionViewModel,
	SessionWorkspace,
	ThinkingLevel
} from '@stormlightlabs/pau-ui';
import { agentLabel } from '@stormlightlabs/pau-ui';

import {
	PauApiError,
	branchSession,
	cancelSessionRetry,
	cloneSession,
	compactSession,
	clearSessionQueue,
	getSessionExtensionUi,
	getSessionTree,
	searchSession,
	getSessionHistory,
	getSessionMessages,
	getSessionQueue,
	getSessionUsage,
	getWorkspaceGitStatus,
	interruptSession,
	listNativeSessions,
	listSessionCommands,
	listSessionModels,
	listSessions,
	listWorkspaces,
	openWorkspace,
	promptSession,
	queueSessionMessage,
	renameSession,
	respondToExtensionUi,
	retrySession,
	runSessionShellCommand,
	selectSessionModel,
	setSessionThinkingLevel,
	startSession,
	stopSession,
	stopSessionShellCommands
} from './api';
import {
	emptyExtensionUi,
	exitedExtensionUi,
	extensionUiView,
	isExtensionEvent,
	opensDialog,
	reduceExtensionEvent,
	resolveDialog,
	withServerExtensionUi,
	withoutDialog,
	withoutNotification,
	type LiveExtensionUi
} from './extension-ui';
import { reduceClaudeEvent, withClaudePrompt } from './claude-transcript';
import { EventStreamClient, type EventSocketFactory, type EventStreamState } from './event-stream';
import {
	emptyPiTranscript,
	findTranscriptEntry,
	piTranscriptFromMessages,
	queueFromEvent,
	reducePiEvent,
	type PiTranscript
} from './pi-transcript';
import { usageFromEvent, viewUsage } from './session-usage';

/** Most matches one transcript search asks for. */
const SEARCH_LIMIT = 50;

/** Transport hooks for {@link LiveSessions}. Tests replace both. */
export type LiveSessionsOptions = {
	browserOrigin: string;
	fetcher?: typeof fetch;
	socketFactory?: EventSocketFactory;
	/** Runs `flush` once on the next animation frame. Tests replace it to flush by hand. */
	scheduleFrame?: (flush: () => void) => void;
};

/** Defers to the next animation frame, or a timer where there is no display. */
function nextFrame(flush: () => void): void {
	if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => flush());
	else setTimeout(flush, 16);
}

const TITLE_LENGTH = 60;

/** How long an extension notification stays on screen. */
const NOTIFICATION_MS = 8000;

/**
 * Turns an API failure into copy for the operator. Starting and controlling a
 * session share most codes, but `not_found` names a different missing thing.
 * The copy for most codes names Pi; a Claude Code session's refusals keep the
 * backend's own message instead.
 */
export function sessionErrorMessage(
	cause: unknown,
	action: 'start' | 'control' | 'resume' | 'retry' | 'branch' | 'compact',
	agent: SessionAgent = 'pi'
): string {
	if (!(cause instanceof PauApiError)) {
		return 'Pau could not reach its backend. Check that the desktop app is still running, then try again.';
	}
	if (agent === 'claude' && cause.code === 'image_input_unsupported') return cause.message;
	if (agent === 'claude' && cause.code === 'control_rejected') {
		return `Claude Code rejected the request: ${cause.message}`;
	}
	if (action === 'branch' && cause.code === 'invalid_session_state') {
		return 'Pi is busy. Wait for the current run to finish, then branch again.';
	}
	if (action === 'branch' && cause.code === 'control_rejected') {
		return `Pi could not branch from that message: ${cause.message}`;
	}
	switch (cause.code) {
		case 'pi_unavailable': {
			return 'Pau could not find a working Pi installation. Install Pi or add it to your PATH, then try again.';
		}
		case 'sandboxed_session_unsupported': {
			return 'This workspace uses a sandbox, and sandboxed sessions cannot start from the desktop yet. Turn off the sandbox in the workspace settings to start a session.';
		}
		case 'native_session_not_found': {
			return 'Pi no longer has that saved session. It may have been deleted. Pick another session or start a new one.';
		}
		case 'invalid_native_session': {
			return 'Pi could not read that saved session, so it cannot be resumed. Pick another session or start a new one.';
		}
		case 'not_found': {
			return action !== 'control'
				? 'This workspace is no longer registered with Pau.'
				: 'This session has ended. Start a new session to continue.';
		}
		case 'session_exited': {
			return 'This session has ended. Start a new session to continue.';
		}
		case 'unsupported_control': {
			return 'This session does not support that action.';
		}
		case 'invalid_session_state': {
			return 'The session changed state before Pau could send that. If it is running, wait for the run to finish, then try again.';
		}
		case 'control_rejected': {
			if (action === 'retry') return 'The last reply did not fail, so there is nothing to send again.';
			if (action === 'compact') return `Pi could not compact this session: ${cause.message}`;
			return `Pi rejected the request: ${cause.message}`;
		}
		case 'invalid_extension_response': {
			return `The extension could not use that answer. ${cause.message}`;
		}
		case 'unsupported_image_type': {
			return 'Pi accepts PNG, JPEG, GIF, and WebP images. Remove the other files and send again.';
		}
		case 'invalid_image_data': {
			return 'Pau could not read one of the attached images. Remove it and attach it again.';
		}
		case 'image_too_large': {
			return 'An attached image is larger than 5 MiB. Remove it or attach a smaller one.';
		}
		case 'request_images_too_large': {
			return 'The attached images add up to more than 10 MiB. Remove some and send again.';
		}
		case 'image_input_unsupported': {
			return 'The current model cannot read images. Switch to a model with image input, or remove the images and send again.';
		}
		case 'invalid_agent_response': {
			return 'Pi sent a response Pau could not read. Open Diagnostics for details.';
		}
		default: {
			return cause.message;
		}
	}
}

/** Explains why a folder could not be opened as a workspace. */
export function openWorkspaceErrorMessage(cause: unknown): string {
	if (!(cause instanceof PauApiError)) {
		return 'Pau could not reach its backend. Check that the desktop app is still running, then try again.';
	}
	switch (cause.code) {
		case 'not_found': {
			return 'No folder exists at that path. Check the path and try again.';
		}
		case 'wrong_file_type': {
			return 'That path is a file. Choose a folder instead.';
		}
		case 'permission_denied': {
			return 'Pau does not have permission to read that folder.';
		}
		default: {
			return cause.message;
		}
	}
}

function workspaceName(workspace: Workspace): string {
	return workspace.name ?? workspace.path.split(/[\\/]/).findLast(Boolean) ?? workspace.path;
}

/** Titles a session by its first prompt, or by its agent before the first prompt. */
function sessionTitle(transcript: PiTranscript, agent: string): string {
	const prompt = transcript.entries.find((entry) => entry.kind === 'message' && entry.role === 'user');
	if (!prompt || prompt.kind !== 'message') return `New ${agent} session`;
	const line = prompt.body.trim().split('\n', 1)[0] ?? '';
	return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line;
}

function isLive(session: AgentSession): boolean {
	return session.status !== 'stopped' && session.status !== 'failed';
}

/** Strips the request ID, which the API takes from the path. */
function wireResponse(response: ExtensionUiResponse) {
	if ('value' in response) return { value: response.value };
	if ('confirmed' in response) return { confirmed: response.confirmed };
	return { cancelled: true };
}

function failureMessage(session: AgentSession): string | undefined {
	if (session.status !== 'failed') return undefined;
	const agent = agentLabel(session.agent);
	const exit =
		session.exit_code === null ? `${agent} exited unexpectedly.` : `${agent} exited with code ${session.exit_code}.`;
	return `${exit} Start a new session to continue.`;
}

/**
 * Live Pi sessions for the desktop session route.
 *
 * The HTTP API lists workspaces and sessions once. After that, the event
 * stream owns session state: `session_changed` replaces a session's summary
 * and `session_output` feeds its transcript. Sessions that exit stay listed
 * with their final status so their transcript remains readable.
 *
 * The event stream holds recent output only, and a resumed or branched session
 * starts with turns that never streamed. The store therefore reads each live
 * session's messages from the API when it loads, starts, resumes, branches,
 * or reconnects, and rebuilds the transcript from them. Output that arrives
 * while a read is in flight waits, and only output newer than the sequence
 * the read returns is applied on top. A message streaming when the read
 * started shows once it completes.
 *
 * Extension UI requests are `session_output` events too, but a replayed
 * stream cannot tell which dialogs still wait. The store therefore reads each
 * live session's extension UI from the API after loading, after every
 * reconnect, and whenever a dialog request arrives. Status, widget, and
 * resolution events that arrive while a read is in flight are applied again
 * on top of its result.
 */
export class LiveSessions {
	#workspaces = $state<Workspace[]>([]);
	#sessions = $state<Record<string, AgentSession>>({});
	#transcripts = $state<Record<string, PiTranscript>>({});
	#extensionUi = $state<Record<string, LiveExtensionUi>>({});
	#queues = $state<Record<string, MessageQueue>>({});
	/** Sessions whose queue an event updated while its read was in flight, so the read is stale. */
	readonly #queueUpdated = new SvelteSet<string>();
	/** Levels the operator selected whose requests are still in flight. */
	#pendingThinkingLevels = $state<Record<string, ThinkingLevel>>({});
	/** Estimated context size after each manual compaction, by session and first kept entry. Compaction events omit it. */
	#compactionEstimates = $state<Record<string, Record<string, number>>>({});
	#usages = $state<Record<string, SessionUsage>>({});
	/**
	 * Current branch by workspace, for the session status line. The store reads
	 * it on load and reconnect, and after each run settles, since the agent may
	 * have switched branches during the run.
	 */
	#branches = $state<Record<string, string>>({});
	/** Names sent to Pi that it has not confirmed yet, by session. The rail shows them meanwhile. */
	#pendingNames = $state<Record<string, string>>({});
	/** The session the operator is looking at. Changes to it never raise a marker. */
	#viewed = $state<string>();
	/** Sessions that waited, failed, or finished a turn out of view and have not been opened since. */
	readonly #unseen = new SvelteSet<string>();
	/** Sessions whose usage an event updated while its read was in flight, so the read is stale. */
	readonly #usageUpdated = new SvelteSet<string>();
	/** Extension events received while the session's extension UI read is in flight. */
	readonly #extensionReplay = new SvelteMap<string, unknown[]>();
	/** Sessions whose extension UI changed during the read in flight and needs another read. */
	readonly #extensionStale = new SvelteSet<string>();
	readonly #notificationTimers = new SvelteSet<string>();
	/** Transcript output received while the session's message read is in flight. */
	readonly #historyReplay = new SvelteMap<string, ServerEvent[]>();
	/** Sessions that need another message read once the one in flight ends. */
	readonly #historyStale = new SvelteSet<string>();
	/** The event sequence each session's transcript was loaded at. Older output is already in it. */
	readonly #historySequence = new SvelteMap<string, number>();
	/**
	 * Transcript output waiting for the next frame, by session. A streaming turn
	 * emits many deltas per frame, and each one would otherwise copy the entry
	 * list and re-render the transcript. Events keep their arrival order.
	 */
	readonly #pendingOutput = new SvelteMap<string, unknown[]>();
	#frameScheduled = false;
	readonly #scheduleFrame: (flush: () => void) => void;
	#loadFailed = $state(false);
	#socketOpen = $state(false);
	#connectedOnce = false;
	readonly #fetcher: typeof fetch;
	readonly #stream: EventStreamClient;
	loading = $state(true);

	constructor(options: LiveSessionsOptions) {
		this.#fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
		this.#scheduleFrame = options.scheduleFrame ?? nextFrame;
		this.#stream = new EventStreamClient({
			browserOrigin: options.browserOrigin,
			socketFactory: options.socketFactory,
			onState: (state, event) => this.#apply(state, event),
			onConnectionChange: (connected) => {
				this.#socketOpen = connected;
				if (!connected) return;
				const reconnected = this.#connectedOnce;
				this.#connectedOnce = true;
				if (this.#loadFailed) void this.#load();
				else if (reconnected) this.#refresh();
			}
		});
	}

	/** The agent a session runs. Every agent other than Claude Code takes the Pi paths. */
	#agent(sessionId: string): SessionAgent {
		return this.#sessions[sessionId]?.agent === 'claude' ? 'claude' : 'pi';
	}

	/** The live session in a workspace that runs the saved Pi session, if any. */
	#liveSessionFor(workspaceId: string, savedSessionId: string): AgentSession | undefined {
		return Object.values(this.#sessions).find(
			(session) =>
				isLive(session) && session.workspace_id === workspaceId && session.native_session_id === savedSessionId
		);
	}

	#updateExtensionUi(sessionId: string, update: (state: LiveExtensionUi) => LiveExtensionUi): void {
		const current = this.#extensionUi[sessionId] ?? emptyExtensionUi;
		const next = update(current);
		if (next === current) return;
		this.#extensionUi[sessionId] = next;
		for (const notification of next.notifications) {
			const timer = `${sessionId}:${notification.id}`;
			if (this.#notificationTimers.has(timer)) continue;
			this.#notificationTimers.add(timer);
			setTimeout(() => {
				this.#notificationTimers.delete(timer);
				this.#updateExtensionUi(sessionId, (state) => withoutNotification(state, notification.id));
			}, NOTIFICATION_MS);
		}
	}

	/** Reads the messages, extension UI, and message queue of every live session. */
	#refresh(): void {
		for (const workspace of this.#workspaces) void this.#readBranch(workspace.id);
		for (const session of Object.values(this.#sessions)) {
			if (!isLive(session)) continue;
			void this.#readHistory(session.id);
			void this.#readExtensionUi(session.id);
			void this.#readQueue(session.id);
			void this.#readUsage(session.id);
		}
	}

	/** Reads a workspace's branch. A detached HEAD or a folder outside a repository has none. */
	async #readBranch(workspaceId: string): Promise<void> {
		try {
			const { branch } = await getWorkspaceGitStatus(workspaceId, this.#fetcher);
			if (branch) this.#branches[workspaceId] = branch;
			else delete this.#branches[workspaceId];
		} catch {
			// The status line leaves the branch out until a later read succeeds.
		}
	}

	/** Reads a session's usage. A `session_usage` event that arrives during the read is newer. */
	async #readUsage(sessionId: string): Promise<void> {
		if (!this.#sessions[sessionId]?.capabilities.usage) return;
		this.#usageUpdated.delete(sessionId);
		try {
			const usage = await getSessionUsage(sessionId, this.#fetcher);
			if (!this.#usageUpdated.has(sessionId)) this.#usages[sessionId] = viewUsage(usage);
		} catch {
			// The session exited or the backend went away. The next reconnect reads again.
		}
	}

	/**
	 * Rebuilds a session's transcript from its messages, then applies the output
	 * that arrived during the read and is newer than it. When the read fails,
	 * for example because the session exited, the held output is applied to
	 * the transcript the store already has.
	 */
	async #readHistory(sessionId: string): Promise<void> {
		// The Claude bridge keeps no history to read; its transcript is what streamed.
		if (this.#agent(sessionId) === 'claude') return;
		if (this.#historyReplay.has(sessionId)) {
			this.#historyStale.add(sessionId);
			return;
		}
		this.#flushOutput(sessionId);
		this.#historyReplay.set(sessionId, []);
		let transcript: PiTranscript | undefined;
		let after = this.#historySequence.get(sessionId) ?? 0;
		try {
			const history = await getSessionMessages(sessionId, this.#fetcher);
			transcript = piTranscriptFromMessages(history.messages);
			after = history.sequence;
		} catch {
			// Keep what streamed. The next reconnect reads again.
		}
		transcript ??= this.#transcripts[sessionId] ?? emptyPiTranscript;
		const replay = this.#historyReplay.get(sessionId) ?? [];
		for (const event of replay) {
			if (event.sequence > after) transcript = reducePiEvent(transcript, JSON.parse(event.payload));
		}
		this.#transcripts[sessionId] = transcript;
		this.#historySequence.set(sessionId, after);
		this.#historyReplay.delete(sessionId);
		if (this.#historyStale.delete(sessionId)) void this.#readHistory(sessionId);
	}

	/**
	 * Reads a session's queue. Pi sends the whole queue with every update, so an
	 * update that arrives during the read is newer than the read's result.
	 */
	async #readQueue(sessionId: string): Promise<void> {
		if (!this.#sessions[sessionId]?.capabilities.message_queue) return;
		this.#queueUpdated.delete(sessionId);
		try {
			const queue = await getSessionQueue(sessionId, this.#fetcher);
			if (this.#queueUpdated.has(sessionId)) return;
			this.#queues[sessionId] = { steering: queue.steering, followUp: queue.follow_up };
		} catch {
			// The session exited or the backend went away. The next reconnect reads again.
		}
	}

	async #readExtensionUi(sessionId: string): Promise<void> {
		// Extension UI comes from Pi extensions only.
		if (this.#agent(sessionId) === 'claude') return;
		if (this.#extensionReplay.has(sessionId)) {
			this.#extensionStale.add(sessionId);
			return;
		}
		this.#extensionReplay.set(sessionId, []);
		try {
			const server = await getSessionExtensionUi(sessionId, this.#fetcher);
			const replay = this.#extensionReplay.get(sessionId) ?? [];
			this.#updateExtensionUi(sessionId, (state) => {
				let next = withServerExtensionUi(state, server);
				for (const event of replay) next = reduceExtensionEvent(next, event);
				return next;
			});
		} catch {
			// The session exited or the backend went away. The next reconnect reads again.
		} finally {
			this.#extensionReplay.delete(sessionId);
			if (this.#extensionStale.delete(sessionId)) void this.#readExtensionUi(sessionId);
		}
	}

	async #control(request: () => Promise<void>, agent: SessionAgent = 'pi'): Promise<void> {
		try {
			await request();
		} catch (cause) {
			throw new Error(sessionErrorMessage(cause, 'control', agent), { cause });
		}
	}

	async #load(): Promise<void> {
		try {
			const [workspaces, sessions] = await Promise.all([listWorkspaces(this.#fetcher), listSessions(this.#fetcher)]);
			this.#workspaces = workspaces;
			for (const session of sessions) this.#sessions[session.id] ??= session;
			this.#loadFailed = false;
			this.#refresh();
		} catch {
			this.#loadFailed = true;
		} finally {
			this.loading = false;
		}
	}

	#apply(state: EventStreamState, event: ServerEvent | undefined): void {
		if (event?.kind === 'session_output' && event.session_id) {
			const sessionId = event.session_id;
			const payload: unknown = JSON.parse(event.payload);
			if (isExtensionEvent(payload)) {
				const session = this.#sessions[sessionId];
				if (session && !isLive(session)) return;
				if (opensDialog(payload)) {
					void this.#readExtensionUi(sessionId);
					return;
				}
				// A replayed notification is old news.
				if (payload.method === 'notify' && Date.now() - Date.parse(event.timestamp) > NOTIFICATION_MS) return;
				this.#extensionReplay.get(sessionId)?.push(payload);
				this.#updateExtensionUi(sessionId, (current) => reduceExtensionEvent(current, payload));
				return;
			}
			const usage = usageFromEvent(payload);
			if (usage) {
				this.#usageUpdated.add(sessionId);
				this.#usages[sessionId] = usage;
				return;
			}
			const queue = queueFromEvent(payload);
			if (queue) {
				this.#queueUpdated.add(sessionId);
				this.#queues[sessionId] = queue;
				return;
			}
			const replay = this.#historyReplay.get(sessionId);
			if (replay) {
				replay.push(event);
				return;
			}
			if (event.sequence <= (this.#historySequence.get(sessionId) ?? 0)) return;
			this.#queueOutput(sessionId, payload);
			return;
		}
		for (const changed of state.events) {
			if (changed.kind === 'workspace_changed') {
				const workspace = JSON.parse(changed.payload) as Workspace;
				if (this.#workspaces.every((known) => known.id !== workspace.id)) void this.#readBranch(workspace.id);
				this.#rememberWorkspace(workspace);
				continue;
			}
			if (changed.kind !== 'session_changed') continue;
			const session = JSON.parse(changed.payload) as AgentSession;
			const known = Object.hasOwn(this.#sessions, session.id);
			const previous = this.#sessions[session.id];
			if (previous?.status === 'running' && session.status !== 'running') void this.#readBranch(session.workspace_id);
			this.#markUnseen(previous, session);
			this.#sessions[session.id] = session;
			if (!known && !this.loading && isLive(session)) void this.#readHistory(session.id);
			if (!known && isLive(session)) void this.#readUsage(session.id);
			if (!isLive(session)) this.#updateExtensionUi(session.id, exitedExtensionUi);
		}
	}

	/**
	 * Raises an attention marker when a session outside the operator's view
	 * starts waiting, fails, or returns to idle after running a turn.
	 */
	#markUnseen(previous: AgentSession | undefined, next: AgentSession): void {
		if (!previous || previous.status === next.status || next.id === this.#viewed) return;
		const finished = previous.status === 'running' && next.status === 'idle';
		if (finished || next.status === 'waiting' || next.status === 'failed') this.#unseen.add(next.id);
	}

	/** Holds transcript output until the next frame, then commits the burst at once. */
	#queueOutput(sessionId: string, payload: unknown): void {
		const pending = this.#pendingOutput.get(sessionId);
		if (pending) pending.push(payload);
		else this.#pendingOutput.set(sessionId, [payload]);
		if (this.#frameScheduled) return;
		this.#frameScheduled = true;
		this.#scheduleFrame(() => {
			this.#frameScheduled = false;
			this.#flushOutput();
		});
	}

	/** Reduces pending output into one transcript commit per session. Omit the ID to flush every session. */
	#flushOutput(sessionId?: string): void {
		const ids = sessionId ? [sessionId] : this.#pendingOutput.keys().toArray();
		for (const id of ids) {
			const payloads = this.#pendingOutput.get(id);
			if (!payloads) continue;
			this.#pendingOutput.delete(id);
			let transcript = this.#transcripts[id] ?? emptyPiTranscript;
			const reduce = this.#agent(id) === 'claude' ? reduceClaudeEvent : reducePiEvent;
			for (const payload of payloads) transcript = reduce(transcript, payload);
			this.#transcripts[id] = transcript;
		}
	}

	/** Adds a workspace to the list, or replaces the entry with the same ID. */
	#rememberWorkspace(workspace: Workspace): void {
		const index = this.#workspaces.findIndex((known) => known.id === workspace.id);
		if (index === -1) this.#workspaces.push(workspace);
		else this.#workspaces[index] = workspace;
	}

	#viewModel(session: AgentSession): SessionViewModel {
		const transcript = this.#transcripts[session.id] ?? emptyPiTranscript;
		const extensionUi = this.#extensionUi[session.id] ?? emptyExtensionUi;
		const agent = agentLabel(session.agent);
		return {
			id: session.id,
			workspaceId: session.workspace_id,
			savedSessionId: session.native_session_id ?? undefined,
			title: this.#pendingNames[session.id] ?? session.name ?? sessionTitle(transcript, agent),
			agent,
			status: session.status,
			error: failureMessage(session),
			unseen: this.#unseen.has(session.id),
			attention: extensionUi.dialogs.length > 0 ? 'An extension is waiting for your answer.' : undefined,
			capabilities: {
				prompt: session.capabilities.prompt,
				followUp: session.capabilities.follow_up,
				steer: session.capabilities.steer,
				interrupt: session.capabilities.interrupt,
				stop: session.capabilities.stop,
				branching: session.capabilities.branching,
				retry: session.capabilities.retry,
				modelSelection: session.capabilities.model_selection,
				messageQueue: session.capabilities.message_queue,
				thinkingLevel: session.capabilities.thinking_level,
				usage: session.capabilities.usage,
				commandDiscovery: session.capabilities.command_discovery,
				compaction: session.capabilities.compaction,
				rename: session.capabilities.rename,
				cloneSession: session.capabilities.clone_session,
				shellCommands: session.capabilities.shell_commands
			},
			thinkingLevel: this.#pendingThinkingLevels[session.id] ?? session.thinking_level ?? undefined,
			thinkingLevels: session.thinking_levels.length > 0 ? session.thinking_levels : undefined,
			transcript: transcript.entries.map((entry) => {
				if (entry.kind !== 'compaction' || !entry.firstKeptEntryId) return entry;
				const tokensAfter = this.#compactionEstimates[session.id]?.[entry.firstKeptEntryId];
				return tokensAfter === undefined ? entry : { ...entry, tokensAfter };
			}),
			usage: this.#usages[session.id],
			compaction: transcript.compaction,
			extensionUi: extensionUiView(extensionUi),
			autoRetry: transcript.autoRetry,
			messageQueue: this.#queues[session.id]
		};
	}

	/** The saved Pi session a session runs, once Pi has saved one. */
	savedSessionId(sessionId: string): string | undefined {
		return this.#sessions[sessionId]?.native_session_id ?? undefined;
	}

	/** The ID of the live session that runs a saved Pi session, if one does. */
	liveSessionId(workspaceId: string, savedSessionId: string): string | undefined {
		return this.#liveSessionFor(workspaceId, savedSessionId)?.id;
	}

	/** Records which session the operator is looking at and clears its marker. */
	view(sessionId: string | undefined): void {
		this.#viewed = sessionId;
		if (sessionId) this.#unseen.delete(sessionId);
	}

	/** Clears every attention marker. */
	clearUnseen(): void {
		this.#unseen.clear();
	}

	/** Whether the backend is unreachable. The first connection attempt counts as loading. */
	get disconnected(): boolean {
		return this.#loadFailed || (this.#connectedOnce && !this.#socketOpen);
	}

	/** Workspaces with their sessions, oldest session first. */
	get workspaces(): SessionWorkspace[] {
		const sessions = Object.values(this.#sessions).sort((left, right) =>
			left.started_at.localeCompare(right.started_at)
		);
		const known = this.#workspaces.map((workspace) => ({
			id: workspace.id,
			name: workspaceName(workspace),
			path: workspace.path,
			branch: this.#branches[workspace.id]
		}));
		const unknown = sessions
			.map((session) => session.workspace_id)
			.filter((id, index, ids) => ids.indexOf(id) === index)
			.filter((id) => known.every((workspace) => workspace.id !== id))
			.map((id) => ({ id, name: id }));
		return [...known, ...unknown].map((workspace) => ({
			...workspace,
			sessions: sessions
				.filter((session) => session.workspace_id === workspace.id)
				.map((session) => this.#viewModel(session))
		}));
	}

	/** Loads the initial lists and opens the event stream. */
	connect(): void {
		void this.#load();
		this.#stream.connect();
	}

	/** Closes the event stream. Sessions keep running in the backend. */
	close(): void {
		this.#stream.stop();
		this.#flushOutput();
	}

	/**
	 * Opens a folder as a workspace and returns its ID. A folder that is already
	 * open returns its existing workspace. Rejects with operator-facing copy.
	 */
	async open(path: string): Promise<string> {
		try {
			const workspace = await openWorkspace(path, this.#fetcher);
			this.#rememberWorkspace(workspace);
			return workspace.id;
		} catch (cause) {
			throw new Error(openWorkspaceErrorMessage(cause), { cause });
		}
	}

	/** Starts a session of an agent, Pi by default, and returns its ID. Rejects with operator-facing copy. */
	async start(workspaceId: string, agent: SessionAgent = 'pi'): Promise<string> {
		try {
			const session = await startSession(workspaceId, this.#fetcher, null, agent);
			this.#sessions[session.id] = session;
			void this.#readHistory(session.id);
			return session.id;
		} catch (cause) {
			throw new Error(sessionErrorMessage(cause, 'start'), { cause });
		}
	}

	/** Lists a workspace's saved Pi sessions. Rejects with operator-facing copy. */
	async listSaved(workspaceId: string): Promise<SavedSessionList> {
		try {
			const list = await listNativeSessions(workspaceId, this.#fetcher);
			return {
				sessions: list.sessions.map((saved) => ({
					id: saved.id,
					title: saved.name?.trim() || saved.first_message?.trim() || 'Untitled session',
					modifiedAt: saved.modified_at ?? saved.created_at,
					live: this.#liveSessionFor(workspaceId, saved.id) !== undefined
				})),
				warnings: list.warnings
			};
		} catch (cause) {
			throw new Error(sessionErrorMessage(cause, 'start'), { cause });
		}
	}

	/**
	 * Opens a saved session of an agent, Pi by default, and returns the live
	 * session's ID. A saved session that a live session already runs is
	 * selected instead of resumed twice.
	 */
	async resume(workspaceId: string, savedSessionId: string, agent: SessionAgent = 'pi'): Promise<string> {
		const running = this.#liveSessionFor(workspaceId, savedSessionId);
		if (running) return running.id;
		try {
			const session = await startSession(workspaceId, this.#fetcher, savedSessionId, agent);
			this.#sessions[session.id] = session;
			void this.#readHistory(session.id);
			return session.id;
		} catch (cause) {
			throw new Error(sessionErrorMessage(cause, 'resume'), { cause });
		}
	}

	/**
	 * Starts an ended session again with the same agent and returns the new
	 * live session's ID. It resumes the agent's saved session when the agent
	 * reported one, so the conversation continues. A session that failed
	 * before the agent saved anything starts fresh in the same workspace.
	 */
	async restart(sessionId: string): Promise<string> {
		const session = this.#sessions[sessionId];
		if (!session) throw new Error('Pau no longer has this session. Start a new one from the session rail.');
		const agent = this.#agent(sessionId);
		return session.native_session_id
			? this.resume(session.workspace_id, session.native_session_id, agent)
			: this.start(session.workspace_id, agent);
	}

	/** Lists the models a session can select. Rejects with operator-facing copy. */
	async listModels(sessionId: string): Promise<ModelOption[]> {
		try {
			const models = await listSessionModels(sessionId, this.#fetcher);
			return models.map((model) => ({
				provider: model.provider,
				id: model.id,
				name: model.name ?? undefined,
				reasoning: model.reasoning,
				current: model.current
			}));
		} catch (cause) {
			throw new Error(sessionErrorMessage(cause, 'control'), { cause });
		}
	}

	/** Lists the slash commands a session accepts. Rejects with operator-facing copy. */
	async listCommands(sessionId: string): Promise<CommandOption[]> {
		try {
			const commands = await listSessionCommands(sessionId, this.#fetcher);
			return commands.map((command) => ({
				name: command.name,
				description: command.description ?? undefined,
				source: command.source
			}));
		} catch (cause) {
			throw new Error(sessionErrorMessage(cause, 'control'), { cause });
		}
	}

	/** Switches a session's model. */
	selectModel(sessionId: string, model: ModelOption): Promise<void> {
		return this.#control(() =>
			selectSessionModel(sessionId, { provider: model.provider, model_id: model.id }, this.#fetcher)
		);
	}

	/**
	 * Sets a session's thinking level. The selected level shows while the request
	 * is in flight; afterwards the view shows the level Pi reports, which may be
	 * clamped to what the model supports.
	 */
	async selectThinkingLevel(sessionId: string, level: ThinkingLevel): Promise<void> {
		this.#pendingThinkingLevels[sessionId] = level;
		try {
			await this.#control(() => setSessionThinkingLevel(sessionId, level, this.#fetcher));
		} finally {
			delete this.#pendingThinkingLevels[sessionId];
		}
	}

	/**
	 * Prompts an idle session, or steers or queues a follow-up during a run.
	 *
	 * The Claude bridge does not echo prompts, so an accepted Claude prompt is
	 * added to the transcript here, ahead of any reply that streamed while the
	 * request was in flight.
	 */
	async send(sessionId: string, text: string, queue?: PromptQueue, images: PromptImage[] = []): Promise<void> {
		const attachments = images.map((image) => ({ mime_type: image.mimeType, data: image.data }));
		if (queue === undefined && this.#agent(sessionId) === 'claude') {
			this.#flushOutput(sessionId);
			const at = (this.#transcripts[sessionId] ?? emptyPiTranscript).entries.length;
			await this.#control(() => promptSession(sessionId, text, attachments, this.#fetcher), 'claude');
			this.#flushOutput(sessionId);
			this.#transcripts[sessionId] = withClaudePrompt(this.#transcripts[sessionId] ?? emptyPiTranscript, text, at);
			return;
		}
		return this.#control(() =>
			queue === undefined
				? promptSession(sessionId, text, attachments, this.#fetcher)
				: queueSessionMessage(
						sessionId,
						queue === 'follow-up' ? 'follow_up' : 'steer',
						text,
						attachments,
						this.#fetcher
					)
		);
	}

	/** Reads a session's entry tree. Rejects with operator-facing copy. */
	async tree(sessionId: string): Promise<SessionTreeSnapshot> {
		try {
			const tree = await getSessionTree(sessionId, this.#fetcher);
			const snapshot: SessionTreeSnapshot = {
				entries: tree.entries.map((entry) => ({
					id: entry.id,
					parentId: entry.parent_id ?? undefined,
					kind: entry.kind,
					role: entry.role ?? undefined,
					preview: entry.preview,
					timestamp: entry.timestamp ?? undefined
				})),
				leafId: tree.leaf_id ?? undefined,
				truncated: tree.truncated
			};
			return snapshot;
		} catch (cause) {
			throw new Error(sessionErrorMessage(cause, 'control'), { cause });
		}
	}

	/**
	 * Searches a session's saved transcript, newest matches first. Each hit
	 * names the loaded transcript entry that shows it, when there is one.
	 * Rejects with operator-facing copy.
	 */
	async search(sessionId: string, query: string): Promise<SessionSearchOutcome> {
		try {
			const result = await searchSession(sessionId, query, SEARCH_LIMIT, this.#fetcher);
			const entries = (this.#transcripts[sessionId] ?? emptyPiTranscript).entries;
			return {
				hits: result.matches.map((match) => ({
					id: match.entry_id,
					role: match.role ?? undefined,
					snippet: match.snippet,
					matchStart: match.match_start,
					matchEnd: match.match_end,
					timestamp: match.timestamp ?? undefined,
					entryKey: findTranscriptEntry(entries, match.role ?? undefined, match.timestamp ?? undefined)
				})),
				truncated: result.truncated
			};
		} catch (cause) {
			throw new Error(sessionErrorMessage(cause, 'control'), { cause });
		}
	}

	/**
	 * Branches an idle session from an earlier user message. Pi continues
	 * without that message and the ones after it, so the transcript reloads
	 * from the branch Pi now continues.
	 */
	async branch(sessionId: string, entryId: string): Promise<SessionBranchOutcome> {
		let result;
		try {
			result = await branchSession(sessionId, entryId, this.#fetcher);
		} catch (cause) {
			throw new Error(sessionErrorMessage(cause, 'branch'), { cause });
		}
		if (!result.cancelled) await this.#readHistory(sessionId);
		return { text: result.text ?? undefined, cancelled: result.cancelled };
	}

	/**
	 * Branches from a user message in the loaded transcript. The transcript
	 * keeps no Pi entry IDs, so this reads the session tree and picks the user
	 * entry that the transcript entry shows.
	 */
	async branchFromMessage(sessionId: string, transcriptEntryId: string): Promise<SessionBranchOutcome> {
		const snapshot = await this.tree(sessionId);
		const entries = (this.#transcripts[sessionId] ?? emptyPiTranscript).entries;
		const entry = snapshot.entries.find(
			(candidate) =>
				candidate.role === 'user' && findTranscriptEntry(entries, 'user', candidate.timestamp) === transcriptEntryId
		);
		if (!entry) {
			throw new Error('Pau could not find this message in the saved session. Branch from the session tree instead.');
		}
		return this.branch(sessionId, entry.id);
	}

	/**
	 * Renames a session. The rail shows the new name at once and returns to
	 * the previous one when Pi rejects it. Pi stores the name in the session
	 * file, and the session record reports it after a reload.
	 */
	async rename(sessionId: string, name: string): Promise<void> {
		this.#pendingNames[sessionId] = name;
		try {
			await this.#control(() => renameSession(sessionId, name, this.#fetcher));
			const session = this.#sessions[sessionId];
			if (session) this.#sessions[sessionId] = { ...session, name };
		} finally {
			delete this.#pendingNames[sessionId];
		}
	}

	/** Clones a session into a new saved session, which the live session then continues. */
	async clone(sessionId: string): Promise<void> {
		await this.#control(async () => {
			await cloneSession(sessionId, this.#fetcher);
		});
	}

	/**
	 * Reads a session's earlier prompts for composer recall, newest first. The
	 * Claude bridge keeps none, so a Claude session recalls only the prompts
	 * the composer sent.
	 */
	history(sessionId: string): Promise<string[]> {
		if (this.#agent(sessionId) === 'claude') return Promise.resolve([]);
		return getSessionHistory(sessionId, this.#fetcher);
	}

	/**
	 * Interrupts the active run and returns the queued messages it removed.
	 * When Pi could not clear its queue, the response is empty and the queue
	 * shown here stays until Pi reports its next change.
	 */
	async interrupt(sessionId: string): Promise<MessageQueue> {
		try {
			const cleared = await interruptSession(sessionId, this.#fetcher);
			if (cleared.steering.length > 0 || cleared.follow_up.length > 0) {
				this.#queueUpdated.add(sessionId);
				this.#queues[sessionId] = { steering: [], followUp: [] };
			}
			return { steering: cleared.steering, followUp: cleared.follow_up };
		} catch (cause) {
			throw new Error(sessionErrorMessage(cause, 'control', this.#agent(sessionId)), { cause });
		}
	}

	/**
	 * Runs a shell command and resolves once it finishes. The transcript shows
	 * the command from its stream events, which every window receives.
	 */
	runShellCommand(sessionId: string, command: string, excludeFromContext: boolean): Promise<void> {
		return this.#control(async () => {
			await runSessionShellCommand(sessionId, command, excludeFromContext, this.#fetcher);
		});
	}

	/** Stops every running shell command in the session. */
	stopShellCommands(sessionId: string): Promise<void> {
		return this.#control(() => stopSessionShellCommands(sessionId, this.#fetcher));
	}

	/** Re-sends the last prompt after a failed turn. */
	async retry(sessionId: string): Promise<void> {
		try {
			await retrySession(sessionId, this.#fetcher);
		} catch (cause) {
			throw new Error(sessionErrorMessage(cause, 'retry'), { cause });
		}
	}

	/**
	 * Compacts an idle session. The marker in the transcript comes from Pi's
	 * `compaction_end` event; the response adds the size estimate that event lacks.
	 */
	async compact(sessionId: string, customInstructions?: string): Promise<void> {
		try {
			const result = await compactSession(sessionId, customInstructions || null, this.#fetcher);
			if (result.first_kept_entry_id !== null && result.estimated_tokens_after !== null) {
				this.#compactionEstimates[sessionId] = {
					...this.#compactionEstimates[sessionId],
					[result.first_kept_entry_id]: result.estimated_tokens_after
				};
			}
		} catch (cause) {
			throw new Error(sessionErrorMessage(cause, 'compact'), { cause });
		}
	}

	/** Clears the queued messages and returns what the queue held. */
	async clearQueue(sessionId: string): Promise<MessageQueue> {
		try {
			const cleared = await clearSessionQueue(sessionId, this.#fetcher);
			this.#queueUpdated.add(sessionId);
			this.#queues[sessionId] = { steering: [], followUp: [] };
			return { steering: cleared.steering, followUp: cleared.follow_up };
		} catch (cause) {
			throw new Error(sessionErrorMessage(cause, 'control'), { cause });
		}
	}

	/** Cancels an automatic retry that is waiting to run. */
	cancelRetry(sessionId: string): Promise<void> {
		return this.#control(() => cancelSessionRetry(sessionId, this.#fetcher));
	}

	/** Stops the session's process. */
	stop(sessionId: string): Promise<void> {
		return this.#control(() => stopSession(sessionId, this.#fetcher), this.#agent(sessionId));
	}

	/**
	 * Answers an extension dialog. A request that already stopped waiting
	 * closes with a notice instead of failing, because nothing can be retried.
	 */
	async respond(sessionId: string, response: ExtensionUiResponse): Promise<void> {
		try {
			await respondToExtensionUi(sessionId, response.id, wireResponse(response), this.#fetcher);
			this.#updateExtensionUi(sessionId, (state) => withoutDialog(state, response.id));
		} catch (cause) {
			if (
				cause instanceof PauApiError &&
				(cause.code === 'extension_request_not_found' || cause.code === 'not_found')
			) {
				this.#updateExtensionUi(sessionId, (state) => resolveDialog(state, response.id, 'stale'));
				return;
			}
			throw new Error(sessionErrorMessage(cause, 'control'), { cause });
		}
	}

	/** Closes a dialog whose timeout elapsed on screen. */
	expire(sessionId: string, requestId: string): void {
		this.#updateExtensionUi(sessionId, (state) => resolveDialog(state, requestId, 'timed_out'));
	}
}
