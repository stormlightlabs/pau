import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { sessionTreeFixtures } from '../fixtures/session-tree';
import { sessionFixtures } from '../fixtures/sessions';
import SessionTree from '../lib/SessionTree.svelte';
import SessionView from '../lib/SessionView.svelte';
import type { SessionTreeSnapshot } from '../lib/types/session';

function renderTree(tree: SessionTreeSnapshot, props: Record<string, unknown> = {}) {
	return render(SessionTree, {
		agent: 'Pi',
		supported: true,
		load: async () => tree,
		onBranch: vi.fn(async () => ({ text: 'Run the terminal tests again', cancelled: false })),
		...props
	});
}

const tree = () => page.getByRole('tree', { name: 'Session entries' });
const focused = () => document.activeElement as HTMLElement;

test('renders a large branched session as a windowed, keyboard-navigable tree', async () => {
	await renderTree(sessionTreeFixtures.large);

	await expect.element(page.getByText('4,285 entries')).toBeVisible();
	const rendered = tree().getByRole('treeitem').all().length;
	expect(rendered).toBeGreaterThan(5);
	expect(rendered).toBeLessThan(80);

	await userEvent.click(tree().getByText('Current', { exact: true }));
	expect(focused()).toHaveAttribute('aria-selected', 'true');

	await userEvent.keyboard('{Home}');
	expect(focused()).toHaveTextContent('Fix the flaky terminal resize test (main 1)');
	expect(focused()).toHaveAttribute('aria-level', '1');

	await userEvent.keyboard('{ArrowDown}');
	expect(focused()).toHaveTextContent('Show 4 more entries');
	await userEvent.keyboard('{Enter}');
	expect(focused()).toHaveTextContent('I will read the relevant files first.');

	await userEvent.keyboard('{End}');
	expect(focused()).toHaveTextContent('Current');
	expect(tree().getByRole('treeitem').all().length).toBeLessThan(80);
});

test('collapses and expands the other branches of a branch point', async () => {
	await renderTree(sessionTreeFixtures.small);

	await userEvent.click(tree().getByText('Move the resize after the socket opens'));
	await userEvent.keyboard('{ArrowLeft}');
	expect(focused()).toHaveAttribute('aria-expanded', 'true');

	await userEvent.keyboard('{ArrowLeft}');
	expect(focused()).toHaveAttribute('aria-expanded', 'false');
	await expect.element(tree().getByText('1 hidden branch')).toBeVisible();
	await expect.element(tree().getByText('Move the resize after the socket opens')).not.toBeInTheDocument();

	await userEvent.keyboard('{ArrowRight}');
	await expect.element(tree().getByText('Move the resize after the socket opens')).toBeVisible();
});

test('offers branching only from user messages on the current branch', async () => {
	const onBranch = vi.fn(async () => ({ text: 'Run the terminal tests again', cancelled: false }));
	const load = vi.fn(async () => sessionTreeFixtures.small);
	const onBranched = vi.fn();
	await renderTree(sessionTreeFixtures.small, { onBranch, load, onBranched });

	await userEvent.click(tree().getByText('Move the resize after the socket opens'));
	await expect.element(page.getByRole('button', { name: 'Branch from here' })).toBeDisabled();
	await expect.element(page.getByText('Pi can branch only from messages on the current branch.')).toBeVisible();

	await userEvent.click(tree().getByText('The resize handler runs before the socket opens.'));
	await expect.element(page.getByRole('button', { name: 'Branch from here' })).not.toBeInTheDocument();

	await userEvent.click(tree().getByText('Run the terminal tests again'));
	await userEvent.click(page.getByRole('button', { name: 'Branch from here' }));

	expect(onBranch).toHaveBeenCalledWith('u4');
	await expect.element(page.getByRole('status')).toHaveTextContent('Branched.');
	expect(onBranched).toHaveBeenCalledWith('Run the terminal tests again');
	expect(load).toHaveBeenCalledTimes(2);
});

test('reports a cancelled branch and a rejected branch', async () => {
	const onBranch = vi
		.fn()
		.mockResolvedValueOnce({ cancelled: true })
		.mockRejectedValueOnce(new Error('Wait for Pi to finish its current run, then branch again.'));
	await renderTree(sessionTreeFixtures.small, { onBranch });

	await userEvent.click(tree().getByText('Run the terminal tests again'));
	await userEvent.click(page.getByRole('button', { name: 'Branch from here' }));
	await expect.element(page.getByRole('status')).toHaveTextContent('An extension cancelled the branch.');

	await userEvent.click(page.getByRole('button', { name: 'Branch from here' }));
	await expect.element(page.getByRole('alert')).toHaveTextContent('Wait for Pi to finish its current run');
});

test('shows truncated, empty, unsupported, and failed states', async () => {
	const truncated = await renderTree(sessionTreeFixtures.truncated);
	await expect.element(page.getByText('Showing the newest 5,000 entries. Older entries are not listed.')).toBeVisible();
	await truncated.unmount();

	const empty = await renderTree(sessionTreeFixtures.empty);
	await expect.element(page.getByText('No entries yet. Send a prompt to start the tree.')).toBeVisible();
	await empty.unmount();

	const load = vi.fn(async () => sessionTreeFixtures.small);
	const unsupported = await renderTree(sessionTreeFixtures.small, { agent: 'Claude', supported: false, load });
	await expect.element(page.getByText(/Claude sessions do not support branching/)).toBeVisible();
	expect(load).not.toHaveBeenCalled();
	await unsupported.unmount();

	const failing = vi
		.fn()
		.mockRejectedValueOnce(new Error('This session has ended.'))
		.mockResolvedValueOnce(sessionTreeFixtures.small);
	await renderTree(sessionTreeFixtures.small, { load: failing });
	await expect.element(page.getByRole('alert')).toHaveTextContent('This session has ended.');
	await userEvent.click(page.getByRole('button', { name: 'Try again' }));
	await expect.element(tree()).toBeVisible();
});

test('puts the branched prompt in the session composer', async () => {
	const onBranchSession = vi.fn(async () => ({ text: 'Run the terminal tests again', cancelled: false }));
	await render(SessionView, {
		workspaces: sessionFixtures.idle,
		activeSessionId: 'session-idle',
		onLoadSessionTree: async () => sessionTreeFixtures.small,
		onBranchSession,
		onLoadCommands: async () => []
	});

	// The column shows the tree once `/tree` asks for it.
	expect(tree().elements()).toHaveLength(0);
	await userEvent.fill(page.getByRole('textbox', { name: 'Prompt' }), '/tree');
	// Escape closes the completion list, so Enter runs the command as typed.
	await userEvent.keyboard('{Escape}{Enter}');
	await userEvent.click(tree().getByText('Run the terminal tests again'));
	await userEvent.click(page.getByRole('button', { name: 'Branch from here' }));

	expect(onBranchSession).toHaveBeenCalledWith('session-idle', 'u4');
	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Run the terminal tests again');
});
