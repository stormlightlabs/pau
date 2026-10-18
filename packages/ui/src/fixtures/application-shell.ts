import type { ShellNavItem } from '../lib/ApplicationShell.svelte';

/** Representative navigation used by shell stories and tests. */
export const shellNavigationFixtures = {
	productItems: [
		{ id: 'sessions', label: 'Sessions', icon: 'agents', href: '#sessions', active: true, attention: true },
		{ id: 'files', label: 'Files', icon: 'files', href: '#files' },
		{ id: 'terminal', label: 'Terminal', icon: 'terminal', unavailable: 'Open a workspace first' },
		{ id: 'resources', label: 'Resources', icon: 'resources' },
		{ id: 'settings', label: 'Settings', icon: 'settings' }
	],
	contextItems: [
		{
			id: 'diff-gutter',
			label: 'fix-diff-gutter',
			href: '#diff-gutter',
			status: 'needs you',
			attention: true,
			active: true
		},
		{ id: 'registry', label: 'mcp-registry-ui', href: '#registry', status: 'review' },
		{ id: 'nvim', label: 'nvim-rpc-bridge', href: '#nvim', status: 'working' },
		{ id: 'themes', label: 'theme-tokens', href: '#themes', status: 'merged' },
		{ id: 'release', label: 'release-notes', href: '#release', status: 'queued' }
	]
} satisfies { productItems: ShellNavItem[]; contextItems: ShellNavItem[] };
