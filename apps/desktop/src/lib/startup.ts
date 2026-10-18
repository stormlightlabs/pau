import type { StartupProgress, StartupStepId, StartupStepState } from '@stormlightlabs/pau-protocol';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import { setDesktopConnection } from './api';

/** The event the desktop shell emits with each new startup snapshot. */
export const STARTUP_PROGRESS_EVENT = 'pau://startup-progress';

/** The command that returns the current startup snapshot. */
export const STARTUP_PROGRESS_COMMAND = 'startup_progress';

/** What each startup step is doing, as the launch view names it. */
export const STARTUP_STEP_LABELS: Record<StartupStepId, string> = {
	login_shell_path: 'Loading your shell PATH',
	database: 'Opening the database',
	backend: 'Starting the local service',
	agent_readiness: 'Checking Pi'
};

const STATE_RANK: Record<StartupStepState, number> = { pending: 0, running: 1, done: 2, failed: 2 };

/**
 * Orders snapshots of one launch. Every change startup makes moves a step
 * forward or ends the phase, so a higher rank is always newer.
 */
function progressRank(progress: StartupProgress): number {
	const steps = progress.steps.reduce((total, step) => total + STATE_RANK[step.state], 0);
	return steps * 2 + (progress.phase === 'running' ? 0 : 1);
}

type DesktopHost = { __TAURI_INTERNALS__?: unknown };

/** Reports whether the page runs inside the desktop shell. */
export function isDesktopHost(host: object = globalThis): host is DesktopHost {
	return '__TAURI_INTERNALS__' in host;
}

/**
 * Follows desktop startup and calls `onProgress` with each newer snapshot.
 *
 * The page subscribes to updates before it asks for the current snapshot, so
 * it misses no step however late it loads. Asking for the snapshot also tells
 * the shell that this page will show a startup failure itself. Events and the
 * snapshot can arrive out of order, so an older snapshot is ignored.
 *
 * Once a snapshot carries the backend connection, it is stored with
 * {@link setDesktopConnection} before `onProgress` runs, so API calls made from
 * the callback succeed.
 *
 * @returns A function that stops following startup.
 */
export async function followStartup(onProgress: (progress: StartupProgress) => void): Promise<() => void> {
	let latest = -1;
	const receive = (progress: StartupProgress) => {
		const rank = progressRank(progress);
		if (rank < latest) return;
		latest = rank;
		if (progress.connection) setDesktopConnection(progress.connection);
		onProgress(progress);
	};
	const unlisten = await listen<StartupProgress>(STARTUP_PROGRESS_EVENT, (event) => receive(event.payload));
	try {
		receive(await invoke<StartupProgress>(STARTUP_PROGRESS_COMMAND));
	} catch (error) {
		unlisten();
		throw error;
	}
	return unlisten;
}
