import type {
	AgentSession,
	DiagnosticBundle,
	DiagnosticLevel,
	EffectiveSandbox,
	SandboxAdapter,
	SandboxSelection,
	FileContent,
	FileEntry,
	FileSearchMatch,
	GitDiff,
	GitStatus,
	SessionMessageRequest,
	SessionPromptRequest,
	SessionQueue,
	StartSessionRequest,
	TerminalInfo,
	TerminalSize,
	VersionResponse,
	Workspace,
	WorkspaceSandbox
} from '@stormlightlabs/pau-protocol';

const DESKTOP_PORT_PARAMETER = 'pau-api-port';
const DESKTOP_TOKEN_PARAMETER = 'pau-api-token';

/** Resolves the API origin injected by the desktop lifecycle owner. */
export function resolveApiOrigin(search: string): string {
	const port = new URLSearchParams(search).get(DESKTOP_PORT_PARAMETER);
	if (port === null) return '';
	if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65_535) {
		throw new Error('The desktop API port is invalid.');
	}
	return `http://127.0.0.1:${port}`;
}

/** Resolves the per-launch token injected into the desktop webview. */
export function resolveApiToken(search: string): string | undefined {
	const token = new URLSearchParams(search).get(DESKTOP_TOKEN_PARAMETER);
	if (token === null) return undefined;
	if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) {
		throw new Error('The desktop API token is invalid.');
	}
	return token;
}

function authorization(token: string | undefined): HeadersInit | undefined {
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
	search: string,
	workspaceId: string,
	endpoint: 'file' | 'files' | 'search' | 'git/diff' | 'git/status' | 'sandbox' | 'sandbox/preview'
): URL {
	const origin = resolveApiOrigin(search) || 'https://pau.local';
	return new URL(`/api/workspaces/${encodeURIComponent(workspaceId)}/${endpoint}`, origin);
}

function requestUrl(url: URL, search: string): string {
	return resolveApiOrigin(search) ? url.href : `${url.pathname}${url.search}`;
}

/** Reads the running backend version through the shared HTTP API. */
export async function getBackendVersion(search: string, fetcher: typeof fetch = fetch): Promise<VersionResponse> {
	const response = await fetcher(`${resolveApiOrigin(search)}/api/version`, {
		headers: authorization(resolveApiToken(search))
	});
	return responseJson<VersionResponse>(response);
}

/** Reads the current redacted diagnostics preview. */
export async function getDiagnostics(search: string, fetcher: typeof fetch = fetch): Promise<DiagnosticBundle> {
	const response = await fetcher(`${resolveApiOrigin(search)}/api/diagnostics`, {
		headers: authorization(resolveApiToken(search))
	});
	return responseJson<DiagnosticBundle>(response);
}

/** Changes observation-only release diagnostic settings. */
export async function updateDiagnosticSettings(
	search: string,
	enabled: boolean,
	minLevel: DiagnosticLevel,
	fetcher: typeof fetch = fetch
): Promise<DiagnosticBundle> {
	const response = await fetcher(`${resolveApiOrigin(search)}/api/diagnostics/settings`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json', ...authorization(resolveApiToken(search)) },
		body: JSON.stringify({ enabled, min_level: minLevel })
	});
	return responseJson<DiagnosticBundle>(response);
}

/** Enables temporary payload-shape tracing. */
export async function startPayloadTracing(
	search: string,
	durationSeconds: number,
	fetcher: typeof fetch = fetch
): Promise<DiagnosticBundle> {
	const response = await fetcher(`${resolveApiOrigin(search)}/api/diagnostics/payload-tracing`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authorization(resolveApiToken(search)) },
		body: JSON.stringify({ duration_seconds: durationSeconds })
	});
	return responseJson<DiagnosticBundle>(response);
}

/** Writes the diagnostic revision that the operator reviewed. */
export async function exportDiagnostics(
	search: string,
	destination: string,
	reviewedRevision: number,
	fetcher: typeof fetch = fetch
): Promise<{ written: boolean }> {
	const response = await fetcher(`${resolveApiOrigin(search)}/api/diagnostics/export`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authorization(resolveApiToken(search)) },
		body: JSON.stringify({ destination, reviewed_revision: reviewedRevision })
	});
	return responseJson<{ written: boolean }>(response);
}

/** Lists workspace registrations available to the current backend. */
export async function listWorkspaces(search: string, fetcher: typeof fetch = fetch): Promise<Workspace[]> {
	const response = await fetcher(`${resolveApiOrigin(search)}/api/workspaces`, {
		headers: authorization(resolveApiToken(search))
	});
	return responseJson<Workspace[]>(response);
}

