import { describe, expect, test, vi } from 'vitest';

import { getBackendVersion, resolveApiOrigin, resolveApiToken, resolveEventSocket } from './api';

const TOKEN = '0123456789abcdef0123456789abcdef';
const DESKTOP_SEARCH = `?pau-api-port=43127&pau-api-token=${TOKEN}`;

describe('desktop API configuration', () => {
	test('uses relative API paths in a development browser', () => {
		expect(resolveApiOrigin('')).toBe('');
		expect(resolveApiToken('')).toBeUndefined();
	});

	test('uses the ephemeral desktop backend port and launch token', () => {
		expect(resolveApiOrigin(DESKTOP_SEARCH)).toBe('http://127.0.0.1:43127');
		expect(resolveApiToken(DESKTOP_SEARCH)).toBe(TOKEN);
	});

	test.each(['abc', '0', '0x20', '65536'])('rejects an invalid desktop port: %s', (port) => {
		expect(() => resolveApiOrigin(`?pau-api-port=${port}`)).toThrow('desktop API port is invalid');
	});

	test.each(['short', 'token with spaces', '0123456789abcdef0123456789abcde!'])(
		'rejects an invalid desktop token: %s',
		(token) => {
			expect(() => resolveApiToken(`?pau-api-token=${token}`)).toThrow('desktop API token is invalid');
		}
	);
});

test('authenticates desktop HTTP requests with the launch token', async () => {
	const fetcher = vi
		.fn<typeof fetch>()
		.mockImplementation(async () => Response.json({ version: '0.1.0' }, { status: 200 }));

	await expect(getBackendVersion('', fetcher)).resolves.toEqual({ version: '0.1.0' });
	await expect(getBackendVersion(DESKTOP_SEARCH, fetcher)).resolves.toEqual({ version: '0.1.0' });
	expect(fetcher).toHaveBeenNthCalledWith(1, '/api/version', { headers: undefined });
	expect(fetcher).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:43127/api/version', {
		headers: { Authorization: `Bearer ${TOKEN}` }
	});
});

test('configures browser and desktop WebSocket handshakes', () => {
	expect(resolveEventSocket('', 'http://localhost:5173')).toEqual({
		url: 'ws://localhost:5173/api/events',
		protocols: ['pau']
	});
	expect(resolveEventSocket(DESKTOP_SEARCH, 'http://localhost:5173')).toEqual({
		url: 'ws://127.0.0.1:43127/api/events',
		protocols: ['pau', `pau.bearer.${TOKEN}`]
	});
	expect(resolveEventSocket('', 'http://localhost:5173', 42)).toEqual({
		url: 'ws://localhost:5173/api/events?after=42',
		protocols: ['pau']
	});
});
