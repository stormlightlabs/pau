import type {
	AgentKeybindings,
	AgentSession,
	DiagnosticBundle,
	DiagnosticLevel,
	EffectiveSandbox,
	ExtensionUiResponse,
	SandboxAdapter,
	SandboxSelection,
	FileContent,
	FileEntry,
	FileSearchMatch,
	GitDiff,
	GitStatus,
	NativeSessionList,
	SessionBranchRequest,
	SessionBranchResult,
	SessionCloneResult,
	SessionExtensionUi,
	SessionCommand,
	SessionCompactionResult,
	SessionCompactRequest,
	SessionModel,
	SessionModelSelection,
	SessionMessageQueue,
	SessionImage,
	SessionMessageRequest,
	SessionMessages,
	SessionPromptRequest,
	SessionRenameRequest,
	SessionQueue,
	SessionSearchResult,
	SessionTree,
	SessionThinkingLevel,
	SessionThinkingLevelRequest,
	SessionUsage,
	StartSessionRequest,
	TerminalInfo,
	TerminalSize,
	UiPreferences,
	VersionResponse,
	Workspace,
	WorkspaceSandbox
} from '@stormlightlabs/pau-protocol';

/**
 * Where the client sends API requests and the token it authenticates with.
 * An empty origin means same-origin paths, and a missing token means no
 * `Authorization` header.
 */
export type ApiConnection = { origin: string; token: string | undefined };

/**
 * The global the desktop shell defines before any page script runs. It holds
 * the loopback origin of the backend the shell started and that launch's
 * bearer token, as `{ apiOrigin, token }`.
 */
export const DESKTOP_CONNECTION_GLOBAL = '__PAU_DESKTOP__';

/**
 * Reads the backend connection for this page.
 *
 * The desktop shell injects its connection as a frozen, read-only global on
 * every page load, so it survives navigation and reloads without appearing in
 * the URL or history. The global stays on `window` after it is read: any
 * script in the page could already call the API through this client, so
 * deleting it would add no protection, and it would break modules that Vite
 * re-evaluates while `tauri dev` runs.
 *
 * Without the global, as in the browser development server, requests use
 * same-origin paths and carry no token. The Vite proxy adds the
 * `Authorization` header to the HTTP and WebSocket requests it forwards.
 *
 * @throws When the injected connection is malformed.
 */
export function apiConnection(): ApiConnection {
	const injected: unknown = Reflect.get(globalThis, DESKTOP_CONNECTION_GLOBAL);
	if (injected === undefined) return { origin: '', token: undefined };
	const { apiOrigin, token } = (injected ?? {}) as { apiOrigin?: unknown; token?: unknown };
	const port = typeof apiOrigin === 'string' ? /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(apiOrigin)?.[1] : undefined;
	if (port === undefined || Number(port) < 1 || Number(port) > 65_535) {
		throw new Error('The desktop API origin is invalid.');
	}
	if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,}$/.test(token)) {
		throw new Error('The desktop API token is invalid.');
	}
	return { origin: `http://127.0.0.1:${Number(port)}`, token };
}

function authorization(): HeadersInit | undefined {
	const { token } = apiConnection();
	return token === undefined ? undefined : { Authorization: `Bearer ${token}` };
}

type ApiErrorBody = { code?: string; message?: string };

/** An HTTP API failure with the backend's stable error code when available. */
export class PauApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code?: string
	) {
		super(message);
		this.name = 'PauApiError';
	}
}

async function responseJson<T>(response: Response): Promise<T> {
	if (response.ok) return (await response.json()) as T;
	let body: ApiErrorBody = {};
	try {
		body = (await response.json()) as ApiErrorBody;
	} catch {
		// The HTTP status remains useful when a proxy returns a non-JSON response.
	}
	throw new PauApiError(
		body.message ?? `The Pau backend returned HTTP ${response.status}.`,
		response.status,
		body.code
	);
}

function workspaceEndpoint(
	workspaceId: string,
	endpoint: 'file' | 'files' | 'search' | 'git/diff' | 'git/status' | 'sandbox' | 'sandbox/preview' | 'pi-sessions'
): URL {
	const origin = apiConnection().origin || 'https://pau.local';
	return new URL(`/api/workspaces/${encodeURIComponent(workspaceId)}/${endpoint}`, origin);
}

