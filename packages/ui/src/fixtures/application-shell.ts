import type { ShellNavItem } from '../lib/ApplicationShell.svelte';

/** Representative navigation used by shell stories and tests. */
export const shellNavigationFixtures = {
	productItems: [
		{ id: 'sessions', label: 'Sessions', icon: 'sessions', href: '#sessions', active: true, attention: true },
		{ id: 'files', label: 'Files', icon: 'file', href: '#files' },
		{ id: 'review', label: 'Review', icon: 'review' },
		{ id: 'terminal', label: 'Terminal', icon: 'terminal', unavailable: 'Open a workspace first' },
		{ id: 'resources', label: 'Pi resources', icon: 'resources', href: '#resources' },
		{ id: 'settings', label: 'Settings', icon: 'settings', href: '#settings', action: 'app.settings' },
		{ id: 'diagnostics', label: 'Diagnostics', icon: 'diagnostics', href: '#diagnostics', paletteOnly: true }
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

/**
 * The six views with `active` on the one a surface shows, without the demo
 * attention and unavailable states. Views default to these, so their stories
 * show the same view row as the app.
 */
export function shellViews(active: string): ShellNavItem[] {
	return shellNavigationFixtures.productItems.map(({ id, label, icon, href, action, paletteOnly }) => ({
		id,
		label,
		icon,
		href,
		action,
		paletteOnly,
		active: id === active
	}));
}
