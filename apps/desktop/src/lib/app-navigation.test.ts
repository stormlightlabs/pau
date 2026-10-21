import { expect, test } from 'vitest';

import { NO_WORKSPACE_REASON, productNavigation, workspaceViewRoute } from './app-navigation';

function destinations(routeId: string | null, workspaceId?: string) {
	return Object.fromEntries(
		productNavigation(routeId, workspaceId).map((item) => [
			item.id,
			{ href: item.href, unavailable: item.unavailable, active: item.active ?? false }
		])
	);
}

test('links working views for the current workspace and leaves the rest coming soon', () => {
	expect(destinations('/workspaces/[workspaceId]/terminal', 'a b')).toEqual({
		sessions: { href: '/', unavailable: undefined, active: false },
		files: { href: '/workspaces/a%20b/editor', unavailable: undefined, active: false },
		terminal: { href: '/workspaces/a%20b/terminal', unavailable: undefined, active: true },
		processes: { href: undefined, unavailable: undefined, active: false },
		sandbox: { href: '/workspaces/a%20b/sandbox', unavailable: undefined, active: false },
		resources: { href: undefined, unavailable: undefined, active: false },
		settings: { href: undefined, unavailable: undefined, active: false },
		diagnostics: { href: '/diagnostics', unavailable: undefined, active: false }
	});
});

test('disables workspace views until a workspace is open', () => {
	const items = destinations('/');

	expect(items.sessions).toEqual({ href: '/', unavailable: undefined, active: true });
	for (const id of ['files', 'terminal', 'sandbox']) {
		expect(items[id]).toEqual({ href: undefined, unavailable: NO_WORKSPACE_REASON, active: false });
	}
	expect(items.diagnostics?.href).toBe('/diagnostics');
});

test('marks Sessions active on a session route and nothing on an unknown route', () => {
	expect(destinations('/workspaces/[workspaceId]/sessions/[sessionId]', 'pau').sessions?.active).toBe(true);
	expect(Object.values(destinations(null, 'pau')).some((item) => item.active)).toBe(false);
});

test('describes workspace views to restore and leaves other routes out', () => {
	expect(workspaceViewRoute('/workspaces/[workspaceId]/editor', 'pau')).toEqual({
		workspace_id: 'pau',
		view: 'files',
		session_id: null,
		saved_session_id: null
	});
	expect(workspaceViewRoute('/workspaces/[workspaceId]/sessions/[sessionId]', 'pau')).toBeUndefined();
	expect(workspaceViewRoute('/diagnostics', undefined)).toBeUndefined();
});