function requestUrl(url: URL): string {
	return apiConnection().origin ? url.href : `${url.pathname}${url.search}`;
}

/** Reads the running backend version through the shared HTTP API. */
export async function getBackendVersion(fetcher: typeof fetch = fetch): Promise<VersionResponse> {
	const response = await fetcher(`${apiConnection().origin}/api/version`, { headers: authorization() });
	return responseJson<VersionResponse>(response);
}

/** Reads Pi's effective key bindings, including the operator's overrides. */
export async function getPiKeybindings(fetcher: typeof fetch = fetch): Promise<AgentKeybindings> {
	const response = await fetcher(`${apiConnection().origin}/api/pi/keybindings`, { headers: authorization() });
	return responseJson<AgentKeybindings>(response);
}

/** Reads the saved interface preferences, or the defaults when none are saved. */
export async function getUiPreferences(fetcher: typeof fetch = fetch): Promise<UiPreferences> {
	const response = await fetcher(`${apiConnection().origin}/api/preferences`, { headers: authorization() });
	return responseJson<UiPreferences>(response);
}

/** Replaces the saved interface preferences and notifies every window. */
export async function updateUiPreferences(
	preferences: UiPreferences,
	fetcher: typeof fetch = fetch
): Promise<UiPreferences> {
	const response = await fetcher(`${apiConnection().origin}/api/preferences`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json', ...authorization() },
		body: JSON.stringify(preferences)
	});
	return responseJson<UiPreferences>(response);
}

/** Reads the current redacted diagnostics preview. */
export async function getDiagnostics(fetcher: typeof fetch = fetch): Promise<DiagnosticBundle> {
	const response = await fetcher(`${apiConnection().origin}/api/diagnostics`, { headers: authorization() });
	return responseJson<DiagnosticBundle>(response);
}

/** Changes observation-only release diagnostic settings. */
export async function updateDiagnosticSettings(
	enabled: boolean,
	minLevel: DiagnosticLevel,
	fetcher: typeof fetch = fetch
): Promise<DiagnosticBundle> {
	const response = await fetcher(`${apiConnection().origin}/api/diagnostics/settings`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json', ...authorization() },
		body: JSON.stringify({ enabled, min_level: minLevel })
	});
	return responseJson<DiagnosticBundle>(response);
}

/** Enables temporary payload-shape tracing. */
export async function startPayloadTracing(
	durationSeconds: number,
	fetcher: typeof fetch = fetch
): Promise<DiagnosticBundle> {
	const response = await fetcher(`${apiConnection().origin}/api/diagnostics/payload-tracing`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authorization() },
		body: JSON.stringify({ duration_seconds: durationSeconds })
	});
	return responseJson<DiagnosticBundle>(response);
}

/** Writes the diagnostic revision that the operator reviewed. */
export async function exportDiagnostics(
	destination: string,
	reviewedRevision: number,
	fetcher: typeof fetch = fetch
): Promise<{ written: boolean }> {
	const response = await fetcher(`${apiConnection().origin}/api/diagnostics/export`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authorization() },
		body: JSON.stringify({ destination, reviewed_revision: reviewedRevision })
	});
	return responseJson<{ written: boolean }>(response);
}

/** Lists workspace registrations available to the current backend. */
export async function listWorkspaces(fetcher: typeof fetch = fetch): Promise<Workspace[]> {
	const response = await fetcher(`${apiConnection().origin}/api/workspaces`, { headers: authorization() });
	return responseJson<Workspace[]>(response);
}

/**
 * Registers a folder as a workspace and returns it. Opening a folder that is
 * already registered returns the existing workspace.
 *
 * @throws {PauApiError} With `not_found` when nothing exists at the path, or
 * `wrong_file_type` when the path is not a folder.
 */
export async function openWorkspace(path: string, fetcher: typeof fetch = fetch): Promise<Workspace> {
	const response = await fetcher(`${apiConnection().origin}/api/workspaces`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authorization() },
		body: JSON.stringify({ path })
	});
	return responseJson<Workspace>(response);
}

