import { describe, expect, test, vi } from 'vitest';

import {
	exportDiagnostics,
	getBackendVersion,
	getDiagnostics,
	getWorkspaceGitDiff,
	getWorkspaceGitStatus,
	listWorkspaceFiles,
	PauApiError,
	readWorkspaceFile,
	resolveApiOrigin,
	resolveApiToken,
	resolveEventSocket,
	searchWorkspaceFiles,
	startPayloadTracing,
	updateDiagnosticSettings,
	writeWorkspaceFile
} from './api';

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

test('controls and exports release diagnostics through authenticated requests', async () => {
	const bundle = {
		schema_version: 1,
		frontend_version: '0.1.0',
		backend_version: '0.1.0',
		dependencies: {},
		adapters: [],
		transports: [],
		settings: { enabled: true, min_level: 'warn', payload_tracing: false, payload_tracing_expires_at: null },
		records: [],
		dropped_records: 0,
		revision: 7
	};
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(Response.json(bundle))
		.mockResolvedValueOnce(Response.json(bundle))
		.mockResolvedValueOnce(Response.json(bundle))
		.mockResolvedValueOnce(Response.json({ written: true }));

	await expect(getDiagnostics(DESKTOP_SEARCH, fetcher)).resolves.toEqual(bundle);
	await updateDiagnosticSettings(DESKTOP_SEARCH, true, 'warn', fetcher);
	await startPayloadTracing(DESKTOP_SEARCH, 300, fetcher);
	await exportDiagnostics(DESKTOP_SEARCH, '/tmp/pau diagnostics.json', 7, fetcher);

	expect(fetcher).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:43127/api/diagnostics/settings', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
		body: JSON.stringify({ enabled: true, min_level: 'warn' })
	});
	expect(fetcher).toHaveBeenNthCalledWith(3, 'http://127.0.0.1:43127/api/diagnostics/payload-tracing', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
		body: JSON.stringify({ duration_seconds: 300 })
	});
	expect(fetcher).toHaveBeenNthCalledWith(4, 'http://127.0.0.1:43127/api/diagnostics/export', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
		body: JSON.stringify({ destination: '/tmp/pau diagnostics.json', reviewed_revision: 7 })
	});
});

test('lists and searches workspace files with traversal options', async () => {
	const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json([]));

	await listWorkspaceFiles('', 'workspace / one', 'src/lib', { includeHidden: true, includeIgnored: false }, fetcher);
	await searchWorkspaceFiles(
		DESKTOP_SEARCH,
		'workspace / one',
		'needle & thread',
		{ includeHidden: false, includeIgnored: true },
		fetcher
	);

	expect(fetcher).toHaveBeenNthCalledWith(
		1,
		'/api/workspaces/workspace%20%2F%20one/files?path=src%2Flib&include_hidden=true',
		{ headers: undefined }
	);
	expect(fetcher).toHaveBeenNthCalledWith(
		2,
		'http://127.0.0.1:43127/api/workspaces/workspace%20%2F%20one/search?query=needle+%26+thread&limit=1000&include_ignored=true',
		{ headers: { Authorization: `Bearer ${TOKEN}` } }
	);
});

test('reads and writes workspace editor files with revision checks', async () => {
	const opened = { path: 'src/example.ts', content: 'before', revision: 'one', writable: true };
	const saved = { ...opened, content: 'after', revision: 'two' };
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(Response.json(opened))
		.mockResolvedValueOnce(Response.json(saved));

	await expect(readWorkspaceFile('', 'workspace / one', 'src/example.ts', fetcher)).resolves.toEqual(opened);
	await expect(writeWorkspaceFile('', 'workspace / one', 'src/example.ts', 'after', 'one', fetcher)).resolves.toEqual(
		saved
	);
	expect(fetcher).toHaveBeenNthCalledWith(1, '/api/workspaces/workspace%20%2F%20one/file?path=src%2Fexample.ts', {
		headers: undefined
	});
	expect(fetcher).toHaveBeenNthCalledWith(2, '/api/workspaces/workspace%20%2F%20one/file', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ path: 'src/example.ts', content: 'after', expected_revision: 'one' })
	});
});

test('reads workspace Git status and changed-file content', async () => {
	const status = { repository: true, branch: 'main', head: 'abc', detached: false, files: [] };
	const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(status));

	await expect(getWorkspaceGitStatus('', 'workspace / one', fetcher)).resolves.toEqual(status);
	expect(fetcher).toHaveBeenCalledWith('/api/workspaces/workspace%20%2F%20one/git/status', { headers: undefined });

	const diff = {
		path: 'src/example.ts',
		previous_path: null,
		old_content: 'before',
		new_content: 'after',
		binary: false,
		too_large: false
	};
	fetcher.mockImplementationOnce(async () => Response.json(diff));
	await expect(getWorkspaceGitDiff('', 'workspace / one', 'src/example.ts', fetcher)).resolves.toEqual(diff);
	expect(fetcher).toHaveBeenLastCalledWith('/api/workspaces/workspace%20%2F%20one/git/diff?path=src%2Fexample.ts', {
		headers: undefined
	});
});

test('preserves workspace API error codes for user-facing states', async () => {
	const fetcher = vi
		.fn<typeof fetch>()
		.mockImplementation(async () =>
			Response.json({ code: 'permission_denied', message: 'workspace file access failed' }, { status: 403 })
		);

	let error: unknown;
	try {
		await listWorkspaceFiles('', 'workspace', '', { includeHidden: false, includeIgnored: false }, fetcher);
	} catch (caught) {
		error = caught;
	}

	expect(error).toBeInstanceOf(PauApiError);
	expect(error).toEqual(
		expect.objectContaining({ code: 'permission_denied', message: 'workspace file access failed', status: 403 })
	);
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
