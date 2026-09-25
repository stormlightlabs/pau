import type { ShellNavItem } from '../lib/ApplicationShell.svelte';

/** Representative navigation used by shell stories and tests. */
export const shellNavigationFixtures = {
	productItems: [
		{ id: 'sessions', label: 'Sessions', icon: 'agents', active: true, attention: true },
		{ id: 'files', label: 'Files', icon: 'files' },
		{ id: 'resources', label: 'Resources', icon: 'resources' },
		{ id: 'settings', label: 'Settings', icon: 'settings' }
	],
	contextItems: [
		{ id: 'diff-gutter', label: 'fix-diff-gutter', status: 'needs you', attention: true, active: true },
		{ id: 'registry', label: 'mcp-registry-ui', status: 'review' },
		{ id: 'nvim', label: 'nvim-rpc-bridge', status: 'working' },
		{ id: 'themes', label: 'theme-tokens', status: 'merged' },
		{ id: 'release', label: 'release-notes', status: 'queued' }
	]
} satisfies { productItems: ShellNavItem[]; contextItems: ShellNavItem[] };
