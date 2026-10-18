import { afterEach, describe, expect, test, vi } from 'vitest';

import {
	apiConnection,
	DESKTOP_CONNECTION_GLOBAL,
	exportDiagnostics,
	getBackendVersion,
	getDiagnostics,
	getWorkspaceGitDiff,
	getWorkspaceGitStatus,
	getWorkspaceSandbox,
	listWorkspaceFiles,
	PauApiError,
	previewSandbox,
	readWorkspaceFile,
	resolveEventSocket,
	resolveTerminalSocket,
	searchSession,
	searchWorkspaceFiles,
	startPayloadTracing,
	updateDiagnosticSettings,
	updateWorkspaceSandbox,
	writeWorkspaceFile
} from './api';

const TOKEN = '0123456789abcdef0123456789abcdef';
const DESKTOP_CONNECTION = { apiOrigin: 'http://127.0.0.1:43127', token: TOKEN };

/** Defines the connection the way the desktop shell's launch script does. */
function launchDesktop(connection: unknown = DESKTOP_CONNECTION) {
	vi.stubGlobal(DESKTOP_CONNECTION_GLOBAL, Object.freeze(connection));
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('API connection', () => {
	test('uses same-origin paths without a token in a development browser', () => {
		expect(apiConnection()).toEqual({ origin: '', token: undefined });
	});

	test('uses the backend origin and launch token the desktop shell injects', () => {
		launchDesktop();
		expect(apiConnection()).toEqual({ origin: 'http://127.0.0.1:43127', token: TOKEN });
	});

	test.each([
		'http://127.0.0.1:0',
		'http://127.0.0.1:65536',
		'http://127.0.0.1:0x20',
		'http://localhost:43127',
		'https://127.0.0.1:43127',
		'http://127.0.0.1:43127/api',
		43_127
	])('rejects an invalid desktop origin: %s', (apiOrigin) => {
		launchDesktop({ apiOrigin, token: TOKEN });
		expect(() => apiConnection()).toThrow('desktop API origin is invalid');
	});

	test.each(['short', 'token with spaces', '0123456789abcdef0123456789abcde!', undefined])(
		'rejects an invalid desktop token: %s',
		(token) => {
			launchDesktop({ apiOrigin: 'http://127.0.0.1:43127', token });
			expect(() => apiConnection()).toThrow('desktop API token is invalid');
		}
	);

	test('rejects a connection that is not an object', () => {
		launchDesktop(null);
		expect(() => apiConnection()).toThrow('desktop API origin is invalid');
	});
});

test('authenticates desktop HTTP requests with the launch token', async () => {
	const fetcher = vi
		.fn<typeof fetch>()
		.mockImplementation(async () => Response.json({ version: '0.1.0' }, { status: 200 }));

	await expect(getBackendVersion(fetcher)).resolves.toEqual({ version: '0.1.0' });
	launchDesktop();
	await expect(getBackendVersion(fetcher)).resolves.toEqual({ version: '0.1.0' });
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

	launchDesktop();
	await expect(getDiagnostics(fetcher)).resolves.toEqual(bundle);
	await updateDiagnosticSettings(true, 'warn', fetcher);
	await startPayloadTracing(300, fetcher);
	await exportDiagnostics('/tmp/pau diagnostics.json', 7, fetcher);

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

test('searches a session transcript with an encoded query and limit', async () => {
	launchDesktop();
	const fetcher = vi
		.fn<typeof fetch>()
		.mockImplementation(async () => Response.json({ matches: [], truncated: false }));

	await expect(searchSession('session / 1', 'a & b', 50, fetcher)).resolves.toEqual({ matches: [], truncated: false });

	expect(fetcher).toHaveBeenCalledWith(
		'http://127.0.0.1:43127/api/sessions/session%20%2F%201/search?q=a+%26+b&limit=50',
		{ headers: { Authorization: `Bearer ${TOKEN}` } }
	);
});

test('lists and searches workspace files with traversal options', async () => {
	const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json([]));

	await listWorkspaceFiles('workspace / one', 'src/lib', { includeHidden: true, includeIgnored: false }, fetcher);
	launchDesktop();
	await searchWorkspaceFiles(
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

	await expect(readWorkspaceFile('workspace / one', 'src/example.ts', fetcher)).resolves.toEqual(opened);
	await expect(writeWorkspaceFile('workspace / one', 'src/example.ts', 'after', 'one', fetcher)).resolves.toEqual(
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

	await expect(getWorkspaceGitStatus('workspace / one', fetcher)).resolves.toEqual(status);
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
	await expect(getWorkspaceGitDiff('workspace / one', 'src/example.ts', fetcher)).resolves.toEqual(diff);
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
		await listWorkspaceFiles('workspace', '', { includeHidden: false, includeIgnored: false }, fetcher);
	} catch (caught) {
		error = caught;
	}

	expect(error).toBeInstanceOf(PauApiError);
	expect(error).toEqual(
		expect.objectContaining({ code: 'permission_denied', message: 'workspace file access failed', status: 403 })
	);
});

test('configures browser and desktop WebSocket handshakes', () => {
	expect(resolveEventSocket('http://localhost:5173')).toEqual({
		url: 'ws://localhost:5173/api/events',
		protocols: ['pau']
	});
	expect(resolveEventSocket('http://localhost:5173', 42)).toEqual({
		url: 'ws://localhost:5173/api/events?after=42',
		protocols: ['pau']
	});
	launchDesktop();
	expect(resolveEventSocket('http://localhost:5173')).toEqual({
		url: 'ws://127.0.0.1:43127/api/events',
		protocols: ['pau', `pau.bearer.${TOKEN}`]
	});
	expect(resolveTerminalSocket('http://localhost:5173', 'a/b')).toEqual({
		url: 'ws://127.0.0.1:43127/api/terminals/a%2Fb/stream',
		protocols: ['pau', `pau.bearer.${TOKEN}`]
	});
});

describe('workspace sandbox API', () => {
	test('reads, stores, and previews the workspace selection with the launch token', async () => {
		const selection = { mode: 'unsandboxed' } as const;
		const fetcher = vi.fn<typeof fetch>(async () => Response.json({ selection, unavailable: null }, { status: 200 }));
		launchDesktop();
		await getWorkspaceSandbox('work space', fetcher);
		await updateWorkspaceSandbox('work space', selection, fetcher);
		await previewSandbox('work space', 'claude', selection, fetcher);

		const calls = fetcher.mock.calls.map(([url, init]) => [String(url), init?.method ?? 'GET', init?.body]);
		expect(calls).toEqual([
			['http://127.0.0.1:43127/api/workspaces/work%20space/sandbox', 'GET', undefined],
			['http://127.0.0.1:43127/api/workspaces/work%20space/sandbox', 'PUT', JSON.stringify(selection)],
			[
				'http://127.0.0.1:43127/api/workspaces/work%20space/sandbox/preview',
				'POST',
				JSON.stringify({ adapter: 'claude', selection })
			]
		]);
		for (const [, init] of fetcher.mock.calls) {
			expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`);
		}
	});

	test('reports an invalid grant with its backend code', async () => {
		const fetcher = vi.fn<typeof fetch>(async () =>
			Response.json({ code: 'invalid_sandbox', message: '"x" is not a host or host:port' }, { status: 400 })
		);
		launchDesktop();
		await expect(updateWorkspaceSandbox('w', { mode: 'unsandboxed' }, fetcher)).rejects.toMatchObject({
			status: 400,
			code: 'invalid_sandbox'
		});
	});
});
