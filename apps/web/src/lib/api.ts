import type {
	FileContent,
	FileEntry,
	FileSearchMatch,
	GitStatus,
	VersionResponse,
	Workspace
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
	endpoint: 'file' | 'files' | 'search' | 'git/status'
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

/** Builds an authenticated browser WebSocket handshake for the event stream. */
export function resolveEventSocket(
	search: string,
	browserOrigin: string,
	after?: number
): { url: string; protocols: string[] } {
	const token = resolveApiToken(search);
	const apiOrigin = resolveApiOrigin(search) || browserOrigin;
	const url = new URL('/api/events', apiOrigin);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	if (after !== undefined) url.searchParams.set('after', String(after));
	return { url: url.href, protocols: token === undefined ? ['pau'] : ['pau', `pau.bearer.${token}`] };
}