/** Lists one directory in a registered workspace. */
export async function listWorkspaceFiles(
	workspaceId: string,
	path: string,
	options: { includeHidden: boolean; includeIgnored: boolean },
	fetcher: typeof fetch = fetch
): Promise<FileEntry[]> {
	const url = workspaceEndpoint(workspaceId, 'files');
	if (path) url.searchParams.set('path', path);
	if (options.includeHidden) url.searchParams.set('include_hidden', 'true');
	if (options.includeIgnored) url.searchParams.set('include_ignored', 'true');
	const response = await fetcher(requestUrl(url), { headers: authorization() });
	return responseJson<FileEntry[]>(response);
}

/** Reads one UTF-8 workspace file for the built-in editor. */
export async function readWorkspaceFile(
	workspaceId: string,
	path: string,
	fetcher: typeof fetch = fetch
): Promise<FileContent> {
	const url = workspaceEndpoint(workspaceId, 'file');
	url.searchParams.set('path', path);
	const response = await fetcher(requestUrl(url), { headers: authorization() });
	return responseJson<FileContent>(response);
}

/** Writes one workspace file if its revision still matches the editor's copy. */
export async function writeWorkspaceFile(
	workspaceId: string,
	path: string,
	content: string,
	expectedRevision: string,
	fetcher: typeof fetch = fetch
): Promise<FileContent> {
	const url = workspaceEndpoint(workspaceId, 'file');
	const response = await fetcher(requestUrl(url), {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json', ...authorization() },
		body: JSON.stringify({ path, content, expected_revision: expectedRevision })
	});
	return responseJson<FileContent>(response);
}

/** Searches visible UTF-8 files in a registered workspace. */
export async function searchWorkspaceFiles(
	workspaceId: string,
	query: string,
	options: { includeHidden: boolean; includeIgnored: boolean },
	fetcher: typeof fetch = fetch
): Promise<FileSearchMatch[]> {
	const url = workspaceEndpoint(workspaceId, 'search');
	url.searchParams.set('query', query);
	url.searchParams.set('limit', '1000');
	if (options.includeHidden) url.searchParams.set('include_hidden', 'true');
	if (options.includeIgnored) url.searchParams.set('include_ignored', 'true');
	const response = await fetcher(requestUrl(url), { headers: authorization() });
	return responseJson<FileSearchMatch[]>(response);
}

/** Reads branch and changed-file state for a registered workspace. */
export async function getWorkspaceGitStatus(workspaceId: string, fetcher: typeof fetch = fetch): Promise<GitStatus> {
	const url = workspaceEndpoint(workspaceId, 'git/status');
	const response = await fetcher(requestUrl(url), { headers: authorization() });
	return responseJson<GitStatus>(response);
}

/** Reads one changed file against Git `HEAD`. */
export async function getWorkspaceGitDiff(
	workspaceId: string,
	path: string,
	fetcher: typeof fetch = fetch
): Promise<GitDiff> {
	const url = workspaceEndpoint(workspaceId, 'git/diff');
	url.searchParams.set('path', path);
	const response = await fetcher(requestUrl(url), { headers: authorization() });
	return responseJson<GitDiff>(response);
}

/** Reads a workspace's default sandbox selection for new agent sessions. */
export async function getWorkspaceSandbox(
	workspaceId: string,
	fetcher: typeof fetch = fetch
): Promise<WorkspaceSandbox> {
	const url = workspaceEndpoint(workspaceId, 'sandbox');
	const response = await fetcher(requestUrl(url), { headers: authorization() });
	return responseJson<WorkspaceSandbox>(response);
}

/** Validates and stores a workspace's default sandbox selection. */
export async function updateWorkspaceSandbox(
	workspaceId: string,
	selection: SandboxSelection,
	fetcher: typeof fetch = fetch
): Promise<WorkspaceSandbox> {
	const url = workspaceEndpoint(workspaceId, 'sandbox');
	const response = await fetcher(requestUrl(url), {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json', ...authorization() },
		body: JSON.stringify(selection)
	});
	return responseJson<WorkspaceSandbox>(response);
}

/** Describes the profile a selection would enforce for one agent, or `null` when unsandboxed. */
export async function previewSandbox(
	workspaceId: string,
	adapter: SandboxAdapter,
	selection: SandboxSelection,
	fetcher: typeof fetch = fetch
): Promise<EffectiveSandbox | null> {
	const url = workspaceEndpoint(workspaceId, 'sandbox/preview');
	const response = await fetcher(requestUrl(url), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authorization() },
		body: JSON.stringify({ adapter, selection })
	});
	return responseJson<EffectiveSandbox | null>(response);
}

