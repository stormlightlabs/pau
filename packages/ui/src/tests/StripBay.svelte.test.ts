import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { bayFixtures } from '../fixtures/bay';
import SessionView from '../lib/SessionView.svelte';
import BayArrivalDemo from '../stories/BayArrivalDemo.svelte';
import SessionViewDemo from '../stories/SessionViewDemo.svelte';

const strips = (name: 'needs' | 'running' | 'settled') =>
	[...document.querySelectorAll(`section[aria-labelledby="bay-${CSS.escape(name)}"] .session-bay__strip`)].map(
		(strip) => strip.querySelector('.pau-strip__name')?.textContent
	);

afterEach(() => {
	delete document.documentElement.dataset.motion;
	vi.restoreAllMocks();
});

test('racks sessions into Needs you, Running and Settled with a count each', async () => {
	await render(SessionViewDemo, { workspaces: bayFixtures.busy, initialSessionId: 'sandbox-pi' });

	await expect.element(page.getByRole('heading', { name: 'Needs you 4' })).toBeVisible();
	await expect.element(page.getByRole('heading', { name: 'Running 4' })).toBeVisible();
	await expect.element(page.getByRole('heading', { name: 'Settled 6' })).toBeVisible();
	expect(strips('running')).toEqual([
		'Audit log shutdown drain',
		'Design audit',
		'Diff gutter numbers',
		'Model list filter'
	]);
	expect(strips('settled')).toContain('Zellij smoke run');
	await expect.element(page.getByRole('region', { name: 'Needs you' })).toBeVisible();
});

test('marks the open session and opens another from its strip', async () => {
	const onSelectSession = vi.fn();
	await render(SessionView, { workspaces: bayFixtures.busy, activeSessionId: 'sandbox-pi', onSelectSession });

	const open = page.getByRole('button', { name: /Sandbox Pi sessions/ });
	await expect.element(open).toHaveAttribute('aria-current', 'page');
	await userEvent.click(page.getByRole('button', { name: /Design audit/ }));
	expect(onSelectSession).toHaveBeenCalledWith('pau-design');
});

test('lists saved sessions in Settled and resumes one on click', async () => {
	const onResumeSession = vi.fn(async () => {});
	await render(SessionView, {
		workspaces: bayFixtures.busy,
		activeSessionId: 'sandbox-pi',
		onLoadSavedSessions: async () => ({
			sessions: [{ id: 'saved-1', title: 'Earlier sandbox spike', modifiedAt: '2026-11-14T10:00:00Z' }],
			warnings: []
		}),
		onResumeSession
	});

	const saved = page.getByRole('button', { name: /Earlier sandbox spike/ }).first();
	await expect.element(saved).toBeVisible();
	await userEvent.click(saved);
	expect(onResumeSession).toHaveBeenCalledWith('pau-sandbox', 'saved-1');
});

test('puts the newest arrival at the top of Needs you', async () => {
	const { rerender } = await render(SessionView, { workspaces: bayFixtures.busy, activeSessionId: 'sandbox-pi' });
	await expect.element(page.getByRole('heading', { name: 'Needs you 4' })).toBeVisible();

	await rerender({ workspaces: bayFixtures.arrived });
	await expect.element(page.getByRole('heading', { name: 'Needs you 5' })).toBeVisible();
	expect(strips('needs')[0]).toBe('Diff gutter numbers');
	await expect.element(page.getByRole('heading', { name: 'Running 3' })).toBeVisible();
});

test('filters every rack by name, agent or workspace, and Escape clears the filter', async () => {
	await render(SessionViewDemo, { workspaces: bayFixtures.busy, initialSessionId: 'sandbox-pi' });

	const filter = page.getByRole('searchbox', { name: 'Filter sessions' });
	await userEvent.fill(filter, 'claude pau-audit');
	await expect.element(page.getByRole('heading', { name: 'Needs you 1' })).toBeVisible();
	await expect.element(page.getByRole('heading', { name: 'Running 1' })).toBeVisible();
	await expect.element(page.getByRole('heading', { name: 'Settled 0' })).toBeVisible();

	await userEvent.fill(filter, 'nothing like this');
	await expect.element(page.getByText('No sessions match “nothing like this”')).toBeVisible();

	await userEvent.keyboard('{Escape}');
	await expect.element(filter).toHaveValue('');
});

test('jumps to the filter with / and steps through strips with the arrow keys', async () => {
	await render(SessionViewDemo, { workspaces: bayFixtures.busy, initialSessionId: 'sandbox-pi' });

	page.getByRole('region', { name: 'Transcript' }).element().focus();
	await userEvent.keyboard('/');
	await expect.element(page.getByRole('searchbox', { name: 'Filter sessions' })).toHaveFocus();

	await userEvent.keyboard('{ArrowDown}');
	await expect.element(page.getByRole('button', { name: /Pi RPC timeout/ })).toHaveFocus();
	await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
	await expect.element(page.getByRole('button', { name: /Audit log shutdown drain/ })).toHaveFocus();
	await userEvent.keyboard('{ArrowUp}');
	await expect.element(page.getByRole('button', { name: /Sandbox Pi sessions/ })).toHaveFocus();
});

