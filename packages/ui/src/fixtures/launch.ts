import type { AgentReadinessProblem, LaunchStep, LaunchStepState } from '../lib/types/launch';

const labels = {
	login_shell_path: 'Loading your shell PATH',
	database: 'Opening the database',
	backend: 'Starting the local service',
	agent_readiness: 'Checking Pi'
} as const;

function steps(...states: LaunchStepState[]): LaunchStep[] {
	return Object.entries(labels).map(([id, label], index) => ({ id, label, state: states[index] ?? 'pending' }));
}

/** Adds a failure reason and action to one step. */
function failing(list: LaunchStep[], id: keyof typeof labels, failure: Partial<LaunchStep>): LaunchStep[] {
	return list.map((step) => (step.id === id ? { ...step, state: 'failed', ...failure } : step));
}

/** Launch snapshots shared by stories and deterministic browser tests. */
export const launchFixtures = {
	starting: steps('done', 'running'),
	service: steps('done', 'done', 'running'),
	checking: steps('done', 'done', 'done', 'running'),
	ready: steps('done', 'done', 'done', 'done'),
	slowPath: failing(steps('failed', 'done', 'running'), 'login_shell_path', {
		reason:
			'Your login shell took longer than 5 seconds to report its PATH, so Pau kept the PATH it was opened with. Pi and other tools may not be found.'
	}),
	newerDatabase: failing(steps('done', 'failed'), 'database', {
		reason: 'The database was created by a newer version of Pau (schema 9, this version reads up to 7).',
		action: 'update_pau'
	}),
	backendFailure: failing(steps('done', 'done', 'failed'), 'backend', {
		reason: 'Address already in use (os error 48).'
	})
} satisfies Record<string, LaunchStep[]>;

/** Pi readiness problems, one per action. */
export const agentReadinessFixtures = {
	missing: { reason: 'Pau could not find the pi command on your PATH.', action: 'install_pi' },
	outdated: { reason: 'Pi 0.9.2 is older than the 1.0 release Pau supports.', action: 'update_pi' },
	noProvider: { reason: 'Pi has no models available. Connect a provider in Pi first.', action: 'run_pi' }
} satisfies Record<string, AgentReadinessProblem>;
