import type { UiPreferences } from '@stormlightlabs/pau-protocol';
import { describe, expect, test, vi } from 'vitest';

import { FakeEventSocket } from './fake-event-socket';
import { PanePreferences } from './pane-preferences.svelte';

function preferences(contextRail: number | null, inspector: number | null): UiPreferences {
	return {
		version: 1,
		theme: 'system',
		pane_widths: { context_rail: contextRail, inspector }
	} as unknown as UiPreferences;
}

function json(body: unknown): Response {
	return Response.json(body);
}

/** Serves one stored document, the way `/api/preferences` does. */
function backend(initial: UiPreferences) {
	let stored = initial;
	const puts: UiPreferences[] = [];
	const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
		if (init?.method === 'PUT') {
			stored = JSON.parse(init.body as string) as UiPreferences;
			puts.push(stored);
		}
		return json(stored);
	}) as unknown as typeof fetch;
	return {
		fetcher,
		puts,
		set: (next: UiPreferences) => {
			stored = next;
		}
	};
}

describe('pane preferences', () => {
	test('applies the saved widths on load', async () => {
		const server = backend(preferences(300, null));
		const panes = new PanePreferences({ fetcher: server.fetcher });

		await panes.load();

		expect(panes.widths).toEqual({ contextRail: 300, inspector: null });
	});

	test('saves once after resizing stops and keeps the other preferences', async () => {
		vi.useFakeTimers();
		const server = backend(preferences(null, null));
		const panes = new PanePreferences({ fetcher: server.fetcher, saveDelayMs: 100 });
		await panes.load();

		panes.resize({ contextRail: 280, inspector: null });
		panes.resize({ contextRail: 310, inspector: 420 });
		expect(server.puts).toEqual([]);
		await vi.advanceTimersByTimeAsync(100);
		vi.useRealTimers();

		expect(server.puts).toEqual([{ ...preferences(310, 420) }]);
	});

	test('reloads widths when another window changes them', async () => {
		const server = backend(preferences(null, null));
		const sockets: FakeEventSocket[] = [];
		const panes = new PanePreferences({
			fetcher: server.fetcher,
			browserOrigin: 'http://localhost',
			socketFactory: (url) => {
				const socket = new FakeEventSocket(url);
				sockets.push(socket);
				return socket;
			}
		});
		panes.connect();
		await vi.waitFor(() => expect(sockets).toHaveLength(1));

		server.set(preferences(350, 500));
		sockets[0].receive({
			type: 'event',
			event: {
				sequence: 1,
				timestamp: '2026-04-01T12:00:00Z',
				workspace_id: null,
				session_id: null,
				kind: 'preferences_changed',
				payload: ''
			}
		});

		await vi.waitFor(() => expect(panes.widths).toEqual({ contextRail: 350, inspector: 500 }));
		panes.stop();
	});

	test('does not replace a pending resize with an older saved value', async () => {
		const server = backend(preferences(200, null));
		const panes = new PanePreferences({ fetcher: server.fetcher, saveDelayMs: 10_000 });
		await panes.load();

		panes.resize({ contextRail: 260, inspector: null });
		await panes.load();

		expect(panes.widths.contextRail).toBe(260);
		panes.stop();
	});
});
