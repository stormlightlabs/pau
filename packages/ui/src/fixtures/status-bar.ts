import type { ProcessResourceNode, ProcessResourceSnapshot, ProcessUsage } from '../lib/types/resource-monitoring';
import type { SessionWorkspace } from '../lib/types/session';
import { bayFixtures } from './bay';

const mib = 1024 * 1024;
const sampledAtMillis = 1_772_360_400_000;

type Tree = Pick<ProcessResourceSnapshot, 'sessionId' | 'label' | 'kind' | 'status' | 'cpuPercent'> & {
	/** The agent process first, then its children. */
	processes: Array<[name: string, cpuPercent: number, memoryMib: number]>;
};

/** A session's agent tree, with its totals summed from its processes. */
function tree({ processes, ...owner }: Tree): ProcessResourceSnapshot {
	const nodes: ProcessResourceNode[] = processes.map(([name, cpuPercent, memory], index) => ({
		pid: 4000 + index,
		parentPid: index === 0 ? undefined : 4000,
		name,
		cpuPercent,
		residentMemoryBytes: memory * mib
	}));
	const memory = nodes.reduce((total, node) => total + node.residentMemoryBytes, 0);
	return {
		...owner,
		processId: owner.sessionId ?? owner.label,
		workspaceId: 'pau',
		sampledAtMillis,
		elapsedMillis: 18 * 60_000,
		cpuTimeMillis: 94_000,
		residentMemoryBytes: memory,
		peakResidentMemoryBytes: Math.round(memory * 1.2),
		processCount: nodes.length,
		peakProcessCount: nodes.length,
		processes: nodes
	};
}

const diffGutter = tree({
	sessionId: 'pau-diff',
	label: 'Diff gutter numbers',
	kind: 'Pi 0.70.2',
	status: 'running',
	cpuPercent: 41.6,
	processes: [
		['pi', 18.4, 212],
		['node', 21.1, 286],
		['rg', 2.1, 14]
	]
});

const designAudit = tree({
	sessionId: 'pau-design',
	label: 'Design audit',
	kind: 'Pi 0.70.2',
	status: 'running',
	cpuPercent: 3.2,
	processes: [
		['pi', 2.4, 198],
		['mcp-github', 0.8, 64]
	]
});

const themes = tree({
	sessionId: 'pau-themes',
	label: 'Theme contrast pass',
	kind: 'Pi 0.70.2',
	status: 'idle',
	cpuPercent: 0.3,
	processes: [['pi', 0.3, 176]]
});

/** A Claude Code session that started a dozen MCP servers and tools. */
const crowded = tree({
	sessionId: 'pau-models',
	label: 'Model list filter',
	kind: 'Claude Code 2.1.4',
	status: 'running',
	cpuPercent: 63.9,
	processes: [
		['claude', 22.4, 412],
		['node', 9.8, 188],
		['mcp-github', 1.2, 72],
		['mcp-linear', 0.9, 68],
		['mcp-playwright', 14.6, 240],
		['chrome-headless-shell', 8.1, 356],
		['mcp-filesystem', 0.2, 41],
		['mcp-memory', 0.1, 38],
		['uv', 0.4, 22],
		['python3', 3.9, 96],
		['cargo', 1.1, 54],
		['rustc', 0.9, 610],
		['git', 0.3, 12],
		['rg', 0, 9]
	]
});

/** Pau's own process and the terminals it runs, outside any session. */
type PauOwn = { cpuPercent: number; memoryMib: number; terminals: number };
const ownProcess: PauOwn = { cpuPercent: 2.8, memoryMib: 164, terminals: 2 };

/** Sums Pau's own process with the trees it started. */
function sample(sessions: ProcessResourceSnapshot[], own: PauOwn = ownProcess): ProcessUsage {
	const totals = tree({
		label: 'Pau',
		kind: 'pau',
		status: 'running',
		cpuPercent: own.cpuPercent + sessions.reduce((total, session) => total + session.cpuPercent, 0),
		processes: []
	});
	const memory = own.memoryMib * mib + sessions.reduce((total, session) => total + session.residentMemoryBytes, 0);
	const count = 1 + own.terminals + sessions.reduce((total, session) => total + session.processCount, 0);
	return {
		pau: {
			...totals,
			residentMemoryBytes: memory,
			peakResidentMemoryBytes: Math.round(memory * 1.1),
			processCount: count,
			peakProcessCount: count
		},
		sessions
	};
}

const workspace = bayFixtures.busy.find((candidate) => candidate.id === 'pau') as SessionWorkspace;
const session = (id: string) => workspace.sessions.find((candidate) => candidate.id === id);

/** Status bar states shared by stories and browser tests. */
export const statusBarFixtures = {
	version: '0.6.0',
	agentVersion: '0.70.2',
	/** One idle session open in a clean workspace. */
	idle: { workspace, session: session('pau-themes'), usage: sample([themes]) },
	/** Several sessions working at once, with the busiest one open. */
	busy: { workspace, session: session('pau-diff'), usage: sample([diffGutter, designAudit, themes, crowded]) },
	/** The open session runs a crowd of child processes. */
	manyProcesses: { workspace, session: session('pau-models'), agentVersion: '2.1.4', usage: sample([crowded, themes]) },
	/** The open session forked far more processes than the panel lists. */
	runaway: {
		workspace,
		session: session('pau-models'),
		agentVersion: '2.1.4',
		usage: sample([{ ...crowded, processCount: 326, peakProcessCount: 326 }])
	},
	/** A sandboxed workspace with changes and no session yet. */
	noSession: {
		workspace: { ...(bayFixtures.busy[0] as SessionWorkspace), sessions: [] },
		session: undefined,
		usage: sample([], { cpuPercent: 1.9, memoryMib: 158, terminals: 1 })
	}
};
