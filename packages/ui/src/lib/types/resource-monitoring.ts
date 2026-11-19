import type { SessionStatus } from './session';

/** Per-process metrics shown when a monitored tree is expanded. */
export type ProcessResourceNode = {
	pid: number;
	parentPid?: number;
	/** Executable name, such as `node`, without its arguments. */
	name?: string;
	cpuPercent: number;
	residentMemoryBytes: number;
	diskReadBytes?: number;
	diskWriteBytes?: number;
};

/** Current and peak measurements for one Pau-owned process tree. */
export type ProcessResourceSnapshot = {
	processId: string;
	workspaceId: string;
	sessionId?: string;
	label: string;
	kind: string;
	/** State of the session that owns the tree. */
	status: SessionStatus;
	sampledAtMillis: number;
	elapsedMillis: number;
	cpuPercent: number;
	cpuTimeMillis: number;
	residentMemoryBytes: number;
	peakResidentMemoryBytes: number;
	processCount: number;
	peakProcessCount: number;
	diskReadBytes?: number;
	diskWriteBytes?: number;
	/**
	 * The root, then its largest descendants. Pau lists a bounded number, so
	 * `processCount` can exceed its length.
	 */
	processes: ProcessResourceNode[];
	pressure?: 'cpu' | 'memory';
};

/** Explicit controls available for a monitored agent session. */
export type ProcessResourceActions = { interrupt: boolean; stop: boolean };

/**
 * One resource sample: Pau's totals, for Pau and every process it started,
 * and the agent process tree of each running session.
 */
export type ProcessUsage = { pau: ProcessResourceSnapshot; sessions: ProcessResourceSnapshot[] };