function sessionUrl(path: string): string {
	return `${apiConnection().origin}/api/sessions${path}`;
}

async function sendSessionRequest(
	path: string,
	method: 'POST' | 'PUT' | 'DELETE',
	body: unknown,
	fetcher: typeof fetch
): Promise<void> {
	const response = await fetcher(sessionUrl(path), {
		method,
		headers: body === undefined ? authorization() : { 'Content-Type': 'application/json', ...authorization() },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	if (response.ok) return;
	await responseJson<never>(response);
}

/** Lists live agent sessions, oldest first. */
export async function listSessions(fetcher: typeof fetch = fetch): Promise<AgentSession[]> {
	const response = await fetcher(sessionUrl(''), { headers: authorization() });
	return responseJson<AgentSession[]>(response);
}

/** Lists the workspace's saved Pi sessions, newest first. */
export async function listNativeSessions(
	workspaceId: string,
	fetcher: typeof fetch = fetch
): Promise<NativeSessionList> {
	const url = requestUrl(workspaceEndpoint(workspaceId, 'pi-sessions'));
	const response = await fetcher(url, { headers: authorization() });
	return responseJson<NativeSessionList>(response);
}

/**
 * Starts a Pi session in a registered workspace with the agent's default
 * model. Passing a saved session's ID resumes it instead of starting fresh.
 */
export async function startSession(
	workspaceId: string,
	fetcher: typeof fetch = fetch,
	nativeSessionId: string | null = null
): Promise<AgentSession> {
	const request: StartSessionRequest = { workspace_id: workspaceId, model: null, native_session_id: nativeSessionId };
	const response = await fetcher(sessionUrl(''), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authorization() },
		body: JSON.stringify(request)
	});
	return responseJson<AgentSession>(response);
}

/** Starts work in an idle session. Progress arrives on the event stream. */
export function promptSession(
	sessionId: string,
	message: string,
	images: SessionImage[] = [],
	fetcher: typeof fetch = fetch
): Promise<void> {
	const request: SessionPromptRequest = { message, queue: null, images: images.length > 0 ? images : null };
	return sendSessionRequest(`/${encodeURIComponent(sessionId)}/prompt`, 'POST', request, fetcher);
}

/** Reads the session's earlier prompts for composer recall, newest first. */
export async function getSessionHistory(sessionId: string, fetcher: typeof fetch = fetch): Promise<string[]> {
	const response = await fetcher(sessionUrl(`/${encodeURIComponent(sessionId)}/history`), { headers: authorization() });
	return responseJson<string[]>(response);
}

/** Reads the steering and follow-up messages waiting to be delivered. */
export async function getSessionQueue(sessionId: string, fetcher: typeof fetch = fetch): Promise<SessionMessageQueue> {
	const response = await fetcher(sessionUrl(`/${encodeURIComponent(sessionId)}/queue`), { headers: authorization() });
	return responseJson<SessionMessageQueue>(response);
}

/** Clears the queued messages and returns what the queue held. */
export async function clearSessionQueue(
	sessionId: string,
	fetcher: typeof fetch = fetch
): Promise<SessionMessageQueue> {
	const response = await fetcher(sessionUrl(`/${encodeURIComponent(sessionId)}/queue`), {
		method: 'DELETE',
		headers: authorization()
	});
	return responseJson<SessionMessageQueue>(response);
}

/** Steers the active run or queues a follow-up for after it settles. */
export function queueSessionMessage(
	sessionId: string,
	queue: SessionQueue,
	message: string,
	images: SessionImage[] = [],
	fetcher: typeof fetch = fetch
): Promise<void> {
	const request: SessionMessageRequest = { message, images: images.length > 0 ? images : null };
	const endpoint = queue === 'steer' ? 'steer' : 'follow-up';
	return sendSessionRequest(`/${encodeURIComponent(sessionId)}/${endpoint}`, 'POST', request, fetcher);
}

/** Interrupts the active run without stopping the session. */
export function interruptSession(sessionId: string, fetcher: typeof fetch = fetch): Promise<void> {
	return sendSessionRequest(`/${encodeURIComponent(sessionId)}/interrupt`, 'POST', undefined, fetcher);
}