/** Lists one directory in a registered workspace. */
export async function listWorkspaceFiles(
	search: string,
	workspaceId: string,
	path: string,
	options: { includeHidden: boolean; includeIgnored: boolean },
	fetcher: typeof fetch = fetch
): Promise<FileEntry[]> {
	const url = workspaceEndpoint(search, workspaceId, 'files');
	if (path) url.searchParams.set('path', path);
	if (options.includeHidden) url.searchParams.set('include_hidden', 'true');
	if (options.includeIgnored) url.searchParams.set('include_ignored', 'true');
	const response = await fetcher(requestUrl(url, search), { headers: authorization(resolveApiToken(search)) });
	return responseJson<FileEntry[]>(response);
}

/** Reads one UTF-8 workspace file for the built-in editor. */
export async function readWorkspaceFile(
	search: string,
	workspaceId: string,
	path: string,
	fetcher: typeof fetch = fetch
): Promise<FileContent> {
	const url = workspaceEndpoint(search, workspaceId, 'file');
	url.searchParams.set('path', path);
	const response = await fetcher(requestUrl(url, search), { headers: authorization(resolveApiToken(search)) });
	return responseJson<FileContent>(response);
}

/** Writes one workspace file if its revision still matches the editor's copy. */
export async function writeWorkspaceFile(
	search: string,
	workspaceId: string,
	path: string,
	content: string,
	expectedRevision: string,
	fetcher: typeof fetch = fetch
): Promise<FileContent> {
	const url = workspaceEndpoint(search, workspaceId, 'file');
	const response = await fetcher(requestUrl(url, search), {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json', ...authorization(resolveApiToken(search)) },
		body: JSON.stringify({ path, content, expected_revision: expectedRevision })
	});
	return responseJson<FileContent>(response);
}

/** Searches visible UTF-8 files in a registered workspace. */
export async function searchWorkspaceFiles(
	search: string,
	workspaceId: string,
	query: string,
	options: { includeHidden: boolean; includeIgnored: boolean },
	fetcher: typeof fetch = fetch
): Promise<FileSearchMatch[]> {
	const url = workspaceEndpoint(search, workspaceId, 'search');
	url.searchParams.set('query', query);
	url.searchParams.set('limit', '1000');
	if (options.includeHidden) url.searchParams.set('include_hidden', 'true');
	if (options.includeIgnored) url.searchParams.set('include_ignored', 'true');
	const response = await fetcher(requestUrl(url, search), { headers: authorization(resolveApiToken(search)) });
	return responseJson<FileSearchMatch[]>(response);
}

/** Reads branch and changed-file state for a registered workspace. */
export async function getWorkspaceGitStatus(
	search: string,
	workspaceId: string,
	fetcher: typeof fetch = fetch
): Promise<GitStatus> {
	const url = workspaceEndpoint(search, workspaceId, 'git/status');
	const response = await fetcher(requestUrl(url, search), { headers: authorization(resolveApiToken(search)) });
	return responseJson<GitStatus>(response);
}

/** Reads one changed file against Git `HEAD`. */
export async function getWorkspaceGitDiff(
	search: string,
	workspaceId: string,
	path: string,
	fetcher: typeof fetch = fetch
): Promise<GitDiff> {
	const url = workspaceEndpoint(search, workspaceId, 'git/diff');
	url.searchParams.set('path', path);
	const response = await fetcher(requestUrl(url, search), { headers: authorization(resolveApiToken(search)) });
	return responseJson<GitDiff>(response);
}

/** Reads a workspace's default sandbox selection for new agent sessions. */
export async function getWorkspaceSandbox(
	search: string,
	workspaceId: string,
	fetcher: typeof fetch = fetch
): Promise<WorkspaceSandbox> {
	const url = workspaceEndpoint(search, workspaceId, 'sandbox');
	const response = await fetcher(requestUrl(url, search), { headers: authorization(resolveApiToken(search)) });
	return responseJson<WorkspaceSandbox>(response);
}

/** Validates and stores a workspace's default sandbox selection. */
export async function updateWorkspaceSandbox(
	search: string,
	workspaceId: string,
	selection: SandboxSelection,
	fetcher: typeof fetch = fetch
): Promise<WorkspaceSandbox> {
	const url = workspaceEndpoint(search, workspaceId, 'sandbox');
	const response = await fetcher(requestUrl(url, search), {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json', ...authorization(resolveApiToken(search)) },
		body: JSON.stringify(selection)
	});
	return responseJson<WorkspaceSandbox>(response);
}

/** Describes the profile a selection would enforce for one agent, or `null` when unsandboxed. */
export async function previewSandbox(
	search: string,
	workspaceId: string,
	adapter: SandboxAdapter,
	selection: SandboxSelection,
	fetcher: typeof fetch = fetch
): Promise<EffectiveSandbox | null> {
	const url = workspaceEndpoint(search, workspaceId, 'sandbox/preview');
	const response = await fetcher(requestUrl(url, search), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authorization(resolveApiToken(search)) },
		body: JSON.stringify({ adapter, selection })
	});
	return responseJson<EffectiveSandbox | null>(response);
}

function sessionUrl(search: string, path: string): string {
	return `${resolveApiOrigin(search)}/api/sessions${path}`;
}

