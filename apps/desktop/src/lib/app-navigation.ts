import type { LastRoute, LastView } from '@stormlightlabs/pau-protocol';
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
	'/workspaces/[workspaceId]/resources/[[kind]]': 'resources',
	'/settings': 'settings',
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
		{ id: 'resources', label: 'Resources', icon: 'resources', href: workspacePath('resources'), unavailable },
		{ id: 'settings', label: 'Settings', icon: 'settings', href: '/settings' },
		{ id: 'diagnostics', label: 'Diagnostics', icon: 'diagnostics', href: '/diagnostics' }
	];
	return items.map((item) => (item.id === active ? { ...item, active: true } : item));
}

/** Route IDs of the workspace views other than sessions. */
export const WORKSPACE_VIEW_ROUTES = {
	files: '/workspaces/[workspaceId]/editor',
	terminal: '/workspaces/[workspaceId]/terminal',
	processes: '/workspaces/[workspaceId]/processes',
	sandbox: '/workspaces/[workspaceId]/sandbox',
	resources: '/workspaces/[workspaceId]/resources/[[kind]]'
} as const satisfies Record<Exclude<LastView, 'session'>, string>;

/**
 * Describes a workspace view to save as the view to open on the next launch.
 * Sessions describe themselves, since the URL alone does not say which saved
 * Pi session they run. Views outside a workspace, such as diagnostics, return
 * `undefined` and leave the saved view as it was.
 */
export function workspaceViewRoute(routeId: string | null, workspaceId: string | undefined): LastRoute | undefined {
	if (workspaceId === undefined) return undefined;
	const view = (Object.keys(WORKSPACE_VIEW_ROUTES) as (keyof typeof WORKSPACE_VIEW_ROUTES)[]).find(
		(candidate) => WORKSPACE_VIEW_ROUTES[candidate] === routeId
	);
	return view && { workspace_id: workspaceId, view, session_id: null, saved_session_id: null };
}

const launchRoute = { claimed: false };

/**
 * Returns `true` the first time this window asks, and `false` after. Only the
 * first view a window opens returns to the saved view, so coming back to
 * Sessions later shows the session list as usual.
 */
export function claimLaunchRoute(): boolean {
	if (launchRoute.claimed) return false;
	launchRoute.claimed = true;
	return true;
}