/** Re-sends the last prompt after an assistant turn that ended in an error. */
export function retrySession(sessionId: string, fetcher: typeof fetch = fetch): Promise<void> {
	return sendSessionRequest(`/${encodeURIComponent(sessionId)}/retry`, 'POST', undefined, fetcher);
}

/** Cancels an automatic retry that is waiting to run. */
export function cancelSessionRetry(sessionId: string, fetcher: typeof fetch = fetch): Promise<void> {
	return sendSessionRequest(`/${encodeURIComponent(sessionId)}/retry`, 'DELETE', undefined, fetcher);
}

/** Stops a session's process. Its final state arrives on the event stream. */
export function stopSession(sessionId: string, fetcher: typeof fetch = fetch): Promise<void> {
	return sendSessionRequest(`/${encodeURIComponent(sessionId)}`, 'DELETE', undefined, fetcher);
}

/** Stores a display name with a live session's saved file. */
export function renameSession(sessionId: string, name: string, fetcher: typeof fetch = fetch): Promise<void> {
	const request: SessionRenameRequest = { name };
	return sendSessionRequest(`/${encodeURIComponent(sessionId)}/name`, 'PUT', request, fetcher);
}

/**
 * Copies a live session's saved file into a new saved session. The live
 * session continues the copy, and the original stays in the saved list.
 */
export async function cloneSession(sessionId: string, fetcher: typeof fetch = fetch): Promise<SessionCloneResult> {
	const response = await fetcher(sessionUrl(`/${encodeURIComponent(sessionId)}/clone`), {
		method: 'POST',
		headers: authorization()
	});
	return responseJson<SessionCloneResult>(response);
}

/**
 * Reads the conversation a live session continues, with the event sequence
 * after which its `session_output` events are newer than the messages.
 */
export async function getSessionMessages(sessionId: string, fetcher: typeof fetch = fetch): Promise<SessionMessages> {
	const response = await fetcher(sessionUrl(`/${encodeURIComponent(sessionId)}/messages`), {
		headers: authorization()
	});
	return responseJson<SessionMessages>(response);
}

/** Reads the entry tree of a live session's persisted file, newest entries kept. */
export async function getSessionTree(sessionId: string, fetcher: typeof fetch = fetch): Promise<SessionTree> {
	const response = await fetcher(sessionUrl(`/${encodeURIComponent(sessionId)}/tree`), { headers: authorization() });
	return responseJson<SessionTree>(response);
}

/** Searches a live session's persisted transcript, newest matches first. */
export async function searchSession(
	sessionId: string,
	query: string,
	limit: number,
	fetcher: typeof fetch = fetch
): Promise<SessionSearchResult> {
	const params = new URLSearchParams({ q: query, limit: String(limit) });
	const response = await fetcher(sessionUrl(`/${encodeURIComponent(sessionId)}/search?${params}`), {
		headers: authorization()
	});
	return responseJson<SessionSearchResult>(response);
}

/**
 * Branches an idle session from an earlier user message. The agent continues
 * in a new session file, and the result carries that message's text.
 */
export async function branchSession(
	sessionId: string,
	entryId: string,
	fetcher: typeof fetch = fetch
): Promise<SessionBranchResult> {
	const request: SessionBranchRequest = { entry_id: entryId };
	const response = await fetcher(sessionUrl(`/${encodeURIComponent(sessionId)}/branch`), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authorization() },
		body: JSON.stringify(request)
	});
	return responseJson<SessionBranchResult>(response);
}

/** Lists the models a live session can select. */
export async function listSessionModels(sessionId: string, fetcher: typeof fetch = fetch): Promise<SessionModel[]> {
	const response = await fetcher(sessionUrl(`/${encodeURIComponent(sessionId)}/models`), { headers: authorization() });
	return responseJson<SessionModel[]>(response);
}

/** Reads a session's context use, token use, and cost. */
export async function getSessionUsage(sessionId: string, fetcher: typeof fetch = fetch): Promise<SessionUsage> {
	const response = await fetcher(sessionUrl(`/${encodeURIComponent(sessionId)}/usage`), { headers: authorization() });
	return responseJson<SessionUsage>(response);
}

/** Lists the slash commands a live session accepts in a prompt. */
export async function listSessionCommands(sessionId: string, fetcher: typeof fetch = fetch): Promise<SessionCommand[]> {
	const response = await fetcher(sessionUrl(`/${encodeURIComponent(sessionId)}/commands`), {
		headers: authorization()
	});
	return responseJson<SessionCommand[]>(response);
}

