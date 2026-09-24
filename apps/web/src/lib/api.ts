import type { VersionResponse } from '@stormlightlabs/pau-protocol';

const DESKTOP_PORT_PARAMETER = 'pau-api-port';

/** Resolves the API origin injected by the desktop lifecycle owner. */
export function resolveApiOrigin(search: string): string {
	const port = new URLSearchParams(search).get(DESKTOP_PORT_PARAMETER);
	if (port === null) return '';
	if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65_535) {
		throw new Error('The desktop API port is invalid.');
	}
	return `http://127.0.0.1:${port}`;
}

/** Reads the running backend version through the shared HTTP API. */
export async function getBackendVersion(search: string, fetcher: typeof fetch = fetch): Promise<VersionResponse> {
	const response = await fetcher(`${resolveApiOrigin(search)}/api/version`);
	if (!response.ok) throw new Error(`The Pau backend returned HTTP ${response.status}.`);
	return (await response.json()) as VersionResponse;
}
