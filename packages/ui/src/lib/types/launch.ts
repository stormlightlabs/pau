import type { SessionAgent } from './session';

/** Whether launch is still running, finished, or stopped on a failure. */
export type LaunchPhase = 'running' | 'ready' | 'failed';

/** Where one launch step stands. */
export type LaunchStepState = 'pending' | 'running' | 'done' | 'failed';

/**
 * What the operator can do about a failed step. The Pi actions run a command
 * in a terminal. `update_pau` means the data belongs to a newer Pau.
 */
export type LaunchAction = 'install_pi' | 'update_pi' | 'run_pi' | 'update_pau';

/** One launch step as the splash shows it. */
export type LaunchStep = {
	id: string;
	/** What the step is doing, such as "Opening the database". */
	label: string;
	state: LaunchStepState;
	/** Why the step failed, in plain language. Set only for a failed step. */
	reason?: string | null;
	action?: LaunchAction | null;
};

/** The Pi actions, which the operator runs in a terminal. */
export type AgentSetupAction = Exclude<LaunchAction, 'update_pau'>;

/**
 * Why an agent cannot start a session, and what fixes it. `agent` is Pi when
 * absent. The setup actions are Pi's; another agent's reason names its fix.
 */
export type AgentReadinessProblem = { agent?: SessionAgent; reason: string; action?: AgentSetupAction | null };