/**
 * Compacts an idle session's context into a summary. Resolves with Pi's
 * result once it finishes, which can take as long as a model call.
 */
export async function compactSession(
	sessionId: string,
	customInstructions: string | null,
	fetcher: typeof fetch = fetch
): Promise<SessionCompactionResult> {
	const request: SessionCompactRequest = { custom_instructions: customInstructions };
	const response = await fetcher(sessionUrl(`/${encodeURIComponent(sessionId)}/compact`), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authorization() },
		body: JSON.stringify(request)
	});
	return responseJson<SessionCompactionResult>(response);
}

/** Switches an idle session to another model. */
export function selectSessionModel(
	sessionId: string,
	model: SessionModelSelection,
	fetcher: typeof fetch = fetch
): Promise<void> {
	return sendSessionRequest(`/${encodeURIComponent(sessionId)}/model`, 'PUT', model, fetcher);
}

/** Sets the thinking level an idle session uses for later turns. */
export function setSessionThinkingLevel(
	sessionId: string,
	level: SessionThinkingLevel,
	fetcher: typeof fetch = fetch
): Promise<void> {
	const request: SessionThinkingLevelRequest = { level };
	return sendSessionRequest(`/${encodeURIComponent(sessionId)}/thinking-level`, 'PUT', request, fetcher);
}

/** Reads a live session's unanswered extension dialogs, status lines, and widgets. */
export async function getSessionExtensionUi(
	sessionId: string,
	fetcher: typeof fetch = fetch
): Promise<SessionExtensionUi> {
	const response = await fetcher(sessionUrl(`/${encodeURIComponent(sessionId)}/extension-ui`), {
		headers: authorization()
	});
	return responseJson<SessionExtensionUi>(response);
}

/** Answers an unanswered extension dialog. */
export function respondToExtensionUi(
	sessionId: string,
	requestId: string,
	response: ExtensionUiResponse,
	fetcher: typeof fetch = fetch
): Promise<void> {
	return sendSessionRequest(
		`/${encodeURIComponent(sessionId)}/extension-ui/${encodeURIComponent(requestId)}`,
		'POST',
		response,
		fetcher
	);
}

/** Opens the user's shell in a workspace root. */
export async function createTerminal(
	workspaceId: string,
	size: TerminalSize,
	fetcher: typeof fetch = fetch
): Promise<TerminalInfo> {
	const response = await fetcher(`${apiConnection().origin}/api/terminals`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authorization() },
		body: JSON.stringify({ workspace_id: workspaceId, command: null, size })
	});
	return responseJson<TerminalInfo>(response);
}

/** Stops a terminal and waits for its process to exit. */
export async function closeTerminal(terminalId: string, fetcher: typeof fetch = fetch): Promise<TerminalInfo> {
	const response = await fetcher(`${apiConnection().origin}/api/terminals/${encodeURIComponent(terminalId)}`, {
		method: 'DELETE',
		headers: authorization()
	});
	return responseJson<TerminalInfo>(response);
}

/**
 * Builds an authenticated WebSocket handshake. Browsers cannot set WebSocket
 * headers, so the launch token travels as a `pau.bearer.<token>` subprotocol.
 */
function socketHandshake(browserOrigin: string, path: string): { url: URL; protocols: string[] } {
	const { origin, token } = apiConnection();
	const url = new URL(path, origin || browserOrigin);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	return { url, protocols: token === undefined ? ['pau'] : ['pau', `pau.bearer.${token}`] };
}

/** Builds an authenticated browser WebSocket handshake for the event stream. */
export function resolveEventSocket(browserOrigin: string, after?: number): { url: string; protocols: string[] } {
	const { url, protocols } = socketHandshake(browserOrigin, '/api/events');
	if (after !== undefined) url.searchParams.set('after', String(after));
	return { url: url.href, protocols };
}

/** Builds an authenticated browser WebSocket handshake for one terminal's byte stream. */
export function resolveTerminalSocket(browserOrigin: string, terminalId: string): { url: string; protocols: string[] } {
	const path = `/api/terminals/${encodeURIComponent(terminalId)}/stream`;
	const { url, protocols } = socketHandshake(browserOrigin, path);
	return { url: url.href, protocols };
}
