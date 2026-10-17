import type { AgentSession, ServerEvent, Workspace } from '@stormlightlabs/pau-protocol';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type {
	ExtensionUiResponse,
	PromptQueue,
	SavedSessionList,
	SessionViewModel,
	SessionWorkspace
} from '@stormlightlabs/pau-ui';

import {
	PauApiError,
	getSessionExtensionUi,
	getSessionHistory,
	interruptSession,
	listNativeSessions,
	listSessions,
	listWorkspaces,
	promptSession,
	queueSessionMessage,
	respondToExtensionUi,
	startSession,
	stopSession
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
import { EventStreamClient, type EventSocketFactory, type EventStreamState } from './event-stream';
import { emptyPiTranscript, reducePiEvent, type PiTranscript } from './pi-transcript';

/** Transport hooks for {@link LiveSessions}. Tests replace both. */
export type LiveSessionsOptions = {
	search: string;
	browserOrigin: string;
	fetcher?: typeof fetch;
	socketFactory?: EventSocketFactory;
};

const TITLE_LENGTH = 60;

/** How long an extension notification stays on screen. */
const NOTIFICATION_MS = 8000;

/**
 * Turns an API failure into copy for the operator. Starting and controlling a
 * session share most codes, but `not_found` names a different missing thing.
 */
export function sessionErrorMessage(cause: unknown, action: 'start' | 'control' | 'resume'): string {
	if (!(cause instanceof PauApiError)) {
		return 'Pau could not reach its backend. Check that the desktop app is still running, then try again.';
	}
	switch (cause.code) {
		case 'pi_unavailable':
			return 'Pau could not find a working Pi installation. Install Pi or add it to your PATH, then try again.';
		case 'sandboxed_session_unsupported':
			return 'This workspace uses a sandbox, and sandboxed sessions cannot start from the desktop yet. Turn off the sandbox in the workspace settings to start a session.';
		case 'native_session_not_found':
			return 'Pi no longer has that saved session. It may have been deleted. Pick another session or start a new one.';
		case 'invalid_native_session':
			return 'Pi could not read that saved session, so it cannot be resumed. Pick another session or start a new one.';
		case 'not_found':
			return action !== 'control'
				? 'This workspace is no longer registered with Pau.'
				: 'This session has ended. Start a new session to continue.';
		case 'session_exited':
			return 'This session has ended. Start a new session to continue.';
		case 'unsupported_control':
			return 'This session does not support that action.';
		case 'invalid_session_state':
			return 'The session changed state before Pau could send that. Try again.';
		case 'control_rejected':
			return `Pi rejected the request: ${cause.message}`;
		case 'invalid_extension_response':
			return `The extension could not use that answer. ${cause.message}`;
		case 'invalid_agent_response':
			return 'Pi sent a response Pau could not read. Open Diagnostics for details.';
		default:
			return cause.message;
	}
}

function workspaceName(workspace: Workspace): string {
	return workspace.name ?? workspace.path.split(/[\\/]/).filter(Boolean).at(-1) ?? workspace.path;
}

function sessionTitle(transcript: PiTranscript): string {
	const prompt = transcript.entries.find((entry) => entry.kind === 'message' && entry.role === 'user');
	if (!prompt || prompt.kind !== 'message') return 'New Pi session';
	const line = prompt.body.trim().split('\n')[0] ?? '';
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
	const exit = session.exit_code === null ? 'Pi exited unexpectedly.' : `Pi exited with code ${session.exit_code}.`;
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
 * Extension UI requests are `session_output` events too, but a replayed
 * stream cannot tell which dialogs still wait. The store therefore reads each
 * live session's extension UI from the API after loading, after every
 * reconnect, and whenever a dialog request arrives. Status, widget, and
 * resolution events that arrive while a read is in flight are applied again
 * on top of its result.
 */
export class LiveSessions {
	loading = $state(true);
	#workspaces = $state<Workspace[]>([]);
	#sessions = $state<Record<string, AgentSession>>({});
	#transcripts = $state<Record<string, PiTranscript>>({});
	#extensionUi = $state<Record<string, LiveExtensionUi>>({});
	/** Extension events received while the session's extension UI read is in flight. */
	readonly #extensionReplay = new SvelteMap<string, unknown[]>();
	/** Sessions whose extension UI changed during the read in flight and needs another read. */
	readonly #extensionStale = new SvelteSet<string>();
	readonly #notificationTimers = new SvelteSet<string>();
	#loadFailed = $state(false);
	#socketOpen = $state(false);
	#connectedOnce = false;
	readonly #options: LiveSessionsOptions;
	readonly #fetcher: typeof fetch;
	readonly #stream: EventStreamClient;

	constructor(options: LiveSessionsOptions) {
		this.#options = options;
		this.#fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
		this.#stream = new EventStreamClient({
			search: options.search,
			browserOrigin: options.browserOrigin,
			socketFactory: options.socketFactory,
			onState: (state, event) => this.#apply(state, event),
			onConnectionChange: (connected) => {
				this.#socketOpen = connected;
				if (!connected) return;
				const reconnected = this.#connectedOnce;
				this.#connectedOnce = true;
				if (this.#loadFailed) void this.#load();
				else if (reconnected) this.#refreshExtensionUi();
			}
		});
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
		const known = this.#workspaces.map((workspace) => ({ id: workspace.id, name: workspaceName(workspace) }));
		const unknown = [...new Set(sessions.map((session) => session.workspace_id))]
			.filter((id) => !known.some((workspace) => workspace.id === id))
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
	}

	/** Starts a session and returns its ID. Rejects with operator-facing copy. */
	async start(workspaceId: string): Promise<string> {
		try {
			const session = await startSession(this.#options.search, workspaceId, this.#fetcher);
			this.#sessions[session.id] = session;
			return session.id;
		} catch (cause) {
			throw new Error(sessionErrorMessage(cause, 'start'), { cause });
		}
	}

	/** Lists a workspace's saved Pi sessions. Rejects with operator-facing copy. */
	async listSaved(workspaceId: string): Promise<SavedSessionList> {
		try {
			const list = await listNativeSessions(this.#options.search, workspaceId, this.#fetcher);
			return {
				sessions: list.sessions.map((saved) => ({
					id: saved.id,
					title: saved.name?.trim() || saved.first_message?.trim() || 'Untitled session',
					modifiedAt: saved.modified_at ?? saved.created_at
				})),
				warnings: list.warnings
			};
		} catch (cause) {
			throw new Error(sessionErrorMessage(cause, 'start'), { cause });
		}
	}

	/** Resumes a saved Pi session and returns the new live session's ID. */
	async resume(workspaceId: string, savedSessionId: string): Promise<string> {
		try {
			const session = await startSession(this.#options.search, workspaceId, this.#fetcher, savedSessionId);
			this.#sessions[session.id] = session;
			return session.id;
		} catch (cause) {
			throw new Error(sessionErrorMessage(cause, 'resume'), { cause });
		}
	}

	/** Prompts an idle session, or steers or queues a follow-up during a run. */
	send(sessionId: string, text: string, queue?: PromptQueue): Promise<void> {
		return this.#control(() =>
			queue === undefined
				? promptSession(this.#options.search, sessionId, text, this.#fetcher)
				: queueSessionMessage(
						this.#options.search,
						sessionId,
						queue === 'follow-up' ? 'follow_up' : 'steer',
						text,
						this.#fetcher
					)
		);
	}

	/** Reads a session's earlier prompts for composer recall, newest first. */
	history(sessionId: string): Promise<string[]> {
		return getSessionHistory(this.#options.search, sessionId, this.#fetcher);
	}

	/** Interrupts the active run. */
	interrupt(sessionId: string): Promise<void> {
		return this.#control(() => interruptSession(this.#options.search, sessionId, this.#fetcher));
	}

	/** Stops the session's process. */
	stop(sessionId: string): Promise<void> {
		return this.#control(() => stopSession(this.#options.search, sessionId, this.#fetcher));
	}

	/**
	 * Answers an extension dialog. A request that already stopped waiting
	 * closes with a notice instead of failing, because nothing can be retried.
	 */
	async respond(sessionId: string, response: ExtensionUiResponse): Promise<void> {
		try {
			await respondToExtensionUi(this.#options.search, sessionId, response.id, wireResponse(response), this.#fetcher);
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

	/** Reads the extension UI of every live session. */
	#refreshExtensionUi(): void {
		for (const session of Object.values(this.#sessions)) {
			if (isLive(session)) void this.#readExtensionUi(session.id);
		}
	}

	async #readExtensionUi(sessionId: string): Promise<void> {
		if (this.#extensionReplay.has(sessionId)) {
			this.#extensionStale.add(sessionId);
			return;
		}
		this.#extensionReplay.set(sessionId, []);
		try {
			const server = await getSessionExtensionUi(this.#options.search, sessionId, this.#fetcher);
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

	async #control(request: () => Promise<void>): Promise<void> {
		try {
			await request();
		} catch (cause) {
			throw new Error(sessionErrorMessage(cause, 'control'), { cause });
		}
	}

	async #load(): Promise<void> {
		try {
			const [workspaces, sessions] = await Promise.all([
				listWorkspaces(this.#options.search, this.#fetcher),
				listSessions(this.#options.search, this.#fetcher)
			]);
			this.#workspaces = workspaces;
			for (const session of sessions) this.#sessions[session.id] ??= session;
			this.#loadFailed = false;
			this.#refreshExtensionUi();
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
			const transcript = this.#transcripts[sessionId] ?? emptyPiTranscript;
			this.#transcripts[sessionId] = reducePiEvent(transcript, payload);
			return;
		}
		for (const changed of state.events) {
			if (changed.kind !== 'session_changed') continue;
			const session = JSON.parse(changed.payload) as AgentSession;
			this.#sessions[session.id] = session;
			if (!isLive(session)) this.#updateExtensionUi(session.id, exitedExtensionUi);
		}
	}

	#viewModel(session: AgentSession): SessionViewModel {
		const transcript = this.#transcripts[session.id] ?? emptyPiTranscript;
		const extensionUi = this.#extensionUi[session.id] ?? emptyExtensionUi;
		return {
			id: session.id,
			workspaceId: session.workspace_id,
			title: sessionTitle(transcript),
			agent: 'Pi',
			status: session.status,
			error: failureMessage(session),
			attention: extensionUi.dialogs.length > 0 ? 'An extension is waiting for your answer.' : undefined,
			capabilities: {
				prompt: session.capabilities.prompt,
				followUp: session.capabilities.follow_up,
				steer: session.capabilities.steer,
				interrupt: session.capabilities.interrupt,
				stop: session.capabilities.stop
			},
			transcript: transcript.entries,
			extensionUi: extensionUiView(extensionUi)
		};
	}
}