async function sendSessionRequest(
	search: string,
	path: string,
	method: 'POST' | 'DELETE',
	body: unknown,
	fetcher: typeof fetch
): Promise<void> {
	const response = await fetcher(sessionUrl(search, path), {
		method,
		headers:
			body === undefined
				? authorization(resolveApiToken(search))
				: { 'Content-Type': 'application/json', ...authorization(resolveApiToken(search)) },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	if (response.ok) return;
	await responseJson<never>(response);
}

/** Lists live agent sessions, oldest first. */
export async function listSessions(search: string, fetcher: typeof fetch = fetch): Promise<AgentSession[]> {
	const response = await fetcher(sessionUrl(search, ''), { headers: authorization(resolveApiToken(search)) });
	return responseJson<AgentSession[]>(response);
}

/** Starts a Pi session in a registered workspace with the agent's default model. */
export async function startSession(
	search: string,
	workspaceId: string,
	fetcher: typeof fetch = fetch
): Promise<AgentSession> {
	const request: StartSessionRequest = { workspace_id: workspaceId, model: null };
	const response = await fetcher(sessionUrl(search, ''), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authorization(resolveApiToken(search)) },
		body: JSON.stringify(request)
	});
	return responseJson<AgentSession>(response);
}

/** Starts work in an idle session. Progress arrives on the event stream. */
export function promptSession(
	search: string,
	sessionId: string,
	message: string,
	fetcher: typeof fetch = fetch
): Promise<void> {
	const request: SessionPromptRequest = { message, queue: null };
	return sendSessionRequest(search, `/${encodeURIComponent(sessionId)}/prompt`, 'POST', request, fetcher);
}

/** Steers the active run or queues a follow-up for after it settles. */
export function queueSessionMessage(
	search: string,
	sessionId: string,
	queue: SessionQueue,
	message: string,
	fetcher: typeof fetch = fetch
): Promise<void> {
	const request: SessionMessageRequest = { message };
	const endpoint = queue === 'steer' ? 'steer' : 'follow-up';
	return sendSessionRequest(search, `/${encodeURIComponent(sessionId)}/${endpoint}`, 'POST', request, fetcher);
}

/** Interrupts the active run without stopping the session. */
export function interruptSession(search: string, sessionId: string, fetcher: typeof fetch = fetch): Promise<void> {
	return sendSessionRequest(search, `/${encodeURIComponent(sessionId)}/interrupt`, 'POST', undefined, fetcher);
}

/** Stops a session's process. Its final state arrives on the event stream. */
export function stopSession(search: string, sessionId: string, fetcher: typeof fetch = fetch): Promise<void> {
	return sendSessionRequest(search, `/${encodeURIComponent(sessionId)}`, 'DELETE', undefined, fetcher);
}

/** Opens the user's shell in a workspace root. */
export async function createTerminal(
	search: string,
	workspaceId: string,
	size: TerminalSize,
	fetcher: typeof fetch = fetch
): Promise<TerminalInfo> {
	const response = await fetcher(`${resolveApiOrigin(search)}/api/terminals`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authorization(resolveApiToken(search)) },
		body: JSON.stringify({ workspace_id: workspaceId, command: null, size })
	});
	return responseJson<TerminalInfo>(response);
}

/** Stops a terminal and waits for its process to exit. */
export async function closeTerminal(
	search: string,
	terminalId: string,
	fetcher: typeof fetch = fetch
): Promise<TerminalInfo> {
	const response = await fetcher(`${resolveApiOrigin(search)}/api/terminals/${encodeURIComponent(terminalId)}`, {
		method: 'DELETE',
		headers: authorization(resolveApiToken(search))
	});
	return responseJson<TerminalInfo>(response);
}

/**
 * Builds an authenticated WebSocket handshake. Browsers cannot set WebSocket
 * headers, so the launch token travels as a `pau.bearer.<token>` subprotocol.
 */
function socketHandshake(search: string, browserOrigin: string, path: string): { url: URL; protocols: string[] } {
	const token = resolveApiToken(search);
	const url = new URL(path, resolveApiOrigin(search) || browserOrigin);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	return { url, protocols: token === undefined ? ['pau'] : ['pau', `pau.bearer.${token}`] };
}

/** Builds an authenticated browser WebSocket handshake for the event stream. */
export function resolveEventSocket(
	search: string,
	browserOrigin: string,
	after?: number
): { url: string; protocols: string[] } {
	const { url, protocols } = socketHandshake(search, browserOrigin, '/api/events');
	if (after !== undefined) url.searchParams.set('after', String(after));
	return { url: url.href, protocols };
}

/** Builds an authenticated browser WebSocket handshake for one terminal's byte stream. */
export function resolveTerminalSocket(
	search: string,
	browserOrigin: string,
	terminalId: string
): { url: string; protocols: string[] } {
	const path = `/api/terminals/${encodeURIComponent(terminalId)}/stream`;
	const { url, protocols } = socketHandshake(search, browserOrigin, path);
	return { url: url.href, protocols };
}
