export type View = 'landing' | 'guide' | 'reference';
export type Theme = 'light' | 'dark';
export type FeatureKey = 'sessions' | 'files' | 'mcp';

export const views: { id: View; label: string }[] = [
	{ id: 'landing', label: 'Overview' },
	{ id: 'guide', label: 'Guide' },
	{ id: 'reference', label: 'Reference' }
];

export const featureDemos: Record<FeatureKey, { label: string; title: string; description: string; meta: string }> = {
	sessions: {
		label: 'Sessions',
		title: 'Orchestrate concurrent agent sessions',
		description:
			'Run Pi and Claude Code side by side, see which session needs you, and steer work without stopping the rest.',
		meta: '2 running · 1 waiting'
	},
	files: {
		label: 'Files',
		title: 'Inspect the work, not just the transcript',
		description:
			'Move from a session to workspace files, search, and Git state while keeping the responsible run in view.',
		meta: 'feature/docs-site · 4 changes'
	},
	mcp: {
		label: 'MCP',
		title: "Manage each agent's native tools",
		description:
			'Inspect, edit, authenticate, and test Pi and Claude MCP servers while preserving native configuration and credentials.',
		meta: '3 configured · lazy connection'
	}
};

export const capabilities = [
	{
		name: 'Concurrent Pi and Claude sessions',
		area: 'Agents',
		status: 'Available',
		description: 'Start, resume, stream, steer, interrupt, and recover sessions after a UI reconnect.'
	},
	{
		name: 'Workspace files and Git status',
		area: 'Workspace',
		status: 'Available',
		description: 'Browse and search confined workspace roots, including hidden, ignored, and changed-file states.'
	},
	{
		name: 'MCP configuration and diagnostics',
		area: 'Resources',
		status: 'Available',
		description: 'Discover and edit native Pi and Claude configuration, then authenticate and test servers.'
	},
	{
		name: 'Code editing and diff review',
		area: 'Editor',
		status: 'Planned',
		description: 'Edit text with CodeMirror and review changed files and hunks in the same workspace.'
	},
	{
		name: 'Persistent terminal and Neovim',
		area: 'Developer tools',
		status: 'Planned',
		description: 'Keep PTY tabs and embedded Neovim sessions alive across route changes and UI reloads.'
	},
	{
		name: 'Local sandbox and resource monitoring',
		area: 'Safety',
		status: 'Planned',
		description: 'Show process use and run supported agent tools inside an explicit local containment profile.'
	},
	{
		name: 'Standalone server mode',
		area: 'Deployment',
		status: 'Planned',
		description: 'Run the same interface in a browser with explicit authentication and non-loopback safety checks.'
	}
] as const;
