import type { ComponentProps } from 'svelte';
import { page, userEvent } from 'vitest/browser';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { sessionFixtures } from '../fixtures/sessions';
import { transcriptSearchFixtures, transcriptSearchNow } from '../fixtures/transcript-search';
import SessionView from '../lib/SessionView.svelte';
import TranscriptSearch from '../lib/TranscriptSearch.svelte';

function props(
	overrides: Partial<ComponentProps<typeof TranscriptSearch>> = {}
): ComponentProps<typeof TranscriptSearch> {
	return {
		agent: 'Pi',
		delay: 0,
		now: transcriptSearchNow,
		search: vi.fn(async () => transcriptSearchFixtures.results),
		onSelect: vi.fn(() => true),
		onClose: vi.fn(),
		...overrides
	};
}

test('lists matches with the found text highlighted, role, and relative time', async () => {
	const search = vi.fn(async () => transcriptSearchFixtures.results);
	await render(TranscriptSearch, props({ search }));

	await userEvent.type(page.getByRole('searchbox', { name: 'Search transcript' }), 'gutter');

	await expect.element(page.getByRole('list', { name: 'Search results' })).toBeVisible();
	expect(search).toHaveBeenCalledWith('gutter');
	await expect.element(page.getByRole('button', { name: /Pi.*5 minutes ago.*Gutter rows now follow/ })).toBeVisible();
	await expect.element(page.getByRole('button', { name: /You.*2 hours ago/ })).toBeVisible();
	expect(document.querySelector('mark')?.textContent).toBe('Gutter');
});

test('says when nothing matches', async () => {
	await render(TranscriptSearch, props({ search: async () => transcriptSearchFixtures.noResults }));

	await userEvent.type(page.getByRole('searchbox'), 'zebra');

	await expect.element(page.getByText('No matches for “zebra”.')).toBeVisible();
});

test('reports truncated results', async () => {
	await render(TranscriptSearch, props({ search: async () => transcriptSearchFixtures.truncated }));

	await userEvent.type(page.getByRole('searchbox'), 'gutter');

	await expect.element(page.getByText('Showing the newest 3 matches.')).toBeVisible();
});

test('moves between results with the arrow keys and selects with Enter', async () => {
	const onSelect = vi.fn(() => true);
	await render(TranscriptSearch, props({ onSelect }));
	await userEvent.type(page.getByRole('searchbox'), 'gutter');
	await expect.element(page.getByRole('list', { name: 'Search results' })).toBeVisible();

	await userEvent.keyboard('{ArrowDown}');
	expect(onSelect).toHaveBeenLastCalledWith(transcriptSearchFixtures.results.hits[1]);
	await userEvent.keyboard('{ArrowUp}{ArrowUp}');
	expect(onSelect).toHaveBeenLastCalledWith(transcriptSearchFixtures.results.hits[2]);
	await userEvent.keyboard('{Enter}');
	expect(onSelect).toHaveBeenCalledTimes(4);
	await expect.element(page.getByText('That message is not in the loaded transcript.')).not.toBeInTheDocument();
});

test('explains a match that is not in the loaded transcript', async () => {
	await render(TranscriptSearch, props({ onSelect: vi.fn(() => false) }));
	await userEvent.type(page.getByRole('searchbox'), 'gutter');

	await userEvent.click(page.getByRole('button', { name: /The gutter width/ }));

	await expect.element(page.getByText('That message is not in the loaded transcript.')).toBeVisible();
});

test('shows a failed search and retries it', async () => {
	let failing = true;
	const search = async () => {
		if (failing) throw new Error('Pau could not reach its backend.');
		return transcriptSearchFixtures.results;
	};
	await render(TranscriptSearch, props({ search }));

	await userEvent.type(page.getByRole('searchbox'), 'gutter');
	await expect.element(page.getByRole('alert')).toHaveTextContent('Pau could not reach its backend.');
	failing = false;
	await userEvent.click(page.getByRole('button', { name: 'Try again' }));

	await expect.element(page.getByRole('list', { name: 'Search results' })).toBeVisible();
});

test('ignores a response for an older query', async () => {
	let resolveFirst: (value: typeof transcriptSearchFixtures.results) => void = vi.fn();
	const search = vi
		.fn()
		.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
		.mockResolvedValue(transcriptSearchFixtures.noResults);
	await render(TranscriptSearch, props({ search }));

	await userEvent.type(page.getByRole('searchbox'), 'g');
	await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
	await userEvent.type(page.getByRole('searchbox'), 'x');
	await expect.element(page.getByText('No matches for “gx”.')).toBeVisible();
	resolveFirst(transcriptSearchFixtures.results);

	await expect.element(page.getByRole('list', { name: 'Search results' })).not.toBeInTheDocument();
});

test('opens from the session view with the shortcut, jumps to an entry, and returns focus on Escape', async () => {
	const onSearchSession = vi.fn(async () => transcriptSearchFixtures.results);
	await render(SessionView, {
		workspaces: sessionFixtures.running,
		activeSessionId: 'session-running',
		onSearchSession
	});

	await userEvent.keyboard('{Control>}f{/Control}');
	const field = page.getByRole('searchbox', { name: 'Search transcript' });
	await expect.element(field).toHaveFocus();
	await userEvent.type(field, 'gutter');
	await userEvent.click(page.getByRole('button', { name: /You.*Fix gutter markers/ }));

	expect(onSearchSession).toHaveBeenCalledWith('session-running', 'gutter');
	await vi.waitFor(() => expect(document.querySelector('[data-entry-id="prompt-1"][data-found]')).not.toBeNull());

	await userEvent.keyboard('{Escape}');
	await expect.element(page.getByRole('searchbox', { name: 'Search transcript' })).not.toBeInTheDocument();
	await expect.element(page.getByRole('textbox', { name: 'Prompt' })).toHaveFocus();
});

test('leaves the shortcut alone when the view cannot search', async () => {
	await render(SessionView, { workspaces: sessionFixtures.running, activeSessionId: 'session-running' });

	await userEvent.keyboard('{Control>}f{/Control}');

	await expect.element(page.getByRole('searchbox', { name: 'Search transcript' })).not.toBeInTheDocument();
});
