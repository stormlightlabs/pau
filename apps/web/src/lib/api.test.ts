import { describe, expect, test, vi } from 'vitest';

import { getBackendVersion, resolveApiOrigin } from './api';

describe('resolveApiOrigin', () => {
	test('uses relative API paths in a development browser', () => {
		expect(resolveApiOrigin('')).toBe('');
	});

	test('uses the ephemeral desktop backend port', () => {
		expect(resolveApiOrigin('?pau-api-port=43127')).toBe('http://127.0.0.1:43127');
	});

	test.each(['abc', '0', '0x20', '65536'])('rejects an invalid desktop port: %s', (port) => {
		expect(() => resolveApiOrigin(`?pau-api-port=${port}`)).toThrow('desktop API port is invalid');
	});
});

test('reads the same version response through either API origin', async () => {
	const fetcher = vi
		.fn<typeof fetch>()
		.mockImplementation(async () => Response.json({ version: '0.1.0' }, { status: 200 }));

	await expect(getBackendVersion('', fetcher)).resolves.toEqual({ version: '0.1.0' });
	await expect(getBackendVersion('?pau-api-port=43127', fetcher)).resolves.toEqual({ version: '0.1.0' });
	expect(fetcher).toHaveBeenNthCalledWith(1, '/api/version');
	expect(fetcher).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:43127/api/version');
});
