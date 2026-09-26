/** Per-process metrics shown when a monitored tree is expanded. */
export type ProcessResourceNode = {
	pid: number;
	parentPid?: number;
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
	status: 'running' | 'waiting' | 'stopped' | 'failed';
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
	processes: ProcessResourceNode[];
	pressure?: 'cpu' | 'memory';
};

/** Explicit controls available for a monitored agent session. */
export type ProcessResourceActions = { interrupt: boolean; stop: boolean };