test('starts Pi in the open workspace from New, and its menu offers Claude Code', async () => {
	const onStartSession = vi.fn(async () => {});
	await render(SessionView, { workspaces: bayFixtures.busy, activeSessionId: 'audit-drain', onStartSession });

	await userEvent.click(page.getByRole('button', { name: 'New', exact: true }));
	expect(onStartSession).toHaveBeenLastCalledWith('pau-audit', 'pi');

	await userEvent.click(page.getByRole('button', { name: 'More ways to start a session' }));
	const menu = page.getByRole('menu', { name: 'New session' });
	await userEvent.click(menu.getByRole('menuitem', { name: 'New Claude Code session' }));
	expect(onStartSession).toHaveBeenLastCalledWith('pau-audit', 'claude');
});

test('shows the open session in the page header with Stop apart from the other actions', async () => {
	const onStop = vi.fn(async () => {});
	await render(SessionView, { workspaces: bayFixtures.busy, activeSessionId: 'audit-drain', onStop });

	await expect.element(page.getByRole('heading', { name: 'Audit log shutdown drain', level: 1 })).toBeVisible();
	const separator = document.querySelector('.pau-page-header__rule');
	expect(separator?.nextElementSibling?.textContent).toContain('Stop');
	await userEvent.click(page.getByRole('button', { name: 'Stop', exact: true }));
	expect(onStop).toHaveBeenCalledWith('audit-drain');
});

test('renders a permission request as the request card at the end of the transcript', async () => {
	const onExtensionUiResponse = vi.fn(async () => {});
	await render(SessionView, { workspaces: bayFixtures.busy, activeSessionId: 'sandbox-pi', onExtensionUiResponse });

	const transcript = page.getByRole('region', { name: 'Transcript' });
	await expect
		.element(transcript.getByRole('heading', { name: 'Allow write to crates/server/src/sessions.rs?' }))
		.toBeVisible();
	expect(document.querySelector('dialog[open]')).toBeNull();

	await userEvent.keyboard('y');
	expect(onExtensionUiResponse).toHaveBeenCalledWith('sandbox-pi', { id: 'dialog-permission', value: 'allow_once' });
});

test('lists the workspace changes, branch, sandbox and terminals in the workspace column', async () => {
	const onOpenFile = vi.fn();
	await render(SessionView, { workspaces: bayFixtures.busy, activeSessionId: 'sandbox-pi', onOpenFile });

	const column = page.getByRole('complementary', { name: 'Workspace' });
	await expect.element(column.getByRole('heading', { name: 'Changes 4 files' })).toBeVisible();
	await expect.element(column.getByText('claude/sandbox')).toBeVisible();
	await expect.element(column.getByText('Sandbox on, network off')).toBeVisible();
	await expect.element(column.getByText('Exited 0')).toBeVisible();

	await userEvent.click(column.getByRole('button', { name: /sandbox\.rs/ }));
	expect(onOpenFile).toHaveBeenCalledWith('pau-sandbox', 'crates/server/src/sandbox.rs');
});

test('plays the arrival with the strip travelling, and only a fade under reduced motion', async () => {
	const animate = vi.spyOn(Element.prototype, 'animate');
	document.documentElement.dataset.motion = 'full';
	await render(BayArrivalDemo);
	await expect.element(page.getByRole('heading', { name: 'Needs you 4' })).toBeVisible();

	await userEvent.click(page.getByRole('button', { name: 'Diff gutter numbers asks for you' }));
	await expect.element(page.getByRole('heading', { name: 'Needs you 5' })).toBeVisible();
	const travelled = animate.mock.calls.some(
		([frames], index) =>
			(animate.mock.contexts[index] as HTMLElement).dataset.bayKey === 'pau-diff' &&
			Array.isArray(frames) &&
			frames.some((frame) => 'transform' in frame)
	);
	expect(travelled).toBe(true);

	animate.mockClear();
	await userEvent.click(page.getByRole('button', { name: 'Diff gutter numbers runs again' }));
	document.documentElement.dataset.motion = 'reduce';
	await userEvent.click(page.getByRole('button', { name: 'Diff gutter numbers asks for you' }));
	await expect.element(page.getByRole('heading', { name: 'Needs you 5' })).toBeVisible();
	const calls = animate.mock.calls.map(([frames, options]) => ({ frames, options }));
	expect(calls).toEqual([
		{
			frames: [
				expect.objectContaining({ backgroundColor: expect.any(String) }),
				expect.objectContaining({ backgroundColor: expect.any(String) })
			],
			options: { duration: 100 }
		}
	]);
	expect(calls.some(({ frames }) => Array.isArray(frames) && frames.some((frame) => 'transform' in frame))).toBe(false);
});
