import type { VersionResponse } from '@stormlightlabs/pau-protocol';

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

/** Reads the running backend version through the shared HTTP API. */
export async function getBackendVersion(search: string, fetcher: typeof fetch = fetch): Promise<VersionResponse> {
	const response = await fetcher(`${resolveApiOrigin(search)}/api/version`, {
		headers: authorization(resolveApiToken(search))
	});
	if (!response.ok) throw new Error(`The Pau backend returned HTTP ${response.status}.`);
	return (await response.json()) as VersionResponse;
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
