import type { MotionPreference, UiPreferences } from '@stormlightlabs/pau-protocol';
import { describe, expect, test, vi } from 'vitest';

import { FakeEventSocket } from './fake-event-socket';
import { InterfacePreferences } from './interface-preferences.svelte';

function preferences(
	contextRail: number | null,
	inspector: number | null,
	motion: MotionPreference = 'system'
): UiPreferences {
	return {
		version: 1,
		theme: 'system',
		motion,
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

describe('interface preferences', () => {
	test('applies the saved widths on load', async () => {
		const server = backend(preferences(300, null));
		const panes = new InterfacePreferences({ fetcher: server.fetcher });

		await panes.load();

		expect(panes.widths).toEqual({ contextRail: 300, inspector: null });
	});

	test('saves the open view once and keeps the widths', async () => {
		const server = backend(preferences(300, null));
		const panes = new InterfacePreferences({ fetcher: server.fetcher });
		await panes.load();
		const route = { workspace_id: 'pau', view: 'files', session_id: null, saved_session_id: null } as const;

		panes.rememberRoute(route);
		await vi.waitFor(() => expect(server.puts).toHaveLength(1));
		panes.rememberRoute({ ...route });

		expect(server.puts).toEqual([{ ...preferences(300, null), last_route: route }]);
	});

	test('saves once after resizing stops and keeps the other preferences', async () => {
		vi.useFakeTimers();
		const server = backend(preferences(null, null));
		const panes = new InterfacePreferences({ fetcher: server.fetcher, saveDelayMs: 100 });
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
		const panes = new InterfacePreferences({
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
		const panes = new InterfacePreferences({ fetcher: server.fetcher, saveDelayMs: 10_000 });
		await panes.load();

		panes.resize({ contextRail: 260, inspector: null });
		await panes.load();

		expect(panes.widths.contextRail).toBe(260);
		panes.stop();
	});

	describe('motion', () => {
		test.each([
			['system', undefined],
			['reduce', 'reduce'],
			['full', 'full']
		] as const)('applies the saved %s setting to the root element', async (motion, attribute) => {
			const root = document.createElement('div');
			root.dataset.motion = 'stale';
			const server = backend(preferences(null, null, motion));
			const settings = new InterfacePreferences({ fetcher: server.fetcher, root });

			await settings.load();

			expect(root.dataset.motion).toBe(attribute);
			expect(settings.motion).toBe(motion);
		});

		test('saves a change at once and keeps the saved widths', async () => {
			const root = document.createElement('div');
			const server = backend(preferences(300, 420));
			const settings = new InterfacePreferences({ fetcher: server.fetcher, root });
			await settings.load();

			settings.setMotion('reduce');

			expect(root.dataset.motion).toBe('reduce');
			await vi.waitFor(() => expect(server.puts).toEqual([preferences(300, 420, 'reduce')]));
		});

		test('restores the previous setting when the save fails', async () => {
			const root = document.createElement('div');
			const server = backend(preferences(null, null, 'full'));
			const settings = new InterfacePreferences({ fetcher: server.fetcher, root });
			await settings.load();
			vi.mocked(server.fetcher).mockResolvedValueOnce(
				Response.json({ message: 'The database is read-only.' }, { status: 500 })
			);

			await expect(settings.setMotion('reduce')).rejects.toThrow('The database is read-only.');

			expect(settings.motion).toBe('full');
			expect(root.dataset.motion).toBe('full');
		});

		test('keeps a later choice when an earlier save fails', async () => {
			const root = document.createElement('div');
			const server = backend(preferences(null, null, 'full'));
			const settings = new InterfacePreferences({ fetcher: server.fetcher, root });
			await settings.load();
			const firstPut = Promise.withResolvers<Response>();
			vi.mocked(server.fetcher).mockReturnValueOnce(firstPut.promise);

			const first = settings.setMotion('reduce');
			await vi.waitFor(() => expect(server.fetcher).toHaveBeenCalledTimes(2));
			const second = settings.setMotion('system');
			firstPut.resolve(Response.json({ message: 'The database is read-only.' }, { status: 500 }));

			await expect(first).rejects.toThrow('The database is read-only.');
			await second;
			expect(settings.motion).toBe('system');
			expect(root.dataset.motion).toBeUndefined();
			expect(server.puts).toEqual([preferences(null, null, 'system')]);
		});

		test.each([
			['the first later save fails', [true, false]],
			['the last save fails', [false, true]]
		] as const)('matches the saved setting after quick picks when %s', async (_case, failOrder) => {
			// Saved `full`, then Reduce, System and Full are picked while Reduce
			// saves. Reduce succeeds, one later save fails and one succeeds. The
			// later outcomes are released last-request-first, so writes sent at
			// once would finish out of order.
			const root = document.createElement('div');
			let stored = preferences(null, null, 'full');
			const outcomes = [true, ...failOrder.map((fails) => !fails)].map(() => Promise.withResolvers<boolean>());
			let putCount = 0;
			const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
				if (init?.method !== 'PUT') return json(stored);
				if (!(await outcomes[putCount++].promise)) {
					return Response.json({ message: 'The database is read-only.' }, { status: 500 });
				}
				stored = JSON.parse(init.body as string) as UiPreferences;
				return json(stored);
			}) as unknown as typeof fetch;
			const settings = new InterfacePreferences({ fetcher, root });
			await settings.load();
			const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

			// A failed pick rejects for Settings to show. This test checks the state.
			const pick = async (motion: MotionPreference) => {
				try {
					await settings.setMotion(motion);
				} catch {
					// Expected for the pick whose save fails.
				}
			};
			const picks = [pick('reduce')];
			await vi.waitFor(() => expect(putCount).toBe(1));
			picks.push(pick('system'), pick('full'));
			outcomes[0].resolve(true);
			await settle();
			outcomes[2].resolve(!failOrder[1]);
			await settle();
			outcomes[1].resolve(!failOrder[0]);
			await Promise.all(picks);

			expect(stored.motion).toBe('full');
			expect(settings.motion).toBe('full');
			expect(root.dataset.motion).toBe('full');
		});

		test('a resize keeps the motion setting', async () => {
			vi.useFakeTimers();
			const server = backend(preferences(null, null, 'full'));
			const settings = new InterfacePreferences({
				fetcher: server.fetcher,
				root: document.createElement('div'),
				saveDelayMs: 50
			});
			await settings.load();

			settings.resize({ contextRail: 280, inspector: null });
			await vi.advanceTimersByTimeAsync(50);
			vi.useRealTimers();

			expect(server.puts).toEqual([preferences(280, null, 'full')]);
		});

		test('follows a change made in another window', async () => {
			const root = document.createElement('div');
			const server = backend(preferences(null, null));
			const sockets: FakeEventSocket[] = [];
			const settings = new InterfacePreferences({
				fetcher: server.fetcher,
				root,
				browserOrigin: 'http://localhost',
				socketFactory: (url) => {
					const socket = new FakeEventSocket(url);
					sockets.push(socket);
					return socket;
				}
			});
			settings.connect();
			await vi.waitFor(() => expect(sockets).toHaveLength(1));

			server.set(preferences(null, null, 'reduce'));
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

			await vi.waitFor(() => expect(root.dataset.motion).toBe('reduce'));
			settings.stop();
		});
	});
});
