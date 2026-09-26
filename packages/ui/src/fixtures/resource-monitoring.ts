import type { ProcessResourceSnapshot } from '../lib/types/resource-monitoring';

const mib = 1024 * 1024;

export const resourceMonitoringFixtures = {
	active: [
		{
			processId: 'pi-diff-gutter',
			workspaceId: 'pau',
			sessionId: 'diff-gutter',
			label: 'Fix diff gutter',
			kind: 'Pi',
			status: 'running',
			sampledAtMillis: 1_772_360_400_000,
			elapsedMillis: 12 * 60_000 + 18_000,
			cpuPercent: 38.4,
			cpuTimeMillis: 92_000,
			residentMemoryBytes: 486 * mib,
			peakResidentMemoryBytes: 612 * mib,
			processCount: 3,
			peakProcessCount: 5,
			diskReadBytes: 44 * mib,
			diskWriteBytes: 18 * mib,
			processes: [
				{
					pid: 3812,
					cpuPercent: 12.2,
					residentMemoryBytes: 182 * mib,
					diskReadBytes: 20 * mib,
					diskWriteBytes: 4 * mib
				},
				{
					pid: 3834,
					parentPid: 3812,
					cpuPercent: 21.1,
					residentMemoryBytes: 256 * mib,
					diskReadBytes: 22 * mib,
					diskWriteBytes: 12 * mib
				},
				{
					pid: 3860,
					parentPid: 3834,
					cpuPercent: 5.1,
					residentMemoryBytes: 48 * mib,
					diskReadBytes: 2 * mib,
					diskWriteBytes: 2 * mib
				}
			]
		},
		{
			processId: 'claude-review',
			workspaceId: 'pau',
			sessionId: 'adapter-review',
			label: 'Review adapter fixtures',
			kind: 'Claude',
			status: 'waiting',
			sampledAtMillis: 1_772_360_400_000,
			elapsedMillis: 31 * 60_000 + 4000,
			cpuPercent: 4.2,
			cpuTimeMillis: 211_000,
			residentMemoryBytes: 734 * mib,
			peakResidentMemoryBytes: 1180 * mib,
			processCount: 4,
			peakProcessCount: 7,
			processes: [
				{ pid: 4020, cpuPercent: 1.1, residentMemoryBytes: 104 * mib },
				{ pid: 4031, parentPid: 4020, cpuPercent: 3.1, residentMemoryBytes: 630 * mib }
			]
		},
		{
			processId: 'pi-pressure',
			workspaceId: 'pau',
			sessionId: 'registry-tests',
			label: 'Run session registry tests',
			kind: 'Pi',
			status: 'running',
			sampledAtMillis: 1_772_360_400_000,
			elapsedMillis: 8 * 60_000 + 52_000,
			cpuPercent: 287.5,
			cpuTimeMillis: 328_000,
			residentMemoryBytes: 2340 * mib,
			peakResidentMemoryBytes: 2510 * mib,
			processCount: 6,
			peakProcessCount: 6,
			diskReadBytes: 184 * mib,
			diskWriteBytes: 620 * mib,
			pressure: 'cpu',
			processes: [{ pid: 4210, cpuPercent: 287.5, residentMemoryBytes: 2340 * mib }]
		}
	] satisfies ProcessResourceSnapshot[],
	completed: {
		processId: 'pi-completed',
		workspaceId: 'pau',
		sessionId: 'completed',
		label: 'Update protocol types',
		kind: 'Pi',
		status: 'stopped',
		sampledAtMillis: 1_772_360_400_000,
		elapsedMillis: 7 * 60_000 + 21_000,
		cpuPercent: 0,
		cpuTimeMillis: 88_000,
		residentMemoryBytes: 0,
		peakResidentMemoryBytes: 428 * mib,
		processCount: 0,
		peakProcessCount: 4,
		diskReadBytes: 28 * mib,
		diskWriteBytes: 12 * mib,
		processes: []
	} satisfies ProcessResourceSnapshot
};
