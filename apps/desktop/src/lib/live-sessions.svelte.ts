import type { AgentSession, ServerEvent, Workspace } from '@stormlightlabs/pau-protocol';
import type { PromptQueue, SessionViewModel, SessionWorkspace } from '@stormlightlabs/pau-ui';

import {
	PauApiError,
	interruptSession,
	listSessions,
	listWorkspaces,
	promptSession,
	queueSessionMessage,
	startSession,
	stopSession
} from './api';
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

/**
 * Turns an API failure into copy for the operator. Starting and controlling a
 * session share most codes, but `not_found` names a different missing thing.
 */
export function sessionErrorMessage(cause: unknown, action: 'start' | 'control'): string {
	if (!(cause instanceof PauApiError)) {
		return 'Pau could not reach its backend. Check that the desktop app is still running, then try again.';
	}
	switch (cause.code) {
		case 'pi_unavailable':
			return 'Pau could not find a working Pi installation. Install Pi or add it to your PATH, then try again.';
		case 'sandboxed_session_unsupported':
			return 'This workspace uses a sandbox, and sandboxed sessions cannot start from the desktop yet. Turn off the sandbox in the workspace settings to start a session.';
		case 'not_found':
			return action === 'start'
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
 */
export class LiveSessions {
	loading = $state(true);
	#workspaces = $state<Workspace[]>([]);
	#sessions = $state<Record<string, AgentSession>>({});
	#transcripts = $state<Record<string, PiTranscript>>({});
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
				this.#connectedOnce = true;
				if (this.#loadFailed) void this.#load();
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

	/** Interrupts the active run. */
	interrupt(sessionId: string): Promise<void> {
		return this.#control(() => interruptSession(this.#options.search, sessionId, this.#fetcher));
	}

	/** Stops the session's process. */
	stop(sessionId: string): Promise<void> {
		return this.#control(() => stopSession(this.#options.search, sessionId, this.#fetcher));
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
		} catch {
			this.#loadFailed = true;
		} finally {
			this.loading = false;
		}
	}

	#apply(state: EventStreamState, event: ServerEvent | undefined): void {
		if (event?.kind === 'session_output' && event.session_id) {
			const transcript = this.#transcripts[event.session_id] ?? emptyPiTranscript;
			this.#transcripts[event.session_id] = reducePiEvent(transcript, JSON.parse(event.payload));
			return;
		}
		for (const changed of state.events) {
			if (changed.kind !== 'session_changed') continue;
			const session = JSON.parse(changed.payload) as AgentSession;
			this.#sessions[session.id] = session;
		}
	}

	#viewModel(session: AgentSession): SessionViewModel {
		const transcript = this.#transcripts[session.id] ?? emptyPiTranscript;
		return {
			id: session.id,
			workspaceId: session.workspace_id,
			title: sessionTitle(transcript),
			agent: 'Pi',
			status: session.status,
			error: failureMessage(session),
			capabilities: {
				prompt: session.capabilities.prompt,
				followUp: session.capabilities.follow_up,
				steer: session.capabilities.steer,
				interrupt: session.capabilities.interrupt,
				stop: session.capabilities.stop
			},
			transcript: transcript.entries
		};
	}
}
