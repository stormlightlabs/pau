import type { StartupProgress, StartupStepState } from '@stormlightlabs/pau-protocol';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { afterEach, expect, test, vi } from 'vitest';

import { setDesktopConnection } from './api';
import {
	agentReadinessProblem,
	followStartup,
	isDesktopHost,
	launchSteps,
	STARTUP_PROGRESS_COMMAND,
	STARTUP_PROGRESS_EVENT
} from './startup';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('./api', () => ({ setDesktopConnection: vi.fn() }));

const CONNECTION = { api_origin: 'http://127.0.0.1:43127', token: '0123456789abcdef0123456789abcdef' };

function progress(
	states: [StartupStepState, StartupStepState, StartupStepState, StartupStepState],
	phase: StartupProgress['phase'] = 'running'
): StartupProgress {
	const ids = ['login_shell_path', 'database', 'backend', 'agent_readiness'] as const;
	return {
		phase,
		steps: ids.map((id, index) => ({ id, state: states[index], reason: null, action: null })),
		connection: states[2] === 'done' ? CONNECTION : null,
		readiness: null
	};
}

/** Captures the progress listener and returns a way to emit events to it. */
function captureListener(onListen: (event: string) => void = () => {}) {
	const unlisten = vi.fn();
	let listener: EventCallback<StartupProgress> | undefined;
	vi.mocked(listen).mockImplementation(async (event, handler) => {
		onListen(event);
		listener = handler as EventCallback<StartupProgress>;
		return unlisten;
	});
	const emit = (payload: StartupProgress) => listener?.({ event: STARTUP_PROGRESS_EVENT, id: 1, payload });
	return { unlisten, emit };
}

afterEach(() => {
	vi.clearAllMocks();
});

test('subscribes before it asks for the snapshot, then follows updates', async () => {
	const order: string[] = [];
	const { emit, unlisten } = captureListener((event) => {
		order.push(`listen ${event}`);
	});
	vi.mocked(invoke).mockImplementation(async (command) => {
		order.push(`invoke ${command}`);
		return progress(['done', 'running', 'pending', 'pending']);
	});
	const onProgress = vi.fn<(progress: StartupProgress) => void>();

	const stop = await followStartup(onProgress);
	emit(progress(['done', 'done', 'running', 'pending']));

	expect(order).toEqual([`listen ${STARTUP_PROGRESS_EVENT}`, `invoke ${STARTUP_PROGRESS_COMMAND}`]);
	expect(onProgress.mock.calls.map(([snapshot]) => snapshot.steps[1].state)).toEqual(['running', 'done']);
	stop();
	expect(unlisten).toHaveBeenCalledOnce();
});

test('stores the connection before reporting the ready snapshot', async () => {
	const { emit } = captureListener();
	vi.mocked(invoke).mockResolvedValue(progress(['done', 'done', 'running', 'pending']));
	const ready = progress(['done', 'done', 'done', 'failed'], 'ready');
	const onProgress = vi.fn((next: StartupProgress) => {
		if (next.connection) expect(setDesktopConnection).toHaveBeenCalledWith(CONNECTION);
	});

	await followStartup(onProgress);
	expect(setDesktopConnection).not.toHaveBeenCalled();
	emit(ready);

	expect(onProgress).toHaveBeenLastCalledWith(ready);
	expect(setDesktopConnection).toHaveBeenCalledOnce();
});

test('ignores a snapshot older than one it already reported', async () => {
	const { emit } = captureListener();
	const newer = progress(['done', 'done', 'done', 'running']);
	const snapshot = Promise.withResolvers<StartupProgress>();
	vi.mocked(invoke).mockReturnValue(snapshot.promise);
	const onProgress = vi.fn<(progress: StartupProgress) => void>();

	const following = followStartup(onProgress);
	await Promise.resolve();
	emit(newer);
	snapshot.resolve(progress(['done', 'done', 'running', 'pending']));
	await following;

	expect(onProgress.mock.calls).toEqual([[newer]]);
});

test('stops listening when the snapshot request fails', async () => {
	const { unlisten } = captureListener();
	vi.mocked(invoke).mockRejectedValue(new Error('Command startup_progress not allowed'));

	await expect(followStartup(() => {})).rejects.toThrow('not allowed');
	expect(unlisten).toHaveBeenCalledOnce();
});

test('detects the desktop host', () => {
	expect(isDesktopHost({ __TAURI_INTERNALS__: {} })).toBe(true);
	expect(isDesktopHost({})).toBe(false);
});

test('names each step for the launch splash', () => {
	expect(launchSteps(undefined)).toEqual([]);
	expect(launchSteps(progress(['done', 'running', 'pending', 'pending'])).map((step) => step.label)).toEqual([
		'Loading your shell PATH',
		'Opening the database',
		'Starting the local service',
		'Checking Pi'
	]);
});

test('reports a failed readiness check as a problem for the sessions view', () => {
	const ready = progress(['done', 'done', 'done', 'done'], 'ready');
	expect(agentReadinessProblem(ready)).toBeUndefined();

	const missing = progress(['done', 'done', 'done', 'failed'], 'ready');
	missing.steps[3] = { ...missing.steps[3], reason: 'Pau could not find pi.', action: 'install_pi' };
	expect(agentReadinessProblem(missing)).toEqual({ reason: 'Pau could not find pi.', action: 'install_pi' });
});
