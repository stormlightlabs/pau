import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import type { LastRoute, LastView } from '@stormlightlabs/pau-protocol';
import type { ShellNavItem } from '@stormlightlabs/pau-ui';

/** Explains workspace views while no workspace is open. */
export const NO_WORKSPACE_REASON = 'Open a workspace first';

/** Route IDs that belong to each view. */
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
 * Builds the view row for the desktop app: Sessions, Files, Review,
 * Terminal, Pi resources and Settings. Agent sandbox and Diagnostics stay
 * out of the row: Settings links to them from its Sandbox and About
 * sections, and the command palette lists them.
 *
 * Workspace views link to `workspaceId`, the workspace the operator is working
 * in, and are disabled while there is none. Views that do not yet read live
 * backend data have no destination, so the row shows them as coming soon
 * instead of opening sample content.
 *
 * @param routeId The current SvelteKit route ID, which marks the active item.
 */
export function productNavigation(routeId: string | null, workspaceId: string | undefined): ShellNavItem[] {
	const active = routeId === null ? undefined : SECTION_ROUTES[routeId];
	const workspacePath = (view: string) =>
		workspaceId === undefined ? undefined : `/workspaces/${encodeURIComponent(workspaceId)}/${view}`;
	const unavailable = workspaceId === undefined ? NO_WORKSPACE_REASON : undefined;
	const items: ShellNavItem[] = [
		{ id: 'sessions', label: 'Sessions', icon: 'sessions', href: '/' },
		{ id: 'files', label: 'Files', icon: 'file', href: workspacePath('editor'), unavailable },
		{ id: 'review', label: 'Review', icon: 'review' },
		{ id: 'terminal', label: 'Terminal', icon: 'terminal', href: workspacePath('terminal'), unavailable },
		{ id: 'resources', label: 'Pi resources', icon: 'resources', href: workspacePath('resources'), unavailable },
		{ id: 'settings', label: 'Settings', icon: 'settings', href: '/settings', action: 'app.settings' },
		{
			id: 'sandbox',
			label: 'Agent sandbox',
			icon: 'sandbox',
			href: workspacePath('sandbox'),
			unavailable,
			paletteOnly: true
		},
		{ id: 'diagnostics', label: 'Diagnostics', icon: 'diagnostics', href: '/diagnostics', paletteOnly: true }
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

/**
 * The query that makes the Files view open a file, such as one linked from
 * terminal output: `?path=src/main.rs&line=12`.
 */
export function openFileQuery(path: string, line?: number): string {
	const query = new URLSearchParams({ path });
	if (line !== undefined) query.set('line', String(line));
	return `?${query}`;
}

/** Shows a workspace file in the Files view, at `line` when one is given. */
export function openFileInEditor(workspaceId: string, path: string, line?: number): void {
	// eslint-disable-next-line svelte/no-navigation-without-resolve -- the route is resolved; only the query is added
	void goto(resolve('/workspaces/[workspaceId]/editor', { workspaceId }) + openFileQuery(path, line));
}
