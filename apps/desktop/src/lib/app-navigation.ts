import type { ShellNavItem } from '@stormlightlabs/pau-ui';

/** Explains workspace views while no workspace is open. */
export const NO_WORKSPACE_REASON = 'Open a workspace first';

/** Route IDs that belong to each product rail item. */
const SECTION_ROUTES: Record<string, string> = {
	'/': 'sessions',
	'/workspaces/[workspaceId]/sessions/[sessionId]': 'sessions',
	'/workspaces/[workspaceId]/editor': 'files',
	'/workspaces/[workspaceId]/terminal': 'terminal',
	'/workspaces/[workspaceId]/processes': 'processes',
	'/workspaces/[workspaceId]/sandbox': 'sandbox',
	'/diagnostics': 'diagnostics'
};

/**
 * Builds the product rail for the desktop app.
 *
 * Workspace views link to `workspaceId`, the workspace the operator is working
 * in, and are disabled while there is none. Items whose views do not yet read
 * live backend data have no destination, so the rail shows them as coming
 * soon instead of opening sample content.
 *
 * @param routeId The current SvelteKit route ID, which marks the active item.
 */
export function productNavigation(routeId: string | null, workspaceId: string | undefined): ShellNavItem[] {
	const active = routeId === null ? undefined : SECTION_ROUTES[routeId];
	const workspacePath = (view: string) =>
		workspaceId === undefined ? undefined : `/workspaces/${encodeURIComponent(workspaceId)}/${view}`;
	const unavailable = workspaceId === undefined ? NO_WORKSPACE_REASON : undefined;
	const items: ShellNavItem[] = [
		{ id: 'sessions', label: 'Sessions', icon: 'agents', href: '/' },
		{ id: 'files', label: 'Files', icon: 'files', href: workspacePath('editor'), unavailable },
		{ id: 'terminal', label: 'Terminal', icon: 'terminal', href: workspacePath('terminal'), unavailable },
		{ id: 'processes', label: 'Processes', icon: 'processes' },
		{ id: 'sandbox', label: 'Agent sandbox', icon: 'sandbox', href: workspacePath('sandbox'), unavailable },
		{ id: 'resources', label: 'Resources', icon: 'resources' },
		{ id: 'settings', label: 'Settings', icon: 'settings' },
		{ id: 'diagnostics', label: 'Diagnostics', icon: 'diagnostics', href: '/diagnostics' }
	];
	return items.map((item) => (item.id === active ? { ...item, active: true } : item));
}
