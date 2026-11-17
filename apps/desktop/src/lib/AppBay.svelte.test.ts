import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import AppBay from './AppBay.svelte';
import { FakeEventSocket } from './fake-event-socket';
import { LiveSessions } from './live-sessions.svelte';

vi.mock('$app/state', () => ({ page: { params: {}, route: { id: '/settings' } } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const reason =
	'Claude Code was not found. Install Claude Code, add `claude` to PATH, or configure its executable path.';

test('disables New Claude Code session with its reason when Claude Code is not ready', async () => {
	const fetcher = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.endsWith('/api/workspaces'))
			return Response.json([{ id: 'pau', name: 'pau', path: '/work/pau', created_at: '', updated_at: '' }]);
		if (url.endsWith('/api/agents/readiness'))
			return Response.json({ agents: [{ agent: 'claude', found: false, ready: false, reason }] });
		return Response.json([]);
	});
	const sessions = new LiveSessions({
		browserOrigin: 'http://localhost',
		fetcher: fetcher as unknown as typeof fetch,
		socketFactory: (url) => new FakeEventSocket(url)
	});
	sessions.connect();
	await vi.waitFor(() => expect(sessions.workspaces).toHaveLength(1));

	await render(AppBay, { sessions });
	await userEvent.click(page.getByRole('button', { name: 'More ways to start a session' }));

	const item = page.getByRole('menuitem', { name: 'New Claude Code session' });
	await expect.element(item).toBeDisabled();
	await expect.element(item).toHaveAccessibleDescription(reason.replaceAll('`', ''));
	sessions.close();
});
